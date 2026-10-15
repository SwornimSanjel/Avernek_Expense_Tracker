"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import Icon from "@/components/Icons";

type Field = { name: string; label: string; options: { value: string; label: string }[] };

/**
 * Filters that apply as soon as a value changes: the URL is updated in a
 * transition and the server re-renders the list. No "Apply" button.
 */
export default function UrlFilters({
  values,
  fields,
  search,
  trailing,
}: {
  values: Record<string, string | undefined>;
  fields: Field[];
  search?: { name: string; placeholder: string };
  trailing?: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, start] = useTransition();
  const latest = useRef(values);
  const [text, setText] = useState(search ? values[search.name] ?? "" : "");
  const first = useRef(true);

  useEffect(() => {
    latest.current = values;
  }, [values]);

  function apply(name: string, value: string) {
    const merged = { ...latest.current, [name]: value };
    latest.current = merged;
    const params = new URLSearchParams();
    for (const [key, entry] of Object.entries(merged)) if (entry) params.set(key, entry);
    const query = params.toString();
    start(() => router.replace(`${pathname}${query ? `?${query}` : ""}`, { scroll: false }));
  }

  useEffect(() => {
    if (!search) return;
    if (first.current) {
      first.current = false;
      return;
    }
    const timer = window.setTimeout(() => {
      if ((latest.current[search.name] ?? "") !== text) apply(search.name, text);
    }, 300);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  const active = Object.values(values).some(Boolean);

  return (
    <div className={`filterbar ${pending ? "filter-loading" : ""}`}>
      {search && (
        <div className="search-field">
          <Icon name="search" size={15} />
          <input
            className="input !w-[220px]"
            placeholder={search.placeholder}
            value={text}
            onChange={(event) => setText(event.target.value)}
            aria-label={search.placeholder}
          />
        </div>
      )}
      {fields.map((field) => {
        const value = values[field.name] ?? "";
        return (
          <select
            key={field.name}
            aria-label={field.label}
            value={value}
            onChange={(event) => apply(field.name, event.target.value)}
            className="input filter-select"
            style={value ? { borderColor: "var(--accent-line)", background: "var(--accent-soft)" } : undefined}
          >
            <option value="">{field.label}</option>
            {field.options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        );
      })}
      {active && (
        <button
          type="button"
          className="btn btn-sm btn-ghost"
          onClick={() => {
            latest.current = {};
            setText("");
            start(() => router.replace(pathname, { scroll: false }));
          }}
        >
          <Icon name="close" size={14} /> Clear
        </button>
      )}
      {pending && <span className="text-[12.5px] muted">Updating…</span>}
      {trailing && <div className="ml-auto flex items-center gap-2">{trailing}</div>}
    </div>
  );
}
