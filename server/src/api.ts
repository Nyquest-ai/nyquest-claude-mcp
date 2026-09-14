// Nyquest API client for full mode. Fail-open: every call returns undefined on
// any error so callers fall back to local behaviour. Secrets are redacted
// before text leaves the machine.
import { loadConfig, type Config } from "./config";

export const DEFAULT_BASE = "https://api.nyquest.ai";

const RE_SECRET = /(sk-[A-Za-z0-9_-]{16,}|sk-ant-[A-Za-z0-9_-]{16,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[A-Z0-9]{16}|xox[baprs]-[A-Za-z0-9-]{10,}|-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----|nq-v1-[A-Za-z0-9_-]{20,}|eyJ[A-Za-z0-9_-]{30,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}|(?:password|passwd|secret|token|api[_-]?key)\s*[:=]\s*["']?[^\s"']{8,}|authorization:\s*bearer\s+\S{16,})/gi;

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

async function post<T>(cfg: Config, path: string, body: unknown, timeoutMs: number): Promise<T | undefined> {
  if (!fullMode(cfg)) return undefined;
  const base = (cfg.apiBase || process.env.NYQUEST_API_BASE || DEFAULT_BASE).replace(/\/$/, "");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(base + path, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${cfg.apiKey}`, "user-agent": "nyquest-claude-mcp/0.2.0" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!r.ok) return undefined;
    return (await r.json()) as T;
  } catch {
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
}

export async function getSettings(cfg: Config = loadConfig(), timeoutMs = 4000): Promise<RemoteSettings | undefined> {
  if (!fullMode(cfg)) return undefined;
  const base = (cfg.apiBase || process.env.NYQUEST_API_BASE || DEFAULT_BASE).replace(/\/$/, "");
  try {
    const r = await fetch(`${base}/user/plugin/settings`, { headers: { authorization: `Bearer ${cfg.apiKey}` }, signal: AbortSignal.timeout(timeoutMs) });
    if (!r.ok) return undefined;
    const j = (await r.json()) as RemoteSettings;
    return { level: typeof j.level === "number" ? j.level : null, updated_at: typeof j.updated_at === "string" ? j.updated_at : null };
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
