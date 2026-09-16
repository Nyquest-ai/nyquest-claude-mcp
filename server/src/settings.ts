// Claude Code's own large-output handling. Bash output above `bashOutputMaxChars`
// (30,000 by default, raisable to 128K in settings.json since Claude Code 2.1.261) is
// saved to a file and the model sees a short preview, so the hook must leave those
// results alone. Reading the setting keeps the hand-off point in step with the user's
// configuration instead of a hardcoded 30 KB.
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

export const DEFAULT_PERSIST_LIMIT = 30_000;

function readJson(file: string): Record<string, unknown> | undefined {
  try {
    const v = JSON.parse(fs.readFileSync(file, "utf8"));
    return v && typeof v === "object" ? (v as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

/** Resolve bashOutputMaxChars from parsed settings objects; later objects win. */
export function persistLimit(...settings: Array<Record<string, unknown> | undefined>): number {
  let limit = DEFAULT_PERSIST_LIMIT;
  for (const s of settings) {
    const v = s?.bashOutputMaxChars;
    if (typeof v === "number" && Number.isFinite(v) && v >= 1_000) limit = Math.floor(v);
  }
  return limit;
}

/** User settings, then the project's settings.json and settings.local.json (project wins). */
export function bashPersistLimit(cwd?: string): number {
  const configDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
  const files = [path.join(configDir, "settings.json")];
  if (cwd) files.push(path.join(cwd, ".claude", "settings.json"), path.join(cwd, ".claude", "settings.local.json"));
  return persistLimit(...files.map(readJson));
}
