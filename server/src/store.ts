// Local parked-output store: ~/.nyquest/ctx/<session>/<id>.txt + <id>.json
// One small metadata file per entry, so parallel hooks never rewrite a shared index and
// nothing can be lost to a concurrent writer. Sessions written by 0.3.0 and earlier
// carry a single index.json; it is still read, and a recall on one of its entries
// migrates that entry to its own file.
import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { nyquestHome } from "./config";
import { writeJsonAtomic, readJsonFile } from "./fsutil";

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

function entryFile(dir: string, id: string): string {
  return path.join(dir, id.slice(4) + ".json");
}

/** Every entry of a session directory: per-entry files, plus the legacy index.json if present. */
function readIndex(dir: string): ParkedEntry[] {
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const byId = new Map<string, ParkedEntry>();
  if (names.includes("index.json")) {
    const legacy = readJsonFile<ParkedEntry[]>(path.join(dir, "index.json"));
    if (Array.isArray(legacy)) for (const e of legacy) if (e && e.id) byId.set(e.id, e);
  }
  for (const f of names) {
    if (f === "index.json" || f.startsWith(".") || !f.endsWith(".json")) continue;
    const e = readJsonFile<ParkedEntry>(path.join(dir, f));
    if (e && typeof e === "object" && e.id) byId.set(e.id, e);
  }
  return [...byId.values()].sort((a, b) => (a.created < b.created ? -1 : a.created > b.created ? 1 : 0));
}

export function park(session: string, text: string, meta: Omit<ParkedEntry, "id" | "session" | "created" | "recalls" | "chars" | "lines">): ParkedEntry {
  const dir = sessionDir(session);
  fs.mkdirSync(dir, { recursive: true });
  let id = makeId(session + meta.tool);
  while (fs.existsSync(entryFile(dir, id)) || fs.existsSync(path.join(dir, id.slice(4) + ".txt"))) id = makeId(session + meta.tool + id);
  fs.writeFileSync(path.join(dir, id.slice(4) + ".txt"), text);
  const entry: ParkedEntry = {
    id, session: safe(session), created: new Date().toISOString(), recalls: 0,
    chars: text.length, lines: text.split("\n").length, ...meta,
  };
  writeJsonAtomic(entryFile(dir, id), entry);
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
  loc.entry.recalls++;
  try {
    writeJsonAtomic(entryFile(loc.dir, loc.entry.id), loc.entry);
  } catch { /* a recall counter must never block the recall */ }
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
      let mtime = 0;
      try { mtime = fs.statSync(path.join(ctxRoot(), d)).mtimeMs; } catch { continue; }
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
