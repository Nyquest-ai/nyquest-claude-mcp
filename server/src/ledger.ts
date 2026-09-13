// Per-session savings ledger: ~/.nyquest/sessions/<session>.json
import * as fs from "node:fs";
import * as path from "node:path";
import { nyquestHome } from "./config";
import { estimateTokens } from "./tokens";

export interface ParkRecord { id: string; tool: string; cls: string; chars: number; digestChars: number; at: string }
export interface RecallRecord { id: string; mode: string; chars: number; at: string }
export interface Ledger {
  session: string;
  started: string;
  parks: ParkRecord[];
  recalls: RecallRecord[];
  skipped: Record<string, number>;
}

function file(session: string): string {
  return path.join(nyquestHome(), "sessions", String(session || "unknown").replace(/[^A-Za-z0-9_.-]/g, "_") + ".json");
}

export function loadLedger(session: string): Ledger {
  try {
    return JSON.parse(fs.readFileSync(file(session), "utf8"));
  } catch {
    return { session, started: new Date().toISOString(), parks: [], recalls: [], skipped: {} };
  }
}

export function saveLedger(l: Ledger): void {
  fs.mkdirSync(path.dirname(file(l.session)), { recursive: true });
  fs.writeFileSync(file(l.session), JSON.stringify(l, null, 1));
}

export function recordPark(session: string, r: Omit<ParkRecord, "at">): Ledger {
  const l = loadLedger(session);
  l.parks.push({ ...r, at: new Date().toISOString() });
  saveLedger(l);
  return l;
}

export function recordRecall(session: string, r: Omit<RecallRecord, "at">): void {
  const l = loadLedger(session);
  l.recalls.push({ ...r, at: new Date().toISOString() });
  saveLedger(l);
}

export function recordSkip(session: string, reason: string): void {
  const l = loadLedger(session);
  l.skipped[reason] = (l.skipped[reason] || 0) + 1;
  saveLedger(l);
}

export interface Summary {
  parks: number;
  recalls: number;
  charsParked: number;
  charsDigest: number;
  charsRecalled: number;
  /** One-time tokens kept out of the context, net of recalls. Estimated. */
  tokensSavedOnce: number;
  /** Same figure, the amount every later turn also avoids re-reading. Estimated. */
  tokensSavedPerTurn: number;
  byTool: Record<string, { parks: number; chars: number }>;
}

export function summarize(l: Ledger): Summary {
  const byTool: Summary["byTool"] = {};
  let charsParked = 0, charsDigest = 0, charsRecalled = 0;
  for (const p of l.parks) {
    charsParked += p.chars; charsDigest += p.digestChars;
    const t = byTool[p.tool] || (byTool[p.tool] = { parks: 0, chars: 0 });
    t.parks++; t.chars += p.chars;
  }
  for (const r of l.recalls) charsRecalled += r.chars;
  const net = Math.max(0, charsParked - charsDigest - charsRecalled);
  return {
    parks: l.parks.length, recalls: l.recalls.length, charsParked, charsDigest, charsRecalled,
    tokensSavedOnce: estimateTokens(net), tokensSavedPerTurn: estimateTokens(Math.max(0, charsParked - charsDigest)), byTool,
  };
}
