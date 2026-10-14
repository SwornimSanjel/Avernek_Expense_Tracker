/**
 * Nepal VAT and TDS as they apply to Avernek's client receipts.
 *
 *   VAT  13% is charged ON TOP of the bill amount. It is collected for the
 *        Inland Revenue Department and is never Avernek's money to spend.
 *   TDS  1.5% is withheld by a client paying a VAT-registered service provider
 *        and is calculated on the bill amount EXCLUDING VAT. It never reaches
 *        the bank; it is a tax credit claimed against Avernek's income tax.
 *
 * Example: bill 35,000 + VAT 4,550 = 39,550. With TDS the client withholds
 * 1.5% × 35,000 = 525 and transfers 39,025. Without TDS it transfers 39,550.
 *
 * Rates change with the Finance Act, so every form keeps both amounts editable.
 */

export const VAT_RATE = 0.13;
export const TDS_RATE = 0.015;

export function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function vatOn(billAmount: number) {
  return round2(billAmount * VAT_RATE);
}

export function tdsOn(billAmount: number) {
  return round2(billAmount * TDS_RATE);
}

/** The VAT inside a VAT-inclusive bill total, e.g. 20,340 → 2,340. */
export function vatInsideTotal(total: number) {
  return round2(total - total / (1 + VAT_RATE));
}

/** What actually reached the bank for one receipt. */
export function bankAmount(row: { amount: number | string; vat_amount?: number | string | null; tds_amount?: number | string | null }) {
  return round2(Number(row.amount) + Number(row.vat_amount ?? 0) - Number(row.tds_amount ?? 0));
}

/**
 * Work backwards from the amount that hit the bank to the bill amount, for when
 * only the bank statement is at hand.
 */
export function billFromBankTotal(total: number, withVat: boolean, withTds: boolean) {
  const factor = 1 + (withVat ? VAT_RATE : 0) - (withTds ? TDS_RATE : 0);
  return round2(total / factor);
}

export type PriceBreakdown = {
  /** Our price, excluding VAT. This is Avernek's income. */
  price: number;
  vat: number;
  /** What the VAT invoice asks the client for. */
  invoice: number;
  /** 1.5% of the price before VAT — never of the invoice total. */
  tds: number;
  /** What reaches the bank: invoice minus TDS when the client deducts it. */
  bank: number;
};

export function priceBreakdown(price: number, withVat: boolean, withTds: boolean): PriceBreakdown {
  const vat = withVat ? vatOn(price) : 0;
  const tds = withTds ? tdsOn(price) : 0;
  return { price, vat, invoice: round2(price + vat), tds, bank: round2(price + vat - tds) };
}
