/**
 * Netlify Scheduled Function: refresh the cached NRB exchange rate daily.
 * It calls the protected Next.js route so the FX implementation has one source of truth.
 */
export default async () => {
  const siteUrl = process.env.URL;
  const secret = process.env.CRON_SECRET;

  if (!siteUrl || !secret) {
    throw new Error("Missing Netlify URL or CRON_SECRET");
  }

  const response = await fetch(`${siteUrl}/api/cron/fx`, {
    headers: { Authorization: `Bearer ${secret}` },
  });
  const body = await response.text();

  if (!response.ok) {
    throw new Error(`FX refresh failed (${response.status}): ${body}`);
  }

  console.log(`FX refresh complete: ${body}`);
};
