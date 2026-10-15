import { describe, expect, it } from "vitest";
import { parseGoogleQuote } from "./market-fx";

// Trimmed from the real Google Finance USD-NPR page on 2026-10-15. Google
// Search showed "1 USD = 151.94 NPR" at 11:19 UTC; the headline card showed 151.7957.
const headline =
  '<div class="gO24Ff">United States Dollar / Nepalese Rupee</div></div><div class="LhDNu"><div class="zhtAvb"><div class="ujg0He"><div class="N6SYTe"><span jsname="Pdsbrc" class=""><span>151.7957</span></span></div>';
const intraday =
  'data:[[[null,"/g/11bvvzw970","NPR",[[[1,[2026,10,15,null,null,null,null,[]],[2026,10,15,23,59,null,null,[]]],[[[2026,10,15,1,null,null,null,[]],[152.2298,-0.06329999999999814,-4.1564588284037906E-4,4,4,5]],[[2026,10,15,11,19,null,null,[]],[151.9387,-0.35439999999999827,-0.002327091641052669,4,4,5]]]]],null,0,152.2931,"USD / NPR",60,3,["USD","NPR"]]]]';
const daily =
  '[[[2026,10,14,23,58,null,null,[]],[152.2931,3.36190000000002,0.02257351045314897,4,4,5]],[[2026,10,15,11,19,19,null,[]],[151.795698,2.8644979999999975,0.019233699856040894,4,4,5]]]]],null,0,152.2931,"USD / NPR",86400,3';

describe("parseGoogleQuote", () => {
  it("uses the latest point of the 1-day series, which is what Google Search shows", () => {
    const quote = parseGoogleQuote(headline + daily + intraday);
    expect(quote?.rate).toBe(151.9387);
    expect(quote?.change).toBeCloseTo(-0.3544, 4);
    expect(quote?.changePct).toBeCloseTo(-0.2327, 4);
  });

  it("falls back to the headline card when the series is missing", () => {
    expect(parseGoogleQuote(headline)).toEqual({ rate: 151.7957, change: null, changePct: null });
  });

  it("returns null when the page has no usable quote", () => {
    expect(parseGoogleQuote("<html>consent wall</html>")).toBeNull();
  });
});
