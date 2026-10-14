import { formatIncomeMoney } from "@/lib/income";
import { TDS_RATE, VAT_RATE, priceBreakdown } from "@/lib/tax";

/**
 * Each agreed price laid out the way the invoice and the bank will see it:
 *
 *   our price  + VAT 13%  = invoice to client  − TDS 1.5% of our price  = reaches bank
 *
 * so nobody has to work out VAT, TDS, or which part of the money is untouchable.
 */
export default function PriceBreakdownTable({
  charges,
  currency,
  withVat,
  withTds,
}: {
  charges: { label: string; amount: number }[];
  currency: string;
  withVat: boolean;
  withTds: boolean;
}) {
  const rows = charges
    .filter((charge) => charge.amount > 0)
    .map((charge) => ({ ...charge, ...priceBreakdown(charge.amount, withVat, withTds) }));
  if (!rows.length) {
    return (
      <p className="field-help">Enter a price above to see the VAT, TDS and what reaches the bank.</p>
    );
  }
  const first = rows[0];
  const money = (value: number) => formatIncomeMoney(value, currency);

  return (
    <div className="space-y-2">
      <div className="price-table-wrap">
        <table className="price-table">
          <thead>
            <tr>
              <th />
              {rows.map((row) => (
                <th key={row.label}>{row.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <th>
                Our price
                <small>our income · excl. VAT</small>
              </th>
              {rows.map((row) => (
                <td key={row.label}>{money(row.price)}</td>
              ))}
            </tr>
            <tr className={withVat ? "price-table-tax" : "price-table-off"}>
              <th>
                + VAT {VAT_RATE * 100}%
                <small>{withVat ? "IRD's money · don't touch" : "no VAT bill"}</small>
              </th>
              {rows.map((row) => (
                <td key={row.label}>{money(row.vat)}</td>
              ))}
            </tr>
            <tr className="price-table-sum">
              <th>
                = Invoice to client
                <small>what the bill asks for</small>
              </th>
              {rows.map((row) => (
                <td key={row.label}>{money(row.invoice)}</td>
              ))}
            </tr>
            <tr className={withTds ? "price-table-tax" : "price-table-off"}>
              <th>
                − TDS {TDS_RATE * 100}%
                <small>{withTds ? "client keeps it · we claim it back" : "client does not deduct"}</small>
              </th>
              {rows.map((row) => (
                <td key={row.label}>{money(row.tds)}</td>
              ))}
            </tr>
            <tr className="price-table-total">
              <th>= Reaches the bank</th>
              {rows.map((row) => (
                <td key={row.label}>{money(row.bank)}</td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      <p className="field-help">
        TDS is {TDS_RATE * 100}% of <strong>our price before VAT</strong>: {TDS_RATE * 100}% × {money(first.price)} ={" "}
        {money(priceBreakdown(first.price, false, true).tds)} — never {TDS_RATE * 100}% of the{" "}
        {money(priceBreakdown(first.price, true, false).invoice)} invoice.
        {withVat && ` Of the ${money(first.bank)} that reaches the bank, ${money(first.vat)} is VAT for IRD — keep it aside, don't spend it.`}
        {withTds && ` The ${money(first.tds)} TDS is not lost: it is claimed back in Avernek's income tax return.`}
      </p>
    </div>
  );
}
