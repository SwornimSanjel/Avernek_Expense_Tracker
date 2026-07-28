# syntax=docker/dockerfile:1.7
#
# Multi-stage build for the Avernek Expense Tracker (Next.js App Router).
#
# Why three stages: `deps` installs once and is cached until the lockfile
# changes, `builder` compiles with the full devDependency toolchain, and
# `runner` ships only Next's standalone server -- no source, no npm, no
# devDependencies. Final image is a few hundred MB instead of ~1.5 GB.
#
# The .env never lands in a layer. It is mounted as a BuildKit secret for the
# single RUN that needs it, because NEXT_PUBLIC_* values are inlined into the
# client bundle at build time and so must exist while `next build` runs.
# Server-only values (SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET) are injected at
# runtime by docker compose instead.
#
#   DOCKER_BUILDKIT=1 docker build --secret id=envfile,src=.env -t avernek-expense-tracker .

##############################################################################
# Stage 1 - dependencies
##############################################################################
FROM node:22-alpine AS deps
WORKDIR /app

# sharp (Next's image optimiser) links against glibc-style symbols on musl.
RUN apk add --no-cache libc6-compat

COPY package.json package-lock.json ./
RUN npm ci

##############################################################################
# Stage 2 - build
##############################################################################
FROM node:22-alpine AS builder
WORKDIR /app

RUN apk add --no-cache libc6-compat

ENV NEXT_TELEMETRY_DISABLED=1
# Switches next.config.ts to `output: "standalone"` without affecting Netlify.
ENV DOCKER_BUILD=1

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# `next build` reads .env.production.local first, so the mounted secret wins
# over anything else. The mount is a tmpfs that exists only for this command.
RUN --mount=type=secret,id=envfile,target=/app/.env.production.local \
    npm run build

##############################################################################
# Stage 3 - runtime
##############################################################################
FROM node:22-alpine AS runner
WORKDIR /app

RUN apk add --no-cache libc6-compat

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

RUN addgroup -g 1001 -S nodejs \
 && adduser -u 1001 -S nextjs -G nodejs

# standalone/ already contains server.js plus a pruned node_modules; static/
# and public/ are the two things Next expects you to copy alongside it.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

USER nextjs
EXPOSE 3000

# Node 22 ships a global fetch, so no curl needed in the image.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
