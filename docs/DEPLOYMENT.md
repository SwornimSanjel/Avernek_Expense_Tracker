# Deployment: Avernek Expense Tracker

Production follows the Avernek Technologies deployment standard: a GitHub push
triggers Jenkins, which tests and builds a versioned Docker image on the VPS and
deploys it with Docker Compose from a permanent directory. No container registry
is used, and nothing in production depends on the Jenkins workspace.

```
GitHub push → Jenkins checkout → Validate → npm ci → type check / tests → next build
→ versioned image → Prepare (/srv/deployments) → Deploy (backup, migrations, up)
→ Health check → success: release recorded as verified
               → failure: previous verified release restored and verified
→ workspace wiped → image retention (cache: central job) → Discord report
```

| | |
|---|---|
| App | Next.js 15 (App Router, server-rendered), Node 22, npm (`package-lock.json`) |
| Services | `web` (the app, port 3000 inside), `db` (PostgreSQL 16), `fx-cron` (daily NRB exchange-rate refresh) |
| Database | Postgres in the stack, named volume `avernek-expense-tracker_pgdata` |
| Uploads | none: the app stores no user files, so there is no uploads volume |
| Health | `GET /api/health` (liveness), `/login` (server-rendered page), a database query from the app container |
| Checks in CI | `tsc --noEmit`; `npm test` once a test script exists. No ESLint configuration exists, so there is no lint step |
| Deployment directory | `/srv/deployments/avernek-expense-tracker/` |
| Compose project | `avernek-expense-tracker` |
| Image | `avernek-expense-tracker:<git-sha-12>-<build-number>` |

## Files

| Repository | Purpose |
|---|---|
| `Jenkinsfile` | The pipeline (stages below) |
| `Dockerfile` | Targets `deps`, `verify`, `builder`, `runner`; non-root runtime, no secrets |
| `.dockerignore` | Keeps `.env`, `.git`, CI and docs out of the build context |
| `compose.yaml` | Production stack, prebuilt images only |
| `.env.example` | Every runtime variable, documented |
| `scripts/ci/validate.sh` | Validate stage (files, scripts, Dockerfile, Compose) |
| `scripts/ci/build.sh` | One Docker build target per stage, under the shared build-cache lock |
| `scripts/ci/release.sh` | Preflight, prepare, deploy, verify, finalize, rollback, image retention, diagnostics |
| `scripts/deploy-control.sh` | Operator tool, installed into the deployment directory |
| `scripts/healthcheck.sh` | Post-deployment verification, installed as `bin/healthcheck.sh` |
| `docker/fx-cron.sh` | The FX cron sidecar's script, installed as `bin/fx-cron.sh` |
| `scripts/docker-cache-maintenance.sh` | The VPS's central build-cache trim (not run by this pipeline) |
| `scripts/test-discord-notification.groovy` | Stand-alone Discord check via the Jenkins CLI |

On the server, after a deployment:

```
/srv/deployments/avernek-expense-tracker/      owner jenkins, mode 750
├── compose.yaml            the deployed stack
├── .env                    runtime configuration and secrets (mode 600; you own its contents)
├── .deployment.env         APP_IMAGE and release metadata, written by the pipeline
├── deploy-control.sh       start / stop / restart / recreate / status / logs / rollback / backup
├── bin/healthcheck.sh, bin/fx-cron.sh
├── releases/verified/      the release in service (compose.yaml, .deployment.env, bin/)
├── releases/prior/         the verified release before it: the manual rollback target
├── releases/env-backups/   copies of .env replaced by SYNC_ENV_FROM_CREDENTIAL
├── backups/                pg_dump files (mode 700), made before every migration run
├── .activated              written when the first deployment succeeded
└── .deploy.lock, .deploy-in-progress
```

## Pipeline stages

1. **Checkout**: `checkout scm`; image tag `<sha>-<build>`; only `main` deploys.
2. **Validate**: `scripts/ci/validate.sh`: required files, no tracked `.env`, scripts parse, Dockerfile targets, `docker compose config -q` with placeholders.
3. **Install Dependencies**: Docker target `deps` (`npm ci` from the lockfile).
4. **Lint / Type Check / Test**: target `verify` (`npm run typecheck`, `npm test --if-present`).
5. **Application Build**: target `builder` (`next build`, standalone output).
6. **Docker Image Build**: target `runner`, tagged `avernek-expense-tracker:<sha>-<build>`. Targets reuse each other's layers: one install, one build.
7. **Prepare Deployment** (main only): preflight and first-deployment gate; `.env` bootstrap from the Jenkins credential if missing; `.env` and port validation; the verified release kept as the rollback target; `compose.yaml`, scripts and `.deployment.env` installed.
8. **Deploy**: `db` up and healthy; `pg_dump` backup (when the schema exists); `db/schema.sql` and new `db/migrations/*.sql` (each in one transaction, recorded in `schema_migrations`); `docker compose up -d`; administrator seeded.
9. **Health Check**: `bin/healthcheck.sh`; on success the release becomes `releases/verified`.
10. **Rollback on Failure**: diagnostics captured; `releases/verified` restored and health-checked. `ROLLBACK_STATUS`: `restored and verified`, `failed`, `no prior release` or `not required (server unchanged)`.
11. **Cleanup**: this project's old release images removed (newest 5 and every rollback image kept). No build-cache pruning.
12. **Notification** (top-level `post`): rollback after an abort, diagnostics archived, one Discord message, workspace wiped.

A failed deployment always ends as **FAILURE**, even when the rollback works.

## One-time setup

### Jenkins plugins

Install versions compatible with your Jenkins core (Manage Jenkins → Plugins):
**Pipeline**, **Git**, **GitHub** (webhook trigger), **Credentials Binding**,
**Workspace Cleanup** (`ws-cleanup`), **Timestamper**, **Discord Notifier**
(`discord-notifier`). Do not install or configure Slack: the old Slack
notification has been removed.

Set **Manage Jenkins → System → Jenkins URL** (for example
`https://jenkins.avernek.com/`) so notifications link to the build.

### Jenkins host

Jenkins runs the pipeline on the VPS itself (built images stay local).

```bash
# Docker Engine with the Compose v2 plugin (2.20 or newer), plus tools the scripts use
docker compose version
sudo apt-get install -y git curl util-linux iproute2   # flock, ss
sudo usermod -aG docker jenkins && sudo systemctl restart jenkins
```

Membership of the `docker` group is root-equivalent on the host: keep the
Jenkins controller and its credentials restricted to administrators.

### Deployment directory

`/srv` belongs to root, so Jenkins cannot create anything under it on its own.
Once per VPS (every project shares `/srv/deployments`), let the `jenkins`
group create project directories there:

```bash
# 1775: jenkins can create its project directories; the sticky bit stops it
# renaming or removing directories it does not own. Safe on an existing
# /srv/deployments: it changes only that directory, not the projects inside.
sudo install -d -o root -g jenkins -m 1775 /srv/deployments
```

The pipeline then creates `/srv/deployments/avernek-expense-tracker/` itself
(owner `jenkins`, mode 750) on its first run. If `/srv/deployments` must stay
root-only, create each project directory by hand instead:
`sudo install -d -o jenkins -g jenkins -m 750 /srv/deployments/avernek-expense-tracker`.

The pipeline never writes outside this directory (apart from images, containers
and the volume through Docker, and the shared lock file
`/run/lock/avernek-docker-build.lock`).

### Credentials (Manage Jenkins → Credentials → System → Global)

| ID | Kind | Content |
|---|---|---|
| `avernek-expense-tracker-env` | Secret file | A complete production `.env` (see `.env.example`). Used **only** to create `/srv/deployments/avernek-expense-tracker/.env` when it does not exist, or when a build runs with `SYNC_ENV_FROM_CREDENTIAL` ticked (the old file is backed up). The earlier pipeline used the same ID. |
| `discord-webhook-avernek` | Secret text | The full webhook URL of the deployment-alerts Discord channel. Shared by all Avernek project jobs. |

Restrict both to the jobs that need them where your Jenkins setup allows
(folder-scoped credentials). Never put the webhook URL in `.env`, the
repository or a console log.

### Jenkins job and GitHub webhook

1. New Item → **Pipeline** (or **Multibranch Pipeline**) → *Pipeline script from
   SCM*: Git, the repository URL, a GitHub credential, branch `*/main`, script
   path `Jenkinsfile`. Tick **GitHub hook trigger for GITScm polling**.
2. On GitHub: repository → Settings → Webhooks → Add webhook:
   Payload URL `https://<jenkins-host>/github-webhook/`, content type
   `application/json`, event **Just the push event**, active.
3. Branches other than `main` are built and tested but never deployed.

The pipeline uses `disableConcurrentBuilds()`: pushes during a build queue up.

### Caddy

The app listens on `127.0.0.1:<APP_PORT>` only. In `/etc/caddy/Caddyfile`:

```
expenses.avernek.com {
    encode zstd gzip
    reverse_proxy 127.0.0.1:3001    # the APP_PORT from .env
}
```

`sudo systemctl reload caddy` after editing.

## Configuration (`.env`)

The file lives at `/srv/deployments/avernek-expense-tracker/.env`, owner
`jenkins`, mode `600`. The pipeline validates it on every deployment (it fails
naming the missing variables, never printing values) and never overwrites it
silently. Required: `APP_PORT`, `DATABASE_URL`, `POSTGRES_USER`,
`POSTGRES_PASSWORD`, `POSTGRES_DB`, `SESSION_SECRET` (32+ characters),
`ADMIN_EMAIL`, `ADMIN_PASSWORD` (10+ characters), `CRON_SECRET`. Optional:
`PUBLIC_URL`, `DATABASE_SSL`, `DATABASE_POOL_MAX`, `ADMIN_NAME`,
`FX_CRON_SCHEDULE`. Descriptions are in `.env.example`.

- `DATABASE_URL` must use host `db` and the same user, password and database as
  `POSTGRES_*`.
- `POSTGRES_*` only take effect when the volume is first initialised.
- Every deployment resets the administrator's password to `ADMIN_PASSWORD` (the
  recovery path for a lost password).
- If a value contains `$`, wrap it in single quotes (Compose expands `$`).
- After editing: `./deploy-control.sh recreate` applies it (no rebuild needed).

### Port

`APP_PORT` has no default. Choose a host port no other application on the VPS
uses, and check before the first deployment:

```bash
sudo ss -ltnp 'sport = :3001'                  # nothing should be listening
docker ps --filter publish=3001                # no container should publish it
```

The earlier deployment of this app used **3001** (and Caddy already points
there); keep it when adopting that deployment. The pipeline refuses to deploy
if the port is used by anything other than this project.

## First deployment

The first deployment to `/srv/deployments/avernek-expense-tracker/` needs an
explicit approval file; until it exists, the pipeline stops in Prepare
Deployment without touching anything. Choose one of the two cases.

### Case A: taking over the existing deployment (expected)

The previous Jenkinsfile ran this app from
`$JENKINS_HOME/deployments/avernek-expense-tracker/` under the same Compose
project name, with its database in volume `avernek-expense-tracker_pgdata`. The
new pipeline keeps that project name and volume, so the data carries over.

```bash
JH=/var/lib/jenkins                                  # JENKINS_HOME
OLD=$JH/deployments/avernek-expense-tracker
NEW=/srv/deployments/avernek-expense-tracker
sudo install -d -o jenkins -g jenkins -m 750 $NEW   # the pipeline would create it, but files go in first

# 1. Look at what runs today.
docker ps --filter label=com.docker.compose.project=avernek-expense-tracker
docker volume inspect avernek-expense-tracker_pgdata --format '{{.Mountpoint}} {{.Labels}}'

# 2. Back the database up first, and copy the dump off the server.
sudo install -d -m 700 /var/backups/avernek-expense-tracker
docker exec avernek-postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' \
  | sudo tee /var/backups/avernek-expense-tracker/pre-adoption.dump >/dev/null

# 3. Move the configuration across, adding APP_PORT (the old Jenkinsfile set it).
sudo install -m 600 -o jenkins -g jenkins $OLD/.env $NEW/.env
echo 'APP_PORT=3001' | sudo tee -a $NEW/.env >/dev/null
echo 'PUBLIC_URL=https://expenses.avernek.com' | sudo tee -a $NEW/.env >/dev/null

# 4. Approve the takeover.
echo adopt-legacy | sudo -u jenkins tee $NEW/.first-deploy-approved
```

Then push to `main` (or click *Build Now*). The pipeline:

- recognises the old containers (same Compose project, other directory) and the
  volume, and accepts them because of `adopt-legacy`;
- records the old deployment's running image as the rollback target;
- backs up the database, applies any new migrations, and replaces the old
  containers with the new stack (same volume; a few seconds of downtime while
  the database container is recreated on the new network);
- verifies health; on failure it restores the old image under the new Compose
  file, with the same `.env`, port and volume.

Afterwards, once you are satisfied:

```bash
sudo rm -rf $OLD                                  # old compose copy and its .env (secrets)
docker network rm avernek-expense-tracker_default 2>/dev/null || true   # old network, if unused
docker images avernek-expense-tracker              # old numeric tags (:12, :latest) can go
```

The image tags of the old pipeline (`:<build-number>`, `:latest`) are never
removed automatically; delete them by hand when no longer needed.

### Case B: a brand-new installation (empty database)

```bash
NEW=/srv/deployments/avernek-expense-tracker
sudo install -d -o jenkins -g jenkins -m 750 $NEW   # the pipeline would create it, but files go in first
# Option 1: let the pipeline create .env from the Jenkins credential (it must contain APP_PORT).
# Option 2: create it yourself:
sudo install -m 600 -o jenkins -g jenkins /dev/null $NEW/.env
sudoedit $NEW/.env                                  # fill in from .env.example
echo new | sudo -u jenkins tee $NEW/.first-deploy-approved
```

The pipeline refuses `new` if the Compose project is already running or the
volume already exists (it would otherwise reuse unknown data). The empty volume
is initialised once, from `POSTGRES_*`; `db/schema.sql` and all migrations run;
the administrator is created.

### What the preflight checks

Docker access for `jenkins`; Compose 2.20+; `flock`, `ss`, `curl`; the deployment
directory exists and is writable; approval present and consistent with what is
on the host; the volume is not another project's; every required `.env`
variable is set; `APP_PORT` is not used by anything else. Each failure prints
the command that fixes it. On success the approval file is renamed to
`.first-deploy-approved.used` and `.activated` is written; later deployments
need no approval.

A failed first deployment of a new installation has no earlier release to go
back to: the pipeline reports `Rollback: no prior release` and leaves the
failed release in place for inspection (`./deploy-control.sh status`, `logs`).

## Managing the application

All commands run in the deployment directory, as `jenkins` (or root), without
the source code:

```bash
cd /srv/deployments/avernek-expense-tracker
sudo -u jenkins ./deploy-control.sh status          # containers, health, deployed / verified / previous release
sudo -u jenkins ./deploy-control.sh logs web -f     # logs (web, db, fx-cron)
sudo -u jenkins ./deploy-control.sh restart         # restart in place
sudo -u jenkins ./deploy-control.sh stop            # stop (data kept)
sudo -u jenkins ./deploy-control.sh start           # start again
sudo -u jenkins ./deploy-control.sh recreate        # recreate web + fx-cron (after editing .env)
sudo -u jenkins ./deploy-control.sh health          # run the post-deployment checks
sudo -u jenkins ./deploy-control.sh backup          # pg_dump into backups/
sudo -u jenkins ./deploy-control.sh rollback        # back to the previous verified release
sudo -u jenkins ./deploy-control.sh images          # images, and which ones rollback needs
```

It always uses Compose project `avernek-expense-tracker`, `compose.yaml`, `.env`
and `.deployment.env`, refuses to act while a pipeline deployment is running,
and never removes volumes. Equivalent raw command, if ever needed:

```bash
docker compose -p avernek-expense-tracker --project-directory . -f compose.yaml \
  --env-file .env --env-file .deployment.env ps
```

Never run `docker compose down -v`, `docker volume prune` or
`docker system prune -a --volumes` on this server: they delete databases.

## Rollback and recovery

- **Automatic**: a failed Prepare, Deploy or Health Check restores
  `releases/verified` (compose file, image reference, cron script) and verifies
  it. The build stays FAILED; Discord shows the rollback outcome.
- **Manual**: `./deploy-control.sh rollback` restores `releases/prior`, verifies
  it, and swaps the two (running it again rolls forward).
- **Database**: rolling back the application does not undo migrations. Each
  deployment that runs migrations first writes `backups/<project>-<time>-pre-deploy-b<build>.dump`.
  Write migrations so the previous release still works with the new schema
  (add columns and tables; drop them in a later release). To return the
  database to a backup:

  ```bash
  cd /srv/deployments/avernek-expense-tracker
  sudo -u jenkins ./deploy-control.sh stop
  docker compose -p avernek-expense-tracker --project-directory . -f compose.yaml \
    --env-file .env --env-file .deployment.env up -d db
  # Restore into the same database (drops and recreates the objects it contains):
  docker compose -p avernek-expense-tracker --project-directory . -f compose.yaml \
    --env-file .env --env-file .deployment.env exec -T db \
    sh -c 'pg_restore --clean --if-exists --no-owner -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
    < backups/<file>.dump
  sudo -u jenkins ./deploy-control.sh start && sudo -u jenkins ./deploy-control.sh health
  ```

- **Stale lock**: if a build was killed mid-deployment, `deploy-control.sh`
  refuses to run until `.deploy-in-progress` is removed. Confirm no build is
  running, then `rm .deploy-in-progress`.

Images needed for rollback (deployed, `releases/verified`, `releases/prior`) are
never removed by the pipeline.

## Volumes and data

- `avernek-expense-tracker_pgdata` holds the database. It survives restarts,
  container recreation, image replacement and `docker compose down` (without
  `-v`). The Compose file names it explicitly, so a wrong project name cannot
  silently create an empty second database.
- The database is only reachable on the internal `backend` network; no
  database port is published on the host.
- The app stores no files; there is no uploads volume.
- Docker logs: driver `local`, 3 files of 10 MB per container.

## Backups

`backups/` holds dumps made before every migration run, plus manual ones
(`./deploy-control.sh backup`); the newest 14 are kept (`BACKUP_KEEP`). These sit
on the same disk as the database: **copy them off the VPS**. A daily example
(root crontab):

```
30 21 * * * cd /srv/deployments/avernek-expense-tracker && sudo -u jenkins ./deploy-control.sh backup daily && rsync -a backups/ backup-host:/backups/avernek-expense-tracker/
```

Test a restore into a scratch database periodically: a backup that has never
been restored is not known to work.

## Build cache

The shared VPS keeps BuildKit cache under **8 GB per shared builder**, trimmed
centrally:

```bash
docker buildx prune --force --max-used-space 8gb
```

This pipeline never prunes the cache, images of other projects, volumes or
networks. Install the central job once per VPS:

```bash
sudo install -m 755 scripts/docker-cache-maintenance.sh /usr/local/sbin/docker-cache-maintenance.sh
```

and run it from one place only, for example a nightly systemd timer
(`/etc/systemd/system/docker-cache-maintenance.{service,timer}`:
`ExecStart=/usr/local/sbin/docker-cache-maintenance.sh`, `OnCalendar=*-*-* 03:30`)
or a dedicated Jenkins job. It takes `/run/lock/avernek-docker-build.lock`
exclusively; every project build holds it shared, so trimming never runs during
a build. It uses `--keep-storage` on older Buildx versions that lack
`--max-used-space`.

## Verifying a deployment

1. The Jenkins build is green, and the console shows `All health checks passed.`
   and `Release verified: avernek-expense-tracker:<sha>-<build>`.
2. Discord shows `Result: SUCCESS`, `Deployment: deployed and verified`.
3. On the server:
   ```bash
   cd /srv/deployments/avernek-expense-tracker
   sudo -u jenkins ./deploy-control.sh status     # web, db healthy; fx-cron running
   sudo -u jenkins ./deploy-control.sh health
   curl -fsS https://expenses.avernek.com/api/health
   ```
4. Sign in at https://expenses.avernek.com/login.

If the health check prints `WARN /login does not show the sign-in form`, the
app is serving every visitor without a sign-in: `src/lib/auth/bypass.ts`
returns `true`. Set it back to `false` before the site is reachable publicly.

## Discord notifications

Every build sends exactly one message to the deployment-alerts channel, from
the top-level `post` block: job, build number, result, branch, commit, release
tag, deployment outcome and rollback outcome. It contains no secrets, customer
data or exception text. A failure to post is logged as a warning and never
changes the build result.

**Channel ownership**: the deployment-alerts channel and its webhook belong to
the Avernek DevOps owner. To rotate the webhook: create a new one in Discord
(channel → Edit → Integrations → Webhooks), update the `discord-webhook-avernek`
credential, delete the old webhook.

**Prerequisites**: the Discord Notifier plugin, the Secret text credential
`discord-webhook-avernek`, the Jenkins URL set, and outbound HTTPS from the
Jenkins controller to `discord.com` (configure the proxy under Manage Jenkins →
Plugins → Advanced if one is required).

**Stand-alone test** (sends one harmless message, deploys nothing, never prints
the webhook). From an administrator workstation with the Jenkins CLI:

```bash
# A protected file holding "username:api-token" (mode 600) keeps the token out of shell history.
java -jar jenkins-cli.jar -s "https://YOUR-JENKINS-URL/" \
  -auth @"$HOME/.jenkins-cli-auth" \
  groovy = < scripts/test-discord-notification.groovy
```

`OK: Discord accepted the test message` means the credential and network work.
This does not exercise the plugin itself; the next pipeline run does.

**Troubleshooting**

| Console / output | Cause |
|---|---|
| `WARNING: Discord notification could not be sent` | Credential missing or misnamed, plugin not installed, or no egress. Run the CLI test. |
| `FAILED: no Secret text credential` | Create `discord-webhook-avernek` (kind Secret text) in the global store. |
| `FAILED: Discord answered HTTP 401/404` | The webhook was deleted or the URL is wrong. |
| `HTTP 429` | Rate limited; retry later. |
| No link in the message | Set the Jenkins URL in the system configuration. |

## Troubleshooting deployments

| Symptom | Fix |
|---|---|
| `… /srv/deployments is not writable by jenkins` (or `does not exist`) | One-time VPS setup: "Deployment directory" above. |
| `first deployment is not approved` | Follow "First deployment" and write `.first-deploy-approved`. |
| `missing or empty in .env: …` | Edit `/srv/deployments/avernek-expense-tracker/.env`. |
| `host port … is in use` | Choose a free `APP_PORT`, update Caddy, rebuild. |
| `Compose project … has containers running from another directory` | The old stack is still running next to the new one: stop it (`docker compose -p avernek-expense-tracker -f $OLD/docker-compose.yml stop`). |
| `db did not become healthy` | `./deploy-control.sh logs db`; disk space; volume permissions. |
| Health check fails on `/login` | The app started but cannot render: `./deploy-control.sh logs web`. |
| Build waits on `build-cache maintenance` | The central cache job is running; it releases the lock when done. |
| Diagnostics | Each failed deployment archives `diagnostics/` (container state and logs) on the Jenkins build page. |
