// User configuration: ~/.nyquest/config.json plus env overrides.
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { writeJsonAtomic } from "./fsutil";

export interface Config {
  enabled: boolean;
  /** Slider 0..1. 0 = off. */
  level: number;
  showSavings: boolean;
  retentionDays: number;
  /** Per-tool overrides: false disables parking for that tool name. */
  tools: Record<string, boolean>;
  /**
   * Per-tool overrides for full mode: true lets a tool's prose be sent to the Nyquest
   * platform for condensation (and recall(ask=...)), false forbids it. Tools absent here
   * follow REMOTE_OK: web and agent results may leave the machine, shell and MCP output never.
   */
  remoteTools: Record<string, boolean>;
  /**
   * A result is parked only when the estimated saving, after paying for the digest, the
   * footer and the parking note, is at least this many tokens. Small parks lose lines
   * for nothing otherwise.
   */
  minSavingTokens: number;
  apiKey?: string;
  apiBase?: string;
  /** ISO time the level was last changed here; used for last-writer-wins sync with the website. */
  levelUpdatedAt?: string;
}

export const DEFAULTS: Config = {
  enabled: true,
  level: 0.5,
  showSavings: true,
  retentionDays: 7,
  tools: {},
  remoteTools: {},
  minSavingTokens: 300,
};

export function nyquestHome(): string {
  return process.env.NYQUEST_HOME || path.join(os.homedir(), ".nyquest");
}

export function configPath(): string {
  return path.join(nyquestHome(), "config.json");
}

export function loadConfig(): Config {
  let cfg: Config = { ...DEFAULTS, tools: {}, remoteTools: {} };
  try {
    const raw = fs.readFileSync(configPath(), "utf8");
    const parsed = JSON.parse(raw);
    cfg = { ...cfg, ...parsed, tools: { ...(parsed.tools || {}) }, remoteTools: { ...(parsed.remoteTools || {}) } };
  } catch {
    /* no config yet */
  }
  const env = (process.env.NYQUEST_COMPRESS || "").toLowerCase();
  if (env === "off" || env === "0" || env === "false") cfg.enabled = false;
  if (process.env.NYQUEST_LEVEL) {
    const l = Number(process.env.NYQUEST_LEVEL);
    if (Number.isFinite(l)) cfg.level = l;
  }
  if (process.env.NYQUEST_API_KEY) cfg.apiKey = process.env.NYQUEST_API_KEY;
  cfg.level = clamp01(cfg.level);
  if (typeof cfg.minSavingTokens !== "number" || !Number.isFinite(cfg.minSavingTokens) || cfg.minSavingTokens < 0) cfg.minSavingTokens = DEFAULTS.minSavingTokens;
  return cfg;
}

export function saveConfig(cfg: Config): void {
  const { apiKey, ...rest } = cfg;
  const out: Record<string, unknown> = { ...rest };
  if (apiKey) out.apiKey = apiKey;
  writeJsonAtomic(configPath(), out, 2);
}

export function clamp01(n: number): number {
  if (!Number.isFinite(n)) return DEFAULTS.level;
  return Math.max(0, Math.min(1, n));
}

/** Characters above which a tool result is parked, by slider level. */
export function thresholdFor(level: number): number {
  if (level <= 0) return Number.POSITIVE_INFINITY;
  if (level < 0.4) return 16_000;
  if (level < 0.7) return 6_000;
  if (level < 0.95) return 3_000;
  return 2_000;
}

/**
 * Prose is parked only above twice the normal threshold. Phase 3 (2026-09-12): a
 * condensed prose digest is the lossy kind, and Claude verifies it with a recall
 * before answering factual questions, which costs a turn. Parking an 11.9 KB
 * docs dump lost money on every rerun; the digest only pays when the prose is big.
 */
export function proseThresholdFor(level: number): number {
  return thresholdFor(level) * 2;
}

/** Code listings fetched through Bash are only parked at high levels. */
export function codeParkingEnabled(level: number): boolean {
  return level >= 0.8;
}

/** Tools whose results are never parked, whatever the config says. */
export const NEVER_PARK = new Set([
  "Read",
  "Edit",
  "Write",
  "NotebookEdit",
  "Glob",
  "Grep",
  "MultiEdit",
  "TodoWrite",
  "AskUserQuestion",
  "ExitPlanMode",
]);

export function toolEligible(tool: string, cfg: Config): boolean {
  if (NEVER_PARK.has(tool)) return false;
  if (tool.startsWith("mcp__plugin_nyquest")) return false; // never park our own tools
  if (cfg.tools[tool] === false) return false;
  return true;
}

/**
 * Tools whose prose may be sent to the Nyquest platform in full mode (condensation,
 * recall(ask=...)). Web pages and agent reports are already text the user asked for
 * from outside; shell output, files and MCP results stay on the machine unless the
 * user opts the tool in through `remoteTools`.
 */
export const REMOTE_OK = new Set(["WebFetch", "WebSearch", "Agent", "Task", "digest_url"]);

export function remoteEligible(tool: string, cfg: Config): boolean {
  const override = cfg.remoteTools[tool];
  if (override === true) return true;
  if (override === false) return false;
  return REMOTE_OK.has(tool);
}
