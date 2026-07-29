// CI/CD pipeline for the Avernek Expense Tracker.
//
// Flow:
//   Checkout
//   -> extract .env from Jenkins credentials
//   -> build versioned Docker image
//   -> deploy through Docker Compose
//   -> smoke test
//   -> automatically restore the previous release if deployment fails
//   -> prune old images
//
// One-time Jenkins host requirements:
//   1. Add Jenkins credential:
//        Kind: Secret file
//        ID: avernek-expense-tracker-env
//        File: production .env
//
//   2. Allow Jenkins to access Docker:
//        sudo usermod -aG docker jenkins
//        sudo systemctl restart jenkins
//
//   3. Install:
//        docker with Compose v2
//        git
//        curl
//
// Deployment files are stored inside JENKINS_HOME, so Jenkins creates and
// manages the deployment directory without root permissions.
//
// `next build` type-checks the application. TypeScript errors fail the build.
//
// NOTE: every sh step keeps the bash shebang on the same line as the opening
// triple quote. Jenkins honours a shebang only when it is the first byte of
// the script; if the shebang is moved onto its own indented line, Jenkins
// silently runs the script with /bin/sh -xe (dash on Debian/Ubuntu) and it
// fails on `set -o pipefail`, `[[ ]]`, arrays and `mapfile`.
// Do not re-indent those lines.

pipeline {
  agent any

  options {
    timestamps()
    disableConcurrentBuilds()
    timeout(time: 30, unit: 'MINUTES')
    buildDiscarder(logRotator(numToKeepStr: '20'))
  }

  environment {
    APP_NAME = 'avernek-expense-tracker'

    // Relative to JENKINS_HOME. Do not use /opt unless Jenkins is explicitly
    // granted root-level permission to write there.
    DEPLOY_SUBDIR = 'deployments/avernek-expense-tracker'

    ENV_CREDENTIAL = 'avernek-expense-tracker-env'

    // Host-side published port only; the container still listens on 3000
    // internally. Change this if the host port is already taken.
    APP_PORT        = '3001'

    IMAGE        = "avernek-expense-tracker:${env.BUILD_NUMBER}"
    IMAGE_LATEST = 'avernek-expense-tracker:latest'

    KEEP_IMAGES = '5'

    DOCKER_BUILDKIT = '1'
  }

  stages {

    stage('Checkout') {
      steps {
        checkout scm

        sh '''#!/usr/bin/env bash
          set -Eeuo pipefail

          git --no-pager log -1 \
            --pretty="Building %h  %s  (%an)"
        '''
      }
    }

    stage('Extract .env') {
      steps {
        withCredentials([
          file(
            credentialsId: env.ENV_CREDENTIAL,
            variable: 'ENV_FILE'
          )
        ]) {
          sh '''#!/usr/bin/env bash
            set -Eeuo pipefail

            install -m 600 "$ENV_FILE" .env

            # Remove Windows CRLF characters.
            sed -i 's/\\r$//' .env

            required_keys=(
              NEXT_PUBLIC_SUPABASE_URL
              NEXT_PUBLIC_SUPABASE_ANON_KEY
              SUPABASE_SERVICE_ROLE_KEY
              CRON_SECRET
            )

            for key in "${required_keys[@]}"; do
              if ! grep -qE "^${key}=.+" .env; then
                echo "ERROR: ${key} is missing or empty in the Jenkins .env credential."
                exit 1
              fi
            done

            variable_count="$(
              grep -cE '^[A-Za-z_][A-Za-z0-9_]*=' .env || true
            )"

            echo "Extracted .env with ${variable_count} variables."
          '''
        }
      }
    }

    stage('Build image') {
      steps {
        sh '''#!/usr/bin/env bash
          set -Eeuo pipefail

          echo "Building image: $IMAGE"

          docker compose build web

          docker image tag \
            "$IMAGE" \
            "$IMAGE_LATEST"

          docker image inspect "$IMAGE" \
            --format 'Built {{join .RepoTags ", "}} — {{.Size}} bytes'
        '''
      }
    }

    stage('Deploy') {
      steps {
        sh '''#!/usr/bin/env bash
          set -Eeuo pipefail

          : "${JENKINS_HOME:?JENKINS_HOME is not defined}"

          DEPLOY_DIR="${JENKINS_HOME}/${DEPLOY_SUBDIR}"

          echo "Deployment directory: $DEPLOY_DIR"

          # Jenkins owns JENKINS_HOME, so this requires no sudo.
          mkdir -p \
            "$DEPLOY_DIR/docker"

          # Remove any marker left by an interrupted older build.
          rm -f "$DEPLOY_DIR/.deployment-attempted"

          # ----------------------------------------------------------
          # Save the currently deployed configuration for rollback.
          # ----------------------------------------------------------

          ROLLBACK_TMP="$DEPLOY_DIR/.rollback.tmp"
          ROLLBACK_DIR="$DEPLOY_DIR/.rollback"

          rm -rf "$ROLLBACK_TMP"
          mkdir -p "$ROLLBACK_TMP/docker"

          if [[ -f "$DEPLOY_DIR/docker-compose.yml" ]]; then
            install -m 644 \
              "$DEPLOY_DIR/docker-compose.yml" \
              "$ROLLBACK_TMP/docker-compose.yml"
          fi

          if [[ -f "$DEPLOY_DIR/.env" ]]; then
            install -m 600 \
              "$DEPLOY_DIR/.env" \
              "$ROLLBACK_TMP/.env"
          fi

          if [[ -f "$DEPLOY_DIR/docker/fx-cron.sh" ]]; then
            install -m 755 \
              "$DEPLOY_DIR/docker/fx-cron.sh" \
              "$ROLLBACK_TMP/docker/fx-cron.sh"
          fi

          rm -rf "$ROLLBACK_DIR"
          mv "$ROLLBACK_TMP" "$ROLLBACK_DIR"

          # ----------------------------------------------------------
          # Determine the currently deployed image.
          # ----------------------------------------------------------

          CURRENT_IMAGE=""

          CURRENT_CONTAINER="$(
            docker ps -aq \
              --filter "label=com.docker.compose.project=$APP_NAME" \
              --filter "label=com.docker.compose.service=web" \
              | head -n 1
          )"

          if [[ -n "$CURRENT_CONTAINER" ]]; then
            CURRENT_IMAGE="$(
              docker inspect \
                --format '{{.Config.Image}}' \
                "$CURRENT_CONTAINER"
            )"
          elif [[ -s "$DEPLOY_DIR/.current-image" ]]; then
            CURRENT_IMAGE="$(
              cat "$DEPLOY_DIR/.current-image"
            )"
          fi

          if [[ -n "$CURRENT_IMAGE" ]] \
             && [[ "$CURRENT_IMAGE" != "$IMAGE" ]] \
             && docker image inspect "$CURRENT_IMAGE" >/dev/null 2>&1; then

            printf '%s\\n' "$CURRENT_IMAGE" \
              > "$DEPLOY_DIR/.previous-image"

            echo "Current release:  $CURRENT_IMAGE"
            echo "Rollback target:  $CURRENT_IMAGE"
          else
            rm -f "$DEPLOY_DIR/.previous-image"
            echo "No valid rollback image found."
          fi

          # ----------------------------------------------------------
          # Install the new release configuration.
          # ----------------------------------------------------------

          install -m 644 \
            docker-compose.yml \
            "$DEPLOY_DIR/docker-compose.yml"

          install -m 755 \
            docker/fx-cron.sh \
            "$DEPLOY_DIR/docker/fx-cron.sh"

          install -m 600 \
            .env \
            "$DEPLOY_DIR/.env"

          dc() {
            docker compose \
              -f "$DEPLOY_DIR/docker-compose.yml" \
              --project-directory "$DEPLOY_DIR" \
              -p "$APP_NAME" \
              "$@"
          }

          # The global `post unsuccessful` block checks this marker before
          # attempting a rollback.
          touch "$DEPLOY_DIR/.deployment-attempted"

          echo "Deploying $IMAGE"

          dc up -d --remove-orphans
          dc ps
        '''
      }
    }

    stage('Smoke test') {
      steps {
        sh '''#!/usr/bin/env bash
          set -Eeuo pipefail

          DEPLOY_DIR="${JENKINS_HOME}/${DEPLOY_SUBDIR}"

          dc() {
            docker compose \
              -f "$DEPLOY_DIR/docker-compose.yml" \
              --project-directory "$DEPLOY_DIR" \
              -p "$APP_NAME" \
              "$@"
          }

          HEALTH_URL="http://127.0.0.1:${APP_PORT}/api/health"

          echo "Waiting for $HEALTH_URL ..."

          for attempt in $(seq 1 30); do
            if curl -fsS "$HEALTH_URL" >/dev/null 2>&1; then
              echo "Application became healthy after ${attempt} attempt(s)."

              curl -fsS "$HEALTH_URL"
              echo

              # Record the successful release atomically.
              printf '%s\\n' "$IMAGE" \
                > "$DEPLOY_DIR/.current-image.tmp"

              mv \
                "$DEPLOY_DIR/.current-image.tmp" \
                "$DEPLOY_DIR/.current-image"

              rm -f "$DEPLOY_DIR/.deployment-attempted"

              echo "Release confirmed: $IMAGE"
              exit 0
            fi

            sleep 2
          done

          echo "ERROR: Health check did not pass within 60 seconds."
          echo "Last 80 container log lines:"

          dc logs --tail 80 web || true

          exit 1
        '''
      }
    }

    stage('Prune old images') {
      steps {
        sh '''#!/usr/bin/env bash
          set -Eeuo pipefail

          DEPLOY_DIR="${JENKINS_HOME}/${DEPLOY_SUBDIR}"

          CURRENT_IMAGE=""
          PREVIOUS_IMAGE=""

          if [[ -s "$DEPLOY_DIR/.current-image" ]]; then
            CURRENT_IMAGE="$(cat "$DEPLOY_DIR/.current-image")"
          fi

          if [[ -s "$DEPLOY_DIR/.previous-image" ]]; then
            PREVIOUS_IMAGE="$(cat "$DEPLOY_DIR/.previous-image")"
          fi

          mapfile -t NUMBERED_TAGS < <(
            docker images "$APP_NAME" \
              --format '{{.Tag}}' \
              | grep -E '^[0-9]+$' \
              | sort -rn \
              || true
          )

          for ((index = KEEP_IMAGES; index < ${#NUMBERED_TAGS[@]}; index++)); do
            tag="${NUMBERED_TAGS[$index]}"
            candidate="$APP_NAME:$tag"

            if [[ "$candidate" == "$CURRENT_IMAGE" ]] \
               || [[ "$candidate" == "$PREVIOUS_IMAGE" ]]; then
              echo "Keeping rollback-related image: $candidate"
              continue
            fi

            echo "Removing old image: $candidate"
            docker image rm "$candidate" >/dev/null 2>&1 || true
          done

          docker image prune -f >/dev/null

          echo "Retained application images:"
          docker images "$APP_NAME" \
            --format '  {{.Repository}}:{{.Tag}}  {{.Size}}'
        '''
      }
    }
  }

  post {

    unsuccessful {
      sh '''#!/usr/bin/env bash
        set -Eeuo pipefail

        DEPLOY_DIR="${JENKINS_HOME}/${DEPLOY_SUBDIR}"
        ATTEMPT_MARKER="$DEPLOY_DIR/.deployment-attempted"

        # The failure happened before deployment started.
        if [[ ! -f "$ATTEMPT_MARKER" ]]; then
          echo "Deployment was not started; rollback is unnecessary."
          exit 0
        fi

        if [[ ! -s "$DEPLOY_DIR/.previous-image" ]]; then
          echo "No previous image exists."
          echo "Leaving the failed deployment available for inspection."

          rm -f "$ATTEMPT_MARKER"
          exit 0
        fi

        PREVIOUS_IMAGE="$(
          cat "$DEPLOY_DIR/.previous-image"
        )"

        if ! docker image inspect "$PREVIOUS_IMAGE" >/dev/null 2>&1; then
          echo "ERROR: Rollback image no longer exists: $PREVIOUS_IMAGE"
          exit 1
        fi

        ROLLBACK_DIR="$DEPLOY_DIR/.rollback"

        if [[ ! -f "$ROLLBACK_DIR/docker-compose.yml" ]] \
           || [[ ! -f "$ROLLBACK_DIR/.env" ]]; then
          echo "ERROR: Previous deployment configuration is unavailable."
          echo "Cannot safely roll back using only the previous image."
          exit 1
        fi

        echo "Restoring previous configuration."

        install -m 644 \
          "$ROLLBACK_DIR/docker-compose.yml" \
          "$DEPLOY_DIR/docker-compose.yml"

        install -m 600 \
          "$ROLLBACK_DIR/.env" \
          "$DEPLOY_DIR/.env"

        rm -f "$DEPLOY_DIR/docker/fx-cron.sh"

        if [[ -f "$ROLLBACK_DIR/docker/fx-cron.sh" ]]; then
          install -m 755 \
            "$ROLLBACK_DIR/docker/fx-cron.sh" \
            "$DEPLOY_DIR/docker/fx-cron.sh"
        fi

        dc() {
          docker compose \
            -f "$DEPLOY_DIR/docker-compose.yml" \
            --project-directory "$DEPLOY_DIR" \
            -p "$APP_NAME" \
            "$@"
        }

        echo "Rolling back to $PREVIOUS_IMAGE"

        export IMAGE="$PREVIOUS_IMAGE"

        dc up -d --remove-orphans
        dc ps

        printf '%s\\n' "$PREVIOUS_IMAGE" \
          > "$DEPLOY_DIR/.current-image.tmp"

        mv \
          "$DEPLOY_DIR/.current-image.tmp" \
          "$DEPLOY_DIR/.current-image"

        rm -f "$ATTEMPT_MARKER"

        echo "Rollback completed: $PREVIOUS_IMAGE"
      '''
    }

    always {
      sh '''#!/usr/bin/env bash
        rm -f .env
      '''
    }

    success {
      echo "Deployed ${env.IMAGE} -> http://127.0.0.1:${env.APP_PORT}"
    }

    failure {
      echo "Build ${env.BUILD_NUMBER} failed. Check the rollback output above."
    }

    aborted {
      echo "Build ${env.BUILD_NUMBER} was aborted."
    }
  }
}