/*
 * test-discord-notification.groovy: send one harmless test message to the
 * deployment-alerts Discord channel, from the Jenkins controller.
 *
 * Proves that the 'discord-webhook-avernek' credential exists and holds a
 * working webhook, and that the controller can reach Discord over HTTPS. It
 * deploys nothing and never prints the webhook URL. It does not replace a real
 * pipeline run, which posts its own embed from the build agent with curl.
 *
 * Run by a Jenkins administrator, with the Jenkins CLI:
 *
 *   java -jar jenkins-cli.jar -s "https://YOUR-JENKINS-URL/" \
 *     -auth @/path/to/protected-credentials-file \
 *     groovy = < scripts/test-discord-notification.groovy
 *
 * (Or paste it into Manage Jenkins -> Script Console.) The credentials file
 * holds "username:api-token" with mode 600, so the token stays out of shell
 * history.
 */

import com.cloudbees.plugins.credentials.CredentialsProvider
import groovy.json.JsonOutput
import hudson.security.ACL
import jenkins.model.Jenkins
import org.jenkinsci.plugins.plaincredentials.StringCredentials

final String CREDENTIAL_ID = 'discord-webhook-avernek'

def credential = CredentialsProvider.lookupCredentials(
    StringCredentials, Jenkins.get(), ACL.SYSTEM, Collections.emptyList()
).find { it.id == CREDENTIAL_ID }

if (credential == null) {
  println "FAILED: no Secret text credential '${CREDENTIAL_ID}' in the global (Jenkins) store."
  return
}

String webhook = credential.secret.plainText?.trim()
if (!webhook?.startsWith('https://')) {
  println "FAILED: credential '${CREDENTIAL_ID}' does not hold an https webhook URL."
  return
}

def stamp = new Date().format("yyyy-MM-dd'T'HH:mm:ssXXX", TimeZone.getTimeZone('UTC'))
def payload = JsonOutput.toJson([
    username: 'Jenkins',
    embeds  : [[
        title      : 'Jenkins → Discord test',
        description: "Test message from ${Jenkins.get().rootUrl ?: 'Jenkins'} at ${stamp}. No deployment was run.",
        color      : 3447003,
        footer     : [text: 'Avernek Technologies | Jenkins Deployment']
    ]]
])

try {
  def connection = (HttpURLConnection) new URL(webhook).openConnection()
  connection.requestMethod = 'POST'
  connection.doOutput = true
  connection.connectTimeout = 10000
  connection.readTimeout = 10000
  connection.setRequestProperty('Content-Type', 'application/json')
  connection.outputStream.withWriter('UTF-8') { it << payload }
  int code = connection.responseCode
  if (code >= 200 && code < 300) {
    println "OK: Discord accepted the test message (HTTP ${code}). Check the deployment-alerts channel."
  } else {
    println "FAILED: Discord answered HTTP ${code}. 401/404: the webhook was deleted or the URL is wrong; 429: rate limited."
  }
} catch (Exception error) {
  // The exception text can contain the URL: report only its type.
  println "FAILED: could not reach Discord (${error.getClass().simpleName}). Check outbound HTTPS and any proxy."
}
