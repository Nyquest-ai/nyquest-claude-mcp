// Deterministic digest for structured payloads: JSON, CSV/TSV, tables, listings.
import { ERR_RE } from "./log";

function typeOf(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return `array[${v.length}]`;
  return typeof v;
}

function short(v: unknown, max = 160): string {
  const s = JSON.stringify(v);
  return s.length > max ? s.slice(0, max - 3) + "..." : s;
}

export function digestData(text: string, opts: { records?: number; head?: number; tail?: number } = {}): string {
  const records = opts.records ?? 3, head = opts.head ?? 25, tail = opts.tail ?? 8;
  const t = text.trim();
  try {
    const v = JSON.parse(t);
    const out: string[] = [];
    if (Array.isArray(v)) {
      out.push(`[nyquest digest: JSON array of ${v.length} items; first ${Math.min(records, v.length)} shown verbatim]`);
      const first = v[0];
      if (first && typeof first === "object" && !Array.isArray(first)) {
        out.push("keys: " + Object.entries(first).map(([k, x]) => `${k}:${typeOf(x)}`).join(", "));
      }
      for (const item of v.slice(0, records)) out.push(short(item, 600));
    } else if (v && typeof v === "object") {
      const entries = Object.entries(v);
      out.push(`[nyquest digest: JSON object with ${entries.length} keys; values summarised]`);
      for (const [k, x] of entries.slice(0, 60)) out.push(`${k}: ${typeOf(x)} ${short(x, 120)}`);
      if (entries.length > 60) out.push(`... ${entries.length - 60} more keys`);
    } else {
      return t.slice(0, 2000);
    }
    return out.join("\n");
  } catch {
    /* not JSON */
  }
  const lines = t.replace(/\r\n/g, "\n").split("\n");
  const n = lines.length;
  if (n <= head + tail + 5) return lines.join("\n");
  const sepCount = (re: RegExp) => lines.slice(0, 50).filter((l) => re.test(l)).length;
  const kind = sepCount(/\t/) > 25 ? "TSV" : sepCount(/,/) > 25 ? "CSV" : sepCount(/\|/) > 25 ? "table" : "listing";
  // Listings can still carry error-like rows (git log messages, apt warnings): keep them.
  const flagged: string[] = [];
  for (let i = head; i < n - tail && flagged.length < 40; i++) {
    if (ERR_RE.test(lines[i]) && lines[i].trim().length < 400) flagged.push(`${i + 1}: ${lines[i]}`);
  }
  const out = [
    `[nyquest digest: ${kind}, ${n} lines; first ${head} and last ${tail} kept verbatim${flagged.length ? `, ${flagged.length} error-like rows kept` : ""}]`,
    ...lines.slice(0, head),
    `... [${n - head - tail} lines omitted: ${head + 1}-${n - tail}] ...`,
  ];
  if (flagged.length) out.push("error-like rows:", ...flagged);
  out.push(...lines.slice(n - tail));
  return out.join("\n");
}
