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

/** Delete parked entries older than retentionDays, anywhere in the store. Returns entries removed.
 *
 * This used to judge retention on the session DIRECTORY's mtime, which meant a session that
 * stayed in use never expired anything: every new park refreshed the directory, so its oldest
 * payloads outlived the promise for as long as the session lived. Measured on a real store
 * 2026-10-02 with retentionDays 7: 200 payloads past the cutoff, 2.5 MB, the oldest 18 days
 * old, in a session still being used daily. Retention is a privacy promise, so it is now
 * applied per entry and the directory's own mtime means nothing.
 *
 * A payload with no metadata is swept on its own mtime. 0.3.0 kept one shared index.json, so
 * its entries are left with no metadata once that file goes and nothing would ever reclaim
 * them. Anything younger than the cutoff is always left alone, which is what keeps a park
 * that is still being written (text first, metadata second) safe from this sweep.
 */
export function purgeOld(retentionDays: number): number {
  let removed = 0;
  const cutoff = Date.now() - retentionDays * 86_400_000;
  let sessions: string[];
  try { sessions = fs.readdirSync(ctxRoot()); } catch { return 0; }
  for (const d of sessions) {
    const dir = path.join(ctxRoot(), d);
    let names: string[];
    try { names = fs.readdirSync(dir); } catch { continue; }
    const legacyFile = path.join(dir, "index.json");
    const legacy = names.includes("index.json")
      ? (readJsonFile<ParkedEntry[]>(legacyFile) || []).filter((e) => e && e.id)
      : [];
    // created, per entry base name, from whichever metadata carries it.
    const created = new Map<string, string | undefined>();
    const bases = new Set<string>();
    for (const e of legacy) { bases.add(e.id.slice(4)); created.set(e.id.slice(4), e.created); }
    for (const f of names) {
      if (f === "index.json" || f.startsWith(".")) continue;
      if (f.endsWith(".json")) {
        const base = f.slice(0, -5);
        bases.add(base);
        const e = readJsonFile<ParkedEntry>(path.join(dir, f));
        if (e && e.created) created.set(base, e.created);
      } else if (f.endsWith(".txt")) bases.add(f.slice(0, -4));
    }
    for (const base of bases) {
      let at = Date.parse(created.get(base) || "");
      if (Number.isNaN(at)) {
        // No usable metadata: fall back to the files themselves, oldest wins.
        at = Date.now();
        for (const ext of [".json", ".txt"]) {
          try { at = Math.min(at, fs.statSync(path.join(dir, base + ext)).mtimeMs); } catch { /* try the other */ }
        }
      }
      if (at >= cutoff) continue;
      let gone = false;
      for (const ext of [".txt", ".json"]) {
        try { fs.unlinkSync(path.join(dir, base + ext)); gone = true; }
        catch (err) { if ((err as { code?: string }).code === "ENOENT") continue; }
      }
      if (gone) removed++;
    }
    if (legacy.length) {
      // Keep only the legacy entries whose payload survived; drop the file when none did.
      const kept = legacy.filter((e) => fs.existsSync(path.join(dir, e.id.slice(4) + ".txt")));
      try {
        if (!kept.length) fs.unlinkSync(legacyFile);
        else if (kept.length !== legacy.length) writeJsonAtomic(legacyFile, kept);
      } catch { /* the next sweep tries again */ }
    }
    try { if (!fs.readdirSync(dir).length) fs.rmdirSync(dir); } catch { /* keep it */ }
  }
  return removed;
}

/** Drop per-session savings ledgers that have been idle for retentionDays. Returns files removed.
 *
 * ~/.nyquest/sessions/<session>.json holds counters only, and nothing ever pruned them: they
 * accumulated for every session that ever ran and outlived the parked entries they describe.
 * Idleness, not age, is the test here: a session resumed over weeks keeps the counters its own
 * status line reports, while a session that has gone quiet releases them.
 */
export function purgeLedgers(retentionDays: number): number {
  let removed = 0;
  const cutoff = Date.now() - retentionDays * 86_400_000;
  const dir = path.join(nyquestHome(), "sessions");
  let names: string[];
  try { names = fs.readdirSync(dir); } catch { return 0; }
  for (const f of names) {
    if (!f.endsWith(".json")) continue;
    const p = path.join(dir, f);
    try {
      if (fs.statSync(p).mtimeMs >= cutoff) continue;
      fs.unlinkSync(p);
      removed++;
    } catch { /* leave it for the next sweep */ }
  }
  return removed;
}

/** Keep the hook's own append-only log bounded, newest lines first to go nowhere. Returns true when trimmed.
 *
 * Nothing else trims it, so it grew for the life of the install. It records ids, tool names and
 * sizes, so it also outlived the entries it describes. Parallel hooks append to this file; a trim
 * can lose a line written in the same instant, which is the right trade for a debug log.
 */
export function trimLog(maxBytes = 512 * 1024): boolean {
  const file = path.join(nyquestHome(), "hook.log");
  try {
    if (fs.statSync(file).size <= maxBytes) return false;
    const keep = Math.floor(maxBytes / 2);
    const text = fs.readFileSync(file, "utf8");
    const tail = text.slice(-keep);
    const from = tail.indexOf("\n");                 // start on a line boundary
    const tmp = file + "." + process.pid + ".tmp";
    fs.writeFileSync(tmp, (from >= 0 ? tail.slice(from + 1) : tail));
    fs.renameSync(tmp, file);
    return true;
  } catch { return false; }
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
