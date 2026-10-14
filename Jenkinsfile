// Avernek Expense Tracker: CI/CD pipeline (Avernek Technologies deployment standard).
//
//   GitHub push -> Checkout -> Validate -> Install Dependencies -> Lint / Type Check / Test
//   -> Application Build -> Docker Image Build -> Prepare Deployment -> Deploy
//   -> Health Check -> Rollback on Failure -> Cleanup -> Notification (post)
//
// The app runs from /srv/deployments/avernek-expense-tracker/ (compose.yaml, .env,
// .deployment.env), never from this workspace, which is wiped after every build.
// Only the DEPLOY_BRANCH deploys; other branches stop after the image build.
//
// Server and Jenkins setup, the first-deployment approval, operations and
// recovery: docs/DEPLOYMENT.md. The deployment logic itself is in
// scripts/ci/release.sh; images are built by scripts/ci/build.sh.
//
// Jenkins plugins: Pipeline, Git, GitHub, Credentials Binding, Workspace Cleanup,
// Timestamper, Discord Notifier.
// Credentials: 'avernek-expense-tracker-env' (Secret file, bootstraps .env only),
//              'discord-webhook-avernek' (Secret text, Discord webhook URL).

pipeline {
  agent any

  options {
    skipDefaultCheckout(true)
    disableConcurrentBuilds()
    timestamps()
    timeout(time: 45, unit: 'MINUTES')
    buildDiscarder(logRotator(numToKeepStr: '30', artifactNumToKeepStr: '10'))
  }

  triggers {
    githubPush()
  }

  parameters {
    booleanParam(
      name: 'SYNC_ENV_FROM_CREDENTIAL',
      defaultValue: false,
      description: 'Replace the server .env with the Jenkins credential "avernek-expense-tracker-env" (the current .env is backed up first). Off: the server .env is kept as it is.'
    )
  }

  environment {
    PROJECT_NAME        = 'avernek-expense-tracker'
    IMAGE_REPO          = 'avernek-expense-tracker'
    DEPLOY_ROOT         = '/srv/deployments'
    DEPLOY_DIR          = '/srv/deployments/avernek-expense-tracker'
    DEPLOY_BRANCH       = 'main'
    ENV_CREDENTIAL_ID   = 'avernek-expense-tracker-env'
    KEEP_RELEASE_IMAGES = '5'
    HEALTH_TIMEOUT      = '180'
    DOCKER_BUILDKIT     = '1'
    // Mutable state (ROLLBACK_STATUS, DEPLOY_*) is set in script blocks, not
    // here: values declared in this block cannot be reassigned later.
  }

  stages {

    stage('Checkout') {
      steps {
        script {
          def scmVars = checkout scm
          env.GIT_COMMIT = scmVars.GIT_COMMIT
          env.GIT_URL = scmVars.GIT_URL ?: ''
          def branch = env.BRANCH_NAME ?: (scmVars.GIT_BRANCH ?: '')
          env.SOURCE_BRANCH = branch.replaceFirst(/^origin\//, '').replaceFirst(/^refs\/heads\//, '')
          env.GIT_SHORT = sh(script: 'git rev-parse --short=12 HEAD', returnStdout: true).trim()
          env.IMAGE_TAG = "${env.GIT_SHORT}-${env.BUILD_NUMBER}"
          env.APP_IMAGE = "${env.IMAGE_REPO}:${env.IMAGE_TAG}"
          env.DEPLOY_ENABLED = (env.SOURCE_BRANCH == env.DEPLOY_BRANCH) ? 'true' : 'false'
          env.DEPLOY_STARTED = 'false'
          env.DEPLOY_FAILED = 'false'
          env.ROLLBACK_ATTEMPTED = 'false'
          env.ROLLBACK_STATUS = 'not required'
        }
        sh 'git --no-pager log -1 --pretty="Building %h  %s  (%an)"'
        echo "Branch ${env.SOURCE_BRANCH}; image ${env.APP_IMAGE}; deploy: ${env.DEPLOY_ENABLED}"
      }
    }

    stage('Validate') {
      steps {
        sh 'bash scripts/ci/validate.sh'
      }
    }

    stage('Install Dependencies') {
      steps {
        sh 'bash scripts/ci/build.sh deps'
      }
    }

    stage('Lint / Type Check / Test') {
      steps {
        // tsc --noEmit and `npm test` when a test script exists. The project has
        // no ESLint configuration, so there is no lint step (see the Dockerfile).
        sh 'bash scripts/ci/build.sh verify'
      }
    }

    stage('Application Build') {
      steps {
        sh 'bash scripts/ci/build.sh builder'
      }
    }

    stage('Docker Image Build') {
      steps {
        sh 'bash scripts/ci/build.sh runner "$APP_IMAGE"'
      }
    }

    stage('Prepare Deployment') {
      when { expression { env.DEPLOY_ENABLED == 'true' } }
      steps {
        script {
          deployStep('Prepare Deployment') {
            sh 'bash scripts/ci/release.sh preflight'
            boolean hasEnv = sh(script: 'test -f "$DEPLOY_DIR/.env"', returnStatus: true) == 0
            if (!hasEnv || params.SYNC_ENV_FROM_CREDENTIAL) {
              withCredentials([file(credentialsId: env.ENV_CREDENTIAL_ID, variable: 'ENV_SOURCE')]) {
                withEnv(["SYNC_ENV_FROM_CREDENTIAL=${params.SYNC_ENV_FROM_CREDENTIAL}"]) {
                  sh 'bash scripts/ci/release.sh env-install "$ENV_SOURCE"'
                }
              }
            }
            env.DEPLOY_STARTED = 'true'
            sh 'bash scripts/ci/release.sh prepare'
          }
        }
      }
    }

    stage('Deploy') {
      when { expression { env.DEPLOY_ENABLED == 'true' && env.DEPLOY_FAILED != 'true' } }
      steps {
        script {
          deployStep('Deploy') {
            sh 'bash scripts/ci/release.sh deploy'
          }
        }
      }
    }

    stage('Health Check') {
      when { expression { env.DEPLOY_ENABLED == 'true' && env.DEPLOY_FAILED != 'true' } }
      steps {
        script {
          deployStep('Health Check') {
            sh 'bash scripts/ci/release.sh verify'
            // Success: this release becomes the verified one (the next rollback target).
            sh 'bash scripts/ci/release.sh finalize'
          }
        }
      }
    }

    stage('Rollback on Failure') {
      when { expression { env.DEPLOY_FAILED == 'true' } }
      steps {
        script {
          performRollback()
        }
      }
    }

    stage('Cleanup') {
      steps {
        // This project's old release images only; every rollback image is kept.
        // Build cache is trimmed by the central maintenance job, not here.
        sh 'bash scripts/ci/release.sh retain-images || echo "WARNING: image retention did not complete."'
      }
    }

    // Stage 12, Notification, is the top-level post block below: it runs even
    // when a stage fails or the build is aborted, after rollback has finished.
  }

  post {
    always {
      script {
        // An aborted or timed-out deployment is rolled back here, before the report.
        if (env.DEPLOY_STARTED == 'true' && env.ROLLBACK_ATTEMPTED != 'true'
            && currentBuild.currentResult != 'SUCCESS') {
          try {
            performRollback()
          } catch (Exception rollbackError) {
            env.ROLLBACK_STATUS = 'failed'
            echo 'WARNING: rollback after an interrupted deployment did not complete.'
          }
        }

        // Diagnostics are archived before the workspace is wiped.
        try {
          archiveArtifacts artifacts: 'diagnostics/**', allowEmptyArchive: true, fingerprint: false
        } catch (Exception archiveError) {
          echo 'WARNING: diagnostics could not be archived.'
        }

        try {
          withCredentials([
            string(credentialsId: 'discord-webhook-avernek', variable: 'DISCORD_WEBHOOK_URL')
          ]) {
            def outcome = currentBuild.currentResult
            def deployment = env.DEPLOY_ENABLED == 'true'
              ? (env.DEPLOY_FAILED == 'true' ? "failed at ${env.FAILED_STEP ?: 'deployment'}" : (outcome == 'SUCCESS' ? 'deployed and verified' : 'not completed'))
              : "skipped (branch ${env.SOURCE_BRANCH ?: 'unknown'})"
            discordSend(
              webhookURL: env.DISCORD_WEBHOOK_URL,
              title: "${env.JOB_NAME} #${env.BUILD_NUMBER}",
              description: "Result: ${outcome}\n" +
                "Branch: ${env.SOURCE_BRANCH ?: env.BRANCH_NAME ?: 'main'}\n" +
                "Commit: ${env.GIT_SHORT ?: 'unknown'}\n" +
                "Release: ${env.IMAGE_TAG ?: 'not built'}\n" +
                "Deployment: ${deployment}\n" +
                "Rollback: ${env.ROLLBACK_STATUS ?: 'not required / not attempted'}",
              result: outcome,
              link: env.BUILD_URL,
              footer: 'Avernek Technologies | Jenkins Deployment'
            )
          }
        } catch (Exception notificationError) {
          // Reporting failure must never conceal or overwrite a build failure.
          echo 'WARNING: Discord notification could not be sent. Check the credential, plugin and Jenkins egress.'
        } finally {
          cleanWs(deleteDirs: true,
                  disableDeferredWipeout: true,
                  notFailBuild: true)
        }
      }
    }
  }
}

// Runs one deployment step. A failure is recorded (not thrown), so the
// Rollback on Failure stage still runs; the build is marked FAILURE and stays
// failed whatever the rollback outcome. Aborts are rethrown and rolled back in
// the post block.
def deployStep(String name, Closure body) {
  try {
    body()
  } catch (org.jenkinsci.plugins.workflow.steps.FlowInterruptedException interrupted) {
    env.DEPLOY_FAILED = 'true'
    env.FAILED_STEP = name
    throw interrupted
  } catch (Exception error) {
    env.DEPLOY_FAILED = 'true'
    env.FAILED_STEP = name
    currentBuild.result = 'FAILURE'
    echo "${name} failed: ${error.getClass().simpleName}. Rolling back."
  }
}

// Captures diagnostics, then restores the verified release and records the
// outcome in ROLLBACK_STATUS for the Discord report.
def performRollback() {
  env.ROLLBACK_ATTEMPTED = 'true'
  sh 'bash scripts/ci/release.sh diagnostics diagnostics || true'
  int code = sh(script: 'bash scripts/ci/release.sh rollback', returnStatus: true)
  switch (code) {
    case 0:
      env.ROLLBACK_STATUS = 'restored and verified'
      break
    case 3:
      env.ROLLBACK_STATUS = 'no prior release'
      break
    case 4:
      env.ROLLBACK_STATUS = 'not required (server unchanged)'
      break
    default:
      env.ROLLBACK_STATUS = 'failed'
  }
  echo "Rollback: ${env.ROLLBACK_STATUS}"
  // A rollback never turns a failed deployment into a success; an abort stays ABORTED.
  if (currentBuild.currentResult != 'ABORTED') {
    currentBuild.result = 'FAILURE'
  }
}
