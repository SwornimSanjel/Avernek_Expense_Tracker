// CI/CD for the Avernek Expense Tracker.
//
// Flow: pull the .env out of a Jenkins "Secret file" credential -> build the
// multi-stage image (the .env is passed as a BuildKit secret, never baked into
// a layer) -> roll it out with docker compose on this host -> smoke test ->
// roll back automatically if the new container does not come up healthy.
//
// One-time setup on the Jenkins host:
//   1. Jenkins -> Credentials -> Add -> Kind "Secret file", upload your .env,
//      ID: avernek-expense-tracker-env
//   2. sudo mkdir -p /opt/avernek-expense-tracker
//      sudo chown jenkins:jenkins /opt/avernek-expense-tracker
//   3. sudo usermod -aG docker jenkins && sudo systemctl restart jenkins
//   4. Agent needs: docker (with compose v2), git, curl.
//
// `next build` type-checks the project, so a TS error fails the Build stage.

pipeline {
  agent any

  options {
    timestamps()
    // Two deploys racing on the same compose project corrupts the rollout.
    disableConcurrentBuilds()
    timeout(time: 30, unit: 'MINUTES')
    buildDiscarder(logRotator(numToKeepStr: '20'))
  }

  environment {
    APP_NAME       = 'avernek-expense-tracker'
    DEPLOY_DIR     = '/opt/avernek-expense-tracker'
    ENV_CREDENTIAL = 'avernek-expense-tracker-env'

    // Host port the container is published on (loopback only by default --
    // see docker-compose.yml). Put a reverse proxy in front for TLS.
    APP_PORT = '3000'

    IMAGE        = "avernek-expense-tracker:${env.BUILD_NUMBER}"
    IMAGE_LATEST = 'avernek-expense-tracker:latest'

    // How many numbered images to keep on the host for rollbacks.
    KEEP_IMAGES = '5'

    DOCKER_BUILDKIT = '1'
  }

  stages {

    stage('Checkout') {
      steps {
        checkout scm
        sh 'git --no-pager log -1 --pretty="Building %h  %s  (%an)"'
      }
    }

    stage('Extract .env') {
      steps {
        // withCredentials drops the file in a temp path and masks it in logs.
        // We copy it into the workspace at 0600 for the build, and the post
        // block deletes it whatever happens.
        withCredentials([file(credentialsId: env.ENV_CREDENTIAL, variable: 'ENV_FILE')]) {
          sh '''
            set -eu
            install -m 600 "$ENV_FILE" .env
            # A .env uploaded from Windows carries CRLF, and the \r ends up
            # inside the secret values themselves.
            sed -i 's/\r$//' .env

            # Fail early with a clear message rather than shipping a container
            # that 500s on the first request.
            for key in NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_ANON_KEY \
                       SUPABASE_SERVICE_ROLE_KEY CRON_SECRET; do
              if ! grep -qE "^${key}=.+" .env; then
                echo "ERROR: ${key} is missing or empty in the ${ENV_CREDENTIAL:-secret} .env"
                exit 1
              fi
            done
            echo "Extracted .env with $(grep -cE '^[A-Z_]+=' .env) variables."
          '''
        }
      }
    }

    stage('Build image') {
      steps {
        sh '''
          set -eu
          # Build through Compose so CI exercises the same definition used by
          # `docker compose up --build -d` locally. The numbered IMAGE value is
          # consumed by docker-compose.yml; keep :latest as a convenience tag.
          docker compose build web
          docker tag "$IMAGE" "$IMAGE_LATEST"
          docker image inspect "$IMAGE" --format 'Built {{.RepoTags}}  size {{.Size}} bytes'
        '''
      }
    }

    stage('Deploy') {
      steps {
        sh '''
          set -eu
          mkdir -p "$DEPLOY_DIR/docker"

          # Record what is running now so a failed smoke test can roll back.
          # The build number comes from the image label set below, which is
          # more reliable than .Config.Image (Docker may store a digest there).
          # A stale .previous-image would roll back to a pruned tag, so the file
          # is removed unless we can confirm the target image still exists.
          PREV_BUILD="$(docker inspect --format '{{index .Config.Labels "jenkins.build"}}' "$APP_NAME" 2>/dev/null || true)"
          if [ -n "$PREV_BUILD" ] && [ "$PREV_BUILD" != "$BUILD_NUMBER" ] \
             && docker image inspect "$APP_NAME:$PREV_BUILD" >/dev/null 2>&1; then
            echo "$APP_NAME:$PREV_BUILD" > "$DEPLOY_DIR/.previous-image"
            echo "Current release: $APP_NAME:$PREV_BUILD (rollback target)"
          else
            rm -f "$DEPLOY_DIR/.previous-image"
            echo "No rollback target: first deploy, or the previous image was pruned."
          fi

          install -m 644 docker-compose.yml "$DEPLOY_DIR/docker-compose.yml"
          install -m 755 docker/fx-cron.sh  "$DEPLOY_DIR/docker/fx-cron.sh"
          # 0600: this file holds the service-role key.
          install -m 600 .env               "$DEPLOY_DIR/.env"

          # Explicit -f/--project-directory so the deploy never depends on the
          # Jenkins workspace, and so ./docker/fx-cron.sh and .env resolve
          # against DEPLOY_DIR. IMAGE and APP_PORT are already exported, and the
          # shell environment beats the .env file for compose interpolation.
          dc() {
            docker compose -f "$DEPLOY_DIR/docker-compose.yml" \
                           --project-directory "$DEPLOY_DIR" \
                           -p "$APP_NAME" "$@"
          }

          dc up -d --remove-orphans
          dc ps
        '''
      }
    }

    stage('Smoke test') {
      steps {
        sh '''
          set -eu
          echo "Waiting for /api/health on port $APP_PORT ..."
          for attempt in $(seq 1 30); do
            if curl -fsS "http://127.0.0.1:${APP_PORT}/api/health" >/dev/null 2>&1; then
              echo "Healthy after ${attempt} attempt(s)."
              curl -fsS "http://127.0.0.1:${APP_PORT}/api/health"; echo
              exit 0
            fi
            sleep 2
          done

          echo "Health check never passed. Last 80 log lines:"
          docker logs --tail 80 "$APP_NAME" 2>&1 || true
          exit 1
        '''
      }
      post {
        failure {
          sh '''
            set -eu
            if [ ! -f "$DEPLOY_DIR/.previous-image" ]; then
              echo "No previous release recorded -- leaving the failed container up for inspection."
              exit 0
            fi
            PREVIOUS="$(cat "$DEPLOY_DIR/.previous-image")"
            echo "Rolling back to $PREVIOUS"

            dc() {
              docker compose -f "$DEPLOY_DIR/docker-compose.yml" \
                             --project-directory "$DEPLOY_DIR" \
                             -p "$APP_NAME" "$@"
            }

            export IMAGE="$PREVIOUS"
            dc up -d --remove-orphans
            dc ps
          '''
        }
      }
    }

    stage('Prune old images') {
      steps {
        sh '''
          set -eu
          # Keep the newest $KEEP_IMAGES numbered tags so rollbacks stay possible.
          docker images "$APP_NAME" --format '{{.Tag}}' \
            | grep -E '^[0-9]+$' \
            | sort -rn \
            | tail -n +$((KEEP_IMAGES + 1)) \
            | while read -r tag; do
                echo "Removing $APP_NAME:$tag"
                docker rmi "$APP_NAME:$tag" >/dev/null 2>&1 || true
              done
          docker image prune -f >/dev/null
        '''
      }
    }
  }

  post {
    always {
      // The workspace copy of the secret must not outlive the build.
      sh 'rm -f .env'
    }
    success {
      echo "Deployed ${env.IMAGE} -> http://127.0.0.1:${env.APP_PORT}"
    }
    failure {
      echo "Build ${env.BUILD_NUMBER} failed. If the rollback ran, the previous release is live."
    }
  }
}
