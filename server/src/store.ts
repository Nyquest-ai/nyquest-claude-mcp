// Local parked-output store: ~/.nyquest/ctx/<session>/<id>.txt + index.json
import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { nyquestHome } from "./config";

export interface ParkedEntry {
  id: string;
  session: string;
  tool: string;
  command?: string;
  cls: string;
  chars: number;
  lines: number;
  digestChars: number;
  created: string;
  recalls: number;
}

export function ctxRoot(): string {
  return path.join(nyquestHome(), "ctx");
}

function sessionDir(session: string): string {
  return path.join(ctxRoot(), safe(session));
}

function safe(s: string): string {
  return String(s || "unknown").replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 80);
}

export function makeId(seed: string): string {
  return "nyq:" + crypto.createHash("sha1").update(seed + ":" + Date.now() + ":" + Math.random()).digest("hex").slice(0, 6);
}

function readIndex(dir: string): ParkedEntry[] {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, "index.json"), "utf8"));
  } catch {
    return [];
  }
}

function writeIndex(dir: string, entries: ParkedEntry[]): void {
  fs.writeFileSync(path.join(dir, "index.json"), JSON.stringify(entries, null, 1));
}

export function park(session: string, text: string, meta: Omit<ParkedEntry, "id" | "session" | "created" | "recalls" | "chars" | "lines">): ParkedEntry {
  const dir = sessionDir(session);
  fs.mkdirSync(dir, { recursive: true });
  const id = makeId(session + meta.tool);
  fs.writeFileSync(path.join(dir, id.slice(4) + ".txt"), text);
  const entry: ParkedEntry = {
    id, session: safe(session), created: new Date().toISOString(), recalls: 0,
    chars: text.length, lines: text.split("\n").length, ...meta,
  };
  const idx = readIndex(dir);
  idx.push(entry);
  writeIndex(dir, idx);
  return entry;
}

export interface Located { entry: ParkedEntry; file: string; dir: string }

/** Find a parked id, preferring the given session, then any session. */
export function locate(id: string, session?: string): Located | undefined {
  const norm = id.startsWith("nyq:") ? id : "nyq:" + id;
  const dirs: string[] = [];
  if (session) dirs.push(sessionDir(session));
  try {
    for (const d of fs.readdirSync(ctxRoot())) dirs.push(path.join(ctxRoot(), d));
  } catch { /* no store yet */ }
  for (const dir of dirs) {
    const entry = readIndex(dir).find((e) => e.id === norm);
    if (entry) {
      const file = path.join(dir, norm.slice(4) + ".txt");
      if (fs.existsSync(file)) return { entry, file, dir };
    }
  }
  return undefined;
}

export function readParked(loc: Located): string {
  return fs.readFileSync(loc.file, "utf8");
}

export function bumpRecall(loc: Located): void {
  const idx = readIndex(loc.dir);
  const e = idx.find((x) => x.id === loc.entry.id);
  if (e) { e.recalls++; writeIndex(loc.dir, idx); }
}

export function listSession(session: string): ParkedEntry[] {
  return readIndex(sessionDir(session));
}

/** Delete session directories older than retentionDays. Returns count removed. */
export function purgeOld(retentionDays: number): number {
  let removed = 0;
  const cutoff = Date.now() - retentionDays * 86_400_000;
  try {
    for (const d of fs.readdirSync(ctxRoot())) {
      const p = path.join(ctxRoot(), d);
      let mtime = 0;
      try { mtime = fs.statSync(p).mtimeMs; } catch { continue; }
      if (mtime < cutoff) { fs.rmSync(p, { recursive: true, force: true }); removed++; }
    }
  } catch { /* no store */ }
  return removed;
}

/** The most recently active session directory, for when the MCP process has no session id. */
export function latestSession(): string | undefined {
  let best: { name: string; mtime: number } | undefined;
  try {
    for (const d of fs.readdirSync(ctxRoot())) {
      const p = path.join(ctxRoot(), d, "index.json");
      let mtime = 0;
      try { mtime = fs.statSync(p).mtimeMs; } catch { continue; }
      if (!best || mtime > best.mtime) best = { name: d, mtime };
    }
  } catch { /* none */ }
  return best?.name;
}

export function storeSize(): { sessions: number; bytes: number } {
  let sessions = 0, bytes = 0;
  try {
    for (const d of fs.readdirSync(ctxRoot())) {
      sessions++;
      const p = path.join(ctxRoot(), d);
      for (const f of fs.readdirSync(p)) { try { bytes += fs.statSync(path.join(p, f)).size; } catch { /* skip */ } }
    }
  } catch { /* none */ }
  return { sessions, bytes };
}
