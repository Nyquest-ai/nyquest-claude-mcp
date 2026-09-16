// Nyquest API client for full mode. Fail-open: every call returns undefined on
// any error so callers fall back to local behaviour. Secrets are redacted
// before text leaves the machine.
import { loadConfig, type Config } from "./config";
import { VERSION } from "./version";

export const DEFAULT_BASE = "https://api.nyquest.ai";

// Secret shapes stripped from any text before it is posted to the platform. This runs
// only on the outgoing copy; the parked text on disk is untouched, so a false positive
// costs summary quality, never recall. Order: provider prefixes, private keys and JWTs,
// credentials embedded in URLs, header forms, then generic key = value pairs whose key
// is a secret-ish word (any prefix such as AWS_SECRET_ACCESS_KEY or DB_PASSWORD, any
// value length; plurals like max_tokens do not match because the word must be followed
// directly by : or =).
const SECRET_PATTERNS: string[] = [
  String.raw`sk-[A-Za-z0-9_-]{16,}`,                         // OpenAI, Anthropic (sk-ant-), sk-proj-
  String.raw`sk_(?:live|test)_[A-Za-z0-9]{16,}`,             // Stripe secret keys
  String.raw`rk_(?:live|test)_[A-Za-z0-9]{16,}`,             // Stripe restricted keys
  String.raw`gh[pousr]_[A-Za-z0-9]{20,}`,                    // GitHub ghp_/gho_/ghu_/ghs_/ghr_
  String.raw`github_pat_[A-Za-z0-9_]{20,}`,
  String.raw`(?:AKIA|ASIA)[A-Z0-9]{16}`,                     // AWS access key ids
  String.raw`xox[baprs]-[A-Za-z0-9-]{10,}`,                  // Slack
  String.raw`AIza[0-9A-Za-z_-]{35}`,                         // Google API keys
  String.raw`nq-v1-[A-Za-z0-9_-]{20,}`,                      // Nyquest
  String.raw`-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----`,
  String.raw`eyJ[A-Za-z0-9_-]{30,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}`, // JWT
  String.raw`[a-z][a-z0-9+.-]*://[^\s/:@]+:[^\s@]+@`,        // scheme://user:password@host
  String.raw`authorization:\s*(?:bearer|basic|token)\s+\S{8,}`,
  String.raw`\bbasic\s+[A-Za-z0-9+/]{16,}={0,2}`,
  String.raw`sharedaccesssignature=\S+`,
  String.raw`\bsig=[A-Za-z0-9%+/=]{20,}`,
  String.raw`(?<![A-Za-z0-9])(?:password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|client[_-]?secret|secret[_-]?access[_-]?key|secret[_-]?key|auth[_-]?token|session[_-]?token)\s*[:=]\s*["']?[^\s"']+`,
];
export const RE_SECRET = new RegExp(SECRET_PATTERNS.join("|"), "gi");

export function redact(text: string): string {
  return text.replace(RE_SECRET, "[REDACTED]");
}

export function fullMode(cfg: Config = loadConfig()): boolean {
  return Boolean(cfg.apiKey && cfg.apiKey.startsWith("nq-v1-"));
}

export interface CondenseResult {
  digest: string;
  original_tokens: number;
  condensed_tokens: number;
  smaller: boolean;
  method: string;
  model: string;
  ms: number;
}

export interface AskResult {
  answer: string;
  original_tokens: number;
  answer_tokens: number;
  model: string;
  ms: number;
}

/** Last failure reason from a platform call, for the hook log. Never contains content. */
export let lastError: string | undefined;

async function post<T>(cfg: Config, path: string, body: unknown, timeoutMs: number): Promise<T | undefined> {
  lastError = undefined;
  if (!fullMode(cfg)) { lastError = "not-full-mode"; return undefined; }
  const base = (cfg.apiBase || process.env.NYQUEST_API_BASE || DEFAULT_BASE).replace(/\/$/, "");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(base + path, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${cfg.apiKey}`, "user-agent": `nyquest-claude-mcp/${VERSION}` },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!r.ok) { lastError = `HTTP ${r.status}`; return undefined; }
    return (await r.json()) as T;
  } catch (e) {
    lastError = (e as Error)?.name === "AbortError" ? `timeout ${timeoutMs}ms` : String((e as Error)?.message || e).slice(0, 120);
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

/** Semantic condensation of prose on the Nyquest platform. */
export async function condense(text: string, kind: string, cfg: Config = loadConfig(), timeoutMs = 15000): Promise<CondenseResult | undefined> {
  const r = await post<CondenseResult>(cfg, "/v1/plugin/condense", { text: redact(text), kind }, timeoutMs);
  if (!r || typeof r.digest !== "string" || !r.digest.trim()) return undefined;
  return r;
}

/** Answer a question over parked text; only the answer comes back. */
export async function ask(text: string, question: string, cfg: Config = loadConfig(), timeoutMs = 20000): Promise<AskResult | undefined> {
  const r = await post<AskResult>(cfg, "/v1/plugin/ask", { text: redact(text), question }, timeoutMs);
  if (!r || typeof r.answer !== "string" || !r.answer.trim()) return undefined;
  return r;
}

export interface ParkEvent {
  tool: string;
  kind: string;
  method: string;
  chars_in: number;
  chars_out: number;
  tokens_in: number;
  tokens_out: number;
}

/** Report park events (counts only, never content) so the account page can show real savings. */
export async function reportParks(events: ParkEvent[], cfg: Config = loadConfig(), timeoutMs = 2500): Promise<number> {
  if (!events.length) return 0;
  const r = await post<{ accepted?: number }>(cfg, "/v1/plugin/events", { events: events.slice(0, 50) }, timeoutMs);
  return r && typeof r.accepted === "number" ? r.accepted : 0;
}

export interface RemoteSettings {
  level: number | null;
  updated_at: string | null;
  /** Newest plugin release the platform knows about, when it reports one (optional field `latest_version`). */
  latestVersion?: string | null;
}

export async function getSettings(cfg: Config = loadConfig(), timeoutMs = 4000): Promise<RemoteSettings | undefined> {
  if (!fullMode(cfg)) return undefined;
  const base = (cfg.apiBase || process.env.NYQUEST_API_BASE || DEFAULT_BASE).replace(/\/$/, "");
  try {
    const r = await fetch(`${base}/user/plugin/settings`, { headers: { authorization: `Bearer ${cfg.apiKey}`, "user-agent": `nyquest-claude-mcp/${VERSION}` }, signal: AbortSignal.timeout(timeoutMs) });
    if (!r.ok) return undefined;
    const j = (await r.json()) as RemoteSettings & { latest_version?: unknown };
    return {
      level: typeof j.level === "number" ? j.level : null,
      updated_at: typeof j.updated_at === "string" ? j.updated_at : null,
      latestVersion: typeof j.latest_version === "string" ? j.latest_version : null,
    };
  } catch {
    return undefined;
  }
}

export async function putSettings(level: number, cfg: Config = loadConfig(), timeoutMs = 4000): Promise<RemoteSettings | undefined> {
  const base = (cfg.apiBase || process.env.NYQUEST_API_BASE || DEFAULT_BASE).replace(/\/$/, "");
  if (!fullMode(cfg)) return undefined;
  try {
    const r = await fetch(`${base}/user/plugin/settings`, {
      method: "PUT",
      headers: { "content-type": "application/json", authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({ level }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!r.ok) return undefined;
    return (await r.json()) as RemoteSettings;
  } catch {
    return undefined;
  }
}

export async function accountSavings(cfg: Config = loadConfig(), days = 30): Promise<Record<string, unknown> | undefined> {
  if (!fullMode(cfg)) return undefined;
  const base = (cfg.apiBase || process.env.NYQUEST_API_BASE || DEFAULT_BASE).replace(/\/$/, "");
  try {
    const r = await fetch(`${base}/user/plugin/savings?days=${days}`, { headers: { authorization: `Bearer ${cfg.apiKey}` }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) return undefined;
    return (await r.json()) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}
