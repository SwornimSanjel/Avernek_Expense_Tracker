#!/usr/bin/env node
/**
 * compare-transcription.mjs: which speech model understands Avernek's team best?
 *
 * Sends the same recordings to several OpenRouter transcription models and
 * scores each against what was actually said: word error rate (WER),
 * character error rate (CER, fairer for Nepali), whether every number came
 * out right (amounts and dates matter most here), cost and latency.
 *
 *   OPENROUTER_API_KEY=... node scripts/ai/compare-transcription.mjs <folder> \
 *     [--models qwen/qwen3-asr-1.7b,openai/whisper-large-v3-turbo,elevenlabs/scribe-v2] \
 *     [--language ne]
 *
 * The folder holds pairs: kalika-payment.webm + kalika-payment.txt (the exact
 * words spoken). Any of webm, ogg, m4a, mp3, wav, flac, aac. Record ~20 real
 * requests: English, Nepali, mixed, with client names, NPR amounts and dates.
 * Keep the folder outside the repository: recordings are not committed.
 *
 * Writes <folder>/transcription-report.json with every transcript. Requests use
 * Zero Data Retention routing, like the app. The key is never printed.
 */

import { readdir, readFile, writeFile } from "node:fs/promises";
import { extname, basename, join } from "node:path";

const DEFAULT_MODELS = ["qwen/qwen3-asr-1.7b", "openai/whisper-large-v3-turbo", "elevenlabs/scribe-v2"];
const FORMATS = new Set(["webm", "ogg", "m4a", "mp3", "wav", "flac", "aac"]);

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index > 0 ? process.argv[index + 1] : undefined;
}

const folder = process.argv[2];
const key = process.env.OPENROUTER_API_KEY;
if (!folder || folder.startsWith("--")) {
  console.error("usage: OPENROUTER_API_KEY=... node scripts/ai/compare-transcription.mjs <folder> [--models a,b] [--language ne]");
  process.exit(2);
}
if (!key) {
  console.error("OPENROUTER_API_KEY is not set.");
  process.exit(2);
}
const models = (argValue("--models") ?? DEFAULT_MODELS.join(",")).split(",").map((m) => m.trim()).filter(Boolean);
const language = argValue("--language");

const DEVANAGARI_DIGITS = "०१२३४५६७८९";
function normalize(text) {
  return text
    .normalize("NFKC")
    .replace(/[०-९]/g, (d) => String(DEVANAGARI_DIGITS.indexOf(d)))
    .toLowerCase()
    .replace(/(\d),(?=\d)/g, "$1")
    .replace(/[^\p{L}\p{M}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function editDistance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const current = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = current;
    }
  }
  return row[b.length];
}

function score(expected, actual) {
  const e = normalize(expected);
  const a = normalize(actual);
  const words = e.split(" ").filter(Boolean);
  const wer = words.length ? editDistance(words, a.split(" ").filter(Boolean)) / words.length : 0;
  const chars = [...e.replace(/ /g, "")];
  const cer = chars.length ? editDistance(chars, [...a.replace(/ /g, "")]) / chars.length : 0;
  const numbers = e.match(/\d+/g) ?? [];
  const found = new Set(a.match(/\d+/g) ?? []);
  const numbersRight = numbers.every((n) => found.has(n));
  return { wer, cer, numbers: numbers.length, numbersRight };
}

async function transcribe(model, base64, format) {
  const started = Date.now();
  const response = await fetch("https://openrouter.ai/api/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "X-Title": "Avernek transcription comparison" },
    body: JSON.stringify({
      model,
      input_audio: { data: base64, format },
      ...(language ? { language } : {}),
      temperature: 0,
      provider: { zdr: true, data_collection: "deny" },
    }),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof json.error === "string" ? json.error : json.error?.message;
    throw new Error(`HTTP ${response.status}${message ? `: ${String(message).slice(0, 160)}` : ""}`);
  }
  return { text: String(json.text ?? ""), cost: Number(json.usage?.cost) || 0, ms: Date.now() - started };
}

const files = (await readdir(folder)).filter((name) => FORMATS.has(extname(name).slice(1).toLowerCase())).sort();
const clips = [];
for (const name of files) {
  const stem = basename(name, extname(name));
  try {
    clips.push({ name, format: extname(name).slice(1).toLowerCase().replace("mp4", "m4a"), expected: (await readFile(join(folder, `${stem}.txt`), "utf8")).trim() });
  } catch {
    console.warn(`skipping ${name}: no ${stem}.txt with the words spoken`);
  }
}
if (!clips.length) {
  console.error("No recordings with matching .txt files found.");
  process.exit(1);
}

console.log(`${clips.length} recordings × ${models.length} models${language ? `, language hint "${language}"` : ""}\n`);
const report = { models, language: language ?? null, clips: [] };
const totals = Object.fromEntries(models.map((m) => [m, { wer: 0, cer: 0, numbersRight: 0, withNumbers: 0, cost: 0, ms: 0, failed: 0 }]));

for (const clip of clips) {
  const base64 = (await readFile(join(folder, clip.name))).toString("base64");
  const row = { clip: clip.name, expected: clip.expected, results: {} };
  for (const model of models) {
    try {
      const result = await transcribe(model, base64, clip.format);
      const s = score(clip.expected, result.text);
      row.results[model] = { text: result.text, ...s, cost: result.cost, ms: result.ms };
      const t = totals[model];
      t.wer += s.wer;
      t.cer += s.cer;
      t.cost += result.cost;
      t.ms += result.ms;
      if (s.numbers) {
        t.withNumbers += 1;
        if (s.numbersRight) t.numbersRight += 1;
      }
    } catch (error) {
      row.results[model] = { error: error.message };
      totals[model].failed += 1;
    }
  }
  report.clips.push(row);
  process.stdout.write(".");
}
console.log("\n");

const pct = (value) => `${(value * 100).toFixed(1)}%`;
console.log("model".padEnd(36), "WER".padStart(7), "CER".padStart(7), "numbers right".padStart(14), "cost".padStart(10), "avg ms".padStart(8), "failed".padStart(7));
for (const model of models) {
  const t = totals[model];
  const ok = clips.length - t.failed || 1;
  console.log(
    model.padEnd(36),
    pct(t.wer / ok).padStart(7),
    pct(t.cer / ok).padStart(7),
    `${t.numbersRight}/${t.withNumbers}`.padStart(14),
    `$${t.cost.toFixed(4)}`.padStart(10),
    String(Math.round(t.ms / ok)).padStart(8),
    String(t.failed).padStart(7)
  );
}
report.totals = totals;
await writeFile(join(folder, "transcription-report.json"), JSON.stringify(report, null, 2));
console.log(`\nLower WER/CER is better. Every transcript: ${join(folder, "transcription-report.json")}`);
console.log("Choose the model in .env: AI_TRANSCRIPTION_MODEL=<model id>");
