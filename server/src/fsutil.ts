// Atomic file writes and tolerant JSON reads for a store shared by parallel hook
// processes. Parallel tool calls run parallel hooks; a write is a sibling temp file
// renamed over the target, so a reader sees either the old or the new content and
// never a half-written file. Windows can refuse a rename or an open for a moment while
// another process holds the file (antivirus, a concurrent reader), so both directions
// retry briefly before giving up.
import * as fs from "node:fs";
import * as path from "node:path";

const TRANSIENT = new Set(["EPERM", "EBUSY", "EACCES", "EAGAIN"]);

function pause(ms: number): void {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch {
    /* SharedArrayBuffer unavailable: skip the pause */
  }
}

export function writeFileAtomic(file: string, data: string): void {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`);
  fs.writeFileSync(tmp, data);
  let lastErr: unknown;
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      fs.renameSync(tmp, file);
      return;
    } catch (e) {
      lastErr = e;
      if (!TRANSIENT.has((e as NodeJS.ErrnoException).code || "")) break;
      pause(5 + attempt * 10);
    }
  }
  try { fs.unlinkSync(tmp); } catch { /* ignore */ }
  throw lastErr;
}

export function writeJsonAtomic(file: string, value: unknown, indent = 1): void {
  writeFileAtomic(file, JSON.stringify(value, null, indent));
}

/**
 * Read and parse a JSON file. A missing file is undefined at once. A transient sharing
 * error, or a torn read of a file written by an older non-atomic version, is retried
 * briefly; callers must treat undefined as "unknown", never as "empty", so a hiccup
 * can never turn into an overwrite that loses data.
 */
export function readJsonFile<T>(file: string): T | undefined {
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      return JSON.parse(fs.readFileSync(file, "utf8")) as T;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return undefined;
      if (!TRANSIENT.has(code || "") && !(e instanceof SyntaxError)) return undefined;
      pause(5 + attempt * 10);
    }
  }
  return undefined;
}
