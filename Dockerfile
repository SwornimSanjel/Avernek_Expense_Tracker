# syntax=docker/dockerfile:1.7
#
# Production image for the Avernek Expense Tracker (Next.js App Router, SSR).
#
# Jenkins builds one target per pipeline stage. Each target reuses the layers
# of the one before it, so dependencies are installed once and the application
# is built once:
#
#   deps     npm ci from the lockfile                      "Install Dependencies"
#   verify   tsc --noEmit (+ tests, if a test script exists) "Lint / Type Check / Test"
#   builder  next build (standalone server, after verify)   "Application Build"
#   runner   the runtime image that is deployed             "Docker Image Build"
#
# The build needs no secrets. Everything the app reads (DATABASE_URL,
# SESSION_SECRET, ADMIN_*, CRON_SECRET) is server-side and read at runtime from
# the deployment's .env, so nothing is compiled into the image.
#
#   docker build -t avernek-expense-tracker:local .

ARG NODE_IMAGE=node:22-alpine

##############################################################################
# deps: production and build dependencies, pinned by package-lock.json
##############################################################################
FROM ${NODE_IMAGE} AS deps
WORKDIR /app

# sharp (Next's image optimiser) needs glibc-compatible symbols on musl.
RUN apk add --no-cache libc6-compat

COPY package.json package-lock.json ./
# --prefer-offline: packages already in the npm cache are used without asking
# the registry again, which is most of an install when the lockfile changes.
RUN --mount=type=cache,target=/root/.npm \
    npm ci --no-audit --no-fund --prefer-offline

##############################################################################
# verify: type check and tests. No ESLint configuration exists in this
# project, so there is no lint step (`next lint` would stop and ask to set one
# up). `npm test --if-present` runs tests once a "test" script is added.
##############################################################################
FROM deps AS verify
ENV NEXT_TELEMETRY_DISABLED=1
COPY . .
RUN npm run typecheck \
 && npm test --if-present

##############################################################################
# builder: the standalone Next.js server bundle
##############################################################################
FROM deps AS builder
ENV NEXT_TELEMETRY_DISABLED=1 \
    # Switches next.config.ts to `output: "standalone"` (Netlify keeps the default).
    DOCKER_BUILD=1 \
    # The verify stage already type-checked; next build skips doing it again.
    SKIP_BUILD_TYPECHECK=1
# The build cannot start until verify passed (type check + tests). In Jenkins
# verify is already built and cached by the stage before, so this is instant.
COPY --from=verify /app/package.json /tmp/verified.json
COPY . .
# Next's compile cache survives between builds, so only what changed is
# recompiled instead of the whole app every time.
RUN --mount=type=cache,target=/app/.next/cache,id=avernek-expense-tracker-next-cache \
    npm run build

##############################################################################
# runner: only the standalone server, static assets and the admin seed script
##############################################################################
FROM ${NODE_IMAGE} AS runner
WORKDIR /app

RUN apk add --no-cache libc6-compat

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

RUN addgroup -g 1001 -S nodejs \
 && adduser -u 1001 -S nextjs -G nodejs

# standalone/ contains server.js and a pruned node_modules; static/ and public/
# are what Next expects alongside it.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

# Run by the pipeline as `docker compose exec web node scripts/seed-admin.mjs`.
# It needs only `pg` (already in the standalone trace) and node:crypto.
COPY --from=builder --chown=nextjs:nodejs /app/scripts/seed-admin.mjs ./scripts/

USER 1001:1001
EXPOSE 3000

# Node 22 has a global fetch, so the image needs no curl.
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

# Compose runs this with `init: true`: tini is PID 1, forwards SIGTERM to Node
# and reaps zombies, so `docker compose stop` shuts the server down cleanly.
CMD ["node", "server.js"]
