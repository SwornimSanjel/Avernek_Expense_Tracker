import { unstable_cache } from "next/cache";
import { getCachedUsdSellRate } from "@/lib/fx";

/**
 * Live USD → NPR market rate for display.
 *
 * Google shows the mid-market rate (what "1 USD in NPR" returns in a search),
 * so that is the headline number and the first source. If Google cannot be
 * read, the open exchange-rate feed is used, and the cached NRB rate is the
 * last resort. NRB's *sell* rate is still what expense conversions freeze —
 * it is what the bank charges to buy dollars — so it is returned alongside.
 *
 * The result is cached for a few minutes on the server: every page load reads
 * the cache, never the network, and the cache refreshes itself in the
 * background. The browser chip polls /api/fx/live to stay current.
 */

export type MarketRate = {
  /** NPR per 1 USD, mid-market. */
  rate: number;
  /** Change since the previous close, when the source reports it. */
  change: number | null;
  changePct: number | null;
  source: "google" | "exchange-api" | "nrb";
  sourceLabel: string;
  /** When this value was read (ISO timestamp). */
  fetchedAt: string;
  nrb: { sell: number; buy: number | null; date: string } | null;
};

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

async function fromGoogle(): Promise<Pick<MarketRate, "rate" | "change" | "changePct"> | null> {
  const response = await fetch("https://www.google.com/finance/quote/USD-NPR?hl=en", {
    headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9" },
    cache: "no-store",
    signal: AbortSignal.timeout(4500),
  });
  if (!response.ok) return null;
  const html = await response.text();

  // The quote card, anchored on its title so a related quote on the page is
  // never picked up: "...Nepalese Rupee</div>...<span jsname="Pdsbrc"><span>152.2298</span>"
  const visible = /Nepalese Rupee<\/div>[\s\S]{0,800}?jsname="Pdsbrc"[^>]*>\s*<span>([\d,]+\.\d+)<\/span>/.exec(html);
  // The structured quote: "NPR",[[[1,[date],[date]],[[[date],[price, change, changeFraction, ...
  const structured = /"NPR",\[\[\[1,[\s\S]{0,120}?\]\],\[\[\[\d{4},[\s\S]{0,60}?\],\[(-?[\d.]+),(-?[\d.E-]+),(-?[\d.E-]+)/.exec(html);

  const rate = visible ? Number(visible[1].replace(/,/g, "")) : structured ? Number(structured[1]) : NaN;
  if (!Number.isFinite(rate) || rate < 50 || rate > 500) return null;

  const change = structured ? Number(structured[2]) : NaN;
  const fraction = structured ? Number(structured[3]) : NaN;
  return {
    rate,
    change: Number.isFinite(change) ? change : null,
    changePct: Number.isFinite(fraction) ? fraction * 100 : null,
  };
}

async function fromExchangeApi(): Promise<Pick<MarketRate, "rate" | "change" | "changePct"> | null> {
  const response = await fetch("https://open.er-api.com/v6/latest/USD", {
    cache: "no-store",
    signal: AbortSignal.timeout(4000),
  });
  if (!response.ok) return null;
  const json = (await response.json()) as { rates?: Record<string, number> };
  const rate = Number(json?.rates?.NPR);
  if (!Number.isFinite(rate) || rate < 50 || rate > 500) return null;
  return { rate, change: null, changePct: null };
}

async function readLiveRate(): Promise<MarketRate | null> {
  const nrbRow = await getCachedUsdSellRate().catch(() => null);
  const nrb = nrbRow ? { sell: nrbRow.rate, buy: nrbRow.buy, date: nrbRow.rateDate } : null;
  const fetchedAt = new Date().toISOString();

  const google = await fromGoogle().catch(() => null);
  if (google) return { ...google, source: "google", sourceLabel: "Google Finance", fetchedAt, nrb };

  const api = await fromExchangeApi().catch(() => null);
  if (api) return { ...api, source: "exchange-api", sourceLabel: "Market rate", fetchedAt, nrb };

  if (nrb) {
    return {
      rate: nrb.buy != null ? (nrb.buy + nrb.sell) / 2 : nrb.sell,
      change: null,
      changePct: null,
      source: "nrb",
      sourceLabel: `NRB · ${nrb.date}`,
      fetchedAt,
      nrb,
    };
  }
  return null;
}

/** Cached for 5 minutes; refreshed in the background after that. */
export const getLiveUsdNpr = unstable_cache(readLiveRate, ["live-usd-npr-v1"], {
  revalidate: 300,
  tags: ["live-fx"],
});
