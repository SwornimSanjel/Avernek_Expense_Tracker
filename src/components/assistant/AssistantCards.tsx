"use client";

import type { Card, Tone } from "@/lib/ai/types";

/**
 * The assistant's answer cards. Every value arrives formatted from the server;
 * nothing here adds, rounds or converts an amount.
 */

function toneClass(tone?: Tone) {
  return tone && tone !== "default" ? `assistant-tone-${tone}` : "";
}

export default function AssistantCards({ cards }: { cards: Card[] }) {
  return (
    <>
      {cards.map((card, index) => (
        <AssistantCard key={index} card={card} />
      ))}
    </>
  );
}

function AssistantCard({ card }: { card: Card }) {
  if (card.type === "notice") {
    const tone = card.tone === "error" ? "alert-error" : card.tone === "warn" ? "alert-warn" : "";
    return (
      <div className={`alert ${tone}`} role={card.tone === "error" ? "alert" : undefined}>
        {card.text}
      </div>
    );
  }

  if (card.type === "stats") {
    return (
      <section className="assistant-card">
        {card.title && <div className="assistant-card-title">{card.title}</div>}
        <div className="assistant-stats">
          {card.items.map((item, index) => (
            <div key={index}>
              <div className="assistant-stat-label">{item.label}</div>
              <div className={`assistant-stat-value ${toneClass(item.tone)}`}>{item.value}</div>
              {item.hint && <div className="assistant-stat-hint">{item.hint}</div>}
            </div>
          ))}
        </div>
      </section>
    );
  }

  if (card.type === "facts") {
    return (
      <section className="assistant-card">
        <div className="assistant-card-title">{card.title}</div>
        <dl className="assistant-facts">
          {card.items.map((item, index) => (
            <div key={index} style={{ display: "contents" }}>
              <dt>{item.label}</dt>
              <dd>
                {item.value}
                {item.hint && <small>{item.hint}</small>}
              </dd>
            </div>
          ))}
        </dl>
        {card.note && <div className="assistant-note">{card.note}</div>}
      </section>
    );
  }

  return (
    <section className="assistant-card">
      <div className="assistant-card-title">{card.title}</div>
      <div className="assistant-table-wrap">
        <table className="assistant-table">
          <thead>
            <tr>
              {card.columns.map((column) => (
                <th key={column.key} className={column.align === "right" ? "num" : undefined}>
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {card.rows.map((row, index) => (
              <tr key={index}>
                {card.columns.map((column) => (
                  <td key={column.key} className={column.align === "right" ? "num" : undefined}>
                    {row[column.key] ?? ""}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          {card.footer && (
            <tfoot>
              <tr>
                {card.columns.map((column) => (
                  <td key={column.key} className={column.align === "right" ? "num" : undefined}>
                    {card.footer?.[column.key] ?? ""}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {card.note && <div className="assistant-note">{card.note}</div>}
    </section>
  );
}
