"use client";

import { useState } from "react";
import type { FieldSpec, FormRequest } from "@/lib/ai/types";

type Value = string | string[];

/**
 * A form the server asked for: missing details, a choice between similar
 * records, or an edit before confirming. Fields come only from the server's
 * schema; values already known travel along unchanged and are re-validated on
 * the server when the form is submitted.
 */
export default function AssistantForm({
  form,
  disabled,
  onSubmit,
}: {
  form: FormRequest;
  disabled: boolean;
  onSubmit: (values: Record<string, unknown>) => void;
}) {
  const [values, setValues] = useState<Record<string, Value>>(() =>
    Object.fromEntries(
      form.fields.map((field) => [field.name, field.type === "multiselect" ? toList(field.value) : toText(field.value)])
    )
  );
  const set = (name: string, value: Value) => setValues((current) => ({ ...current, [name]: value }));

  return (
    <form
      className={`assistant-card assistant-form ${disabled ? "assistant-resolved" : ""}`}
      onSubmit={(event) => {
        event.preventDefault();
        if (disabled) return;
        onSubmit({ ...form.values, ...values });
      }}
    >
      <div className="assistant-form-head">
        <div className="assistant-card-title">{form.title}</div>
        {form.message && <div className="assistant-note">{form.message}</div>}
      </div>
      {form.fields.map((field) => (
        <Field key={field.name} field={field} value={values[field.name]} onChange={(value) => set(field.name, value)} />
      ))}
      <div className="assistant-actions">
        <button type="submit" className="btn btn-primary" disabled={disabled}>
          {form.submitLabel}
        </button>
      </div>
    </form>
  );
}

function toText(value: FieldSpec["value"]): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value == null ? "" : String(value);
}

function toList(value: FieldSpec["value"]): string[] {
  if (Array.isArray(value)) return value;
  return value ? [String(value)] : [];
}

function Field({ field, value, onChange }: { field: FieldSpec; value: Value | undefined; onChange: (value: Value) => void }) {
  const id = `assistant-field-${field.name}`;
  const text = typeof value === "string" ? value : "";
  const label = (
    <span className="field-label">
      {field.label}
      {field.required ? "" : " (optional)"}
    </span>
  );
  const footer = (
    <>
      {field.help && <div className="field-help">{field.help}</div>}
      {field.error && <div className="assistant-field-error" role="alert">{field.error}</div>}
    </>
  );

  if (field.type === "choice") {
    return (
      <fieldset className="assistant-fieldset">
        <legend>{label}</legend>
        <div className="assistant-options">
          {(field.options ?? []).map((option) => (
            <label key={option.value} className="assistant-option">
              <input
                type="radio"
                name={field.name}
                value={option.value}
                checked={text === option.value}
                required={field.required}
                onChange={() => onChange(option.value)}
              />
              <span>
                {option.label}
                {option.hint && <small>{option.hint}</small>}
              </span>
            </label>
          ))}
        </div>
        {footer}
      </fieldset>
    );
  }

  if (field.type === "multiselect") {
    const list = Array.isArray(value) ? value : [];
    return (
      <fieldset className="assistant-fieldset">
        <legend>{label}</legend>
        <div className="assistant-options">
          {(field.options ?? []).map((option) => (
            <label key={option.value} className="assistant-option">
              <input
                type="checkbox"
                checked={list.includes(option.value)}
                onChange={(event) =>
                  onChange(event.target.checked ? [...list, option.value] : list.filter((item) => item !== option.value))
                }
              />
              <span>{option.label}</span>
            </label>
          ))}
        </div>
        {footer}
      </fieldset>
    );
  }

  return (
    <label htmlFor={id} className="block">
      {label}
      {field.type === "select" ? (
        <select id={id} className="input mt-1.5" value={text} required={field.required} onChange={(event) => onChange(event.target.value)}>
          {!field.options?.some((option) => option.value === "") && <option value="">Choose…</option>}
          {(field.options ?? []).map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      ) : field.type === "textarea" ? (
        <textarea
          id={id}
          className="input mt-1.5"
          value={text}
          required={field.required}
          placeholder={field.placeholder}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <input
          id={id}
          className="input mt-1.5"
          type={field.type}
          value={text}
          required={field.required}
          placeholder={field.placeholder}
          min={field.min}
          step={field.step}
          inputMode={field.type === "number" ? "decimal" : undefined}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
      {footer}
    </label>
  );
}
