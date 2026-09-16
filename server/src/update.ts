// Update nudge for the session-start line. The plugin never fetches anything to find
// out: it reads the marketplace catalog Claude Code already keeps on disk (refreshed by
// `/plugin marketplace update`, a named install, or marketplace auto-update) and
// compares the entry for this plugin with the running build. In full mode the platform
// may also report `latest_version` in the settings response the hook fetches anyway;
// the newest of the two wins. Claude Code performs the actual update.
import * as path from "node:path";
import * as os from "node:os";
import { readJsonFile } from "./fsutil";
import { VERSION } from "./version";

export const PLUGIN_NAME = "nyquest";
/** Guards against an unrelated plugin that happens to share the name. */
const REPO_HINT = "nyquest-claude-mcp";

export interface UpdateInfo {
  installed: string;
  latest: string;
  marketplace: string;
  command: string;
}

/** Numeric dotted comparison; a pre-release suffix is ignored. Returns -1, 0 or 1. */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => v.trim().replace(/^v/i, "").split(/[-+]/)[0].split(".").map((x) => parseInt(x, 10) || 0);
  const pa = parse(a), pb = parse(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d < 0 ? -1 : 1;
  }
  return 0;
}

export function claudeConfigDir(): string {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
}

interface InstalledPlugins { plugins?: Record<string, unknown> }
interface KnownMarketplaces { [name: string]: { installLocation?: string } }
interface Catalog { plugins?: Array<{ name?: string; version?: string; source?: unknown }> }

/** This plugin's catalog version in every marketplace it is installed from, per Claude Code's on-disk state. */
export function catalogVersions(configDir = claudeConfigDir()): Array<{ marketplace: string; version: string }> {
  const pluginsDir = path.join(configDir, "plugins");
  const installed = readJsonFile<InstalledPlugins>(path.join(pluginsDir, "installed_plugins.json"));
  const known = readJsonFile<KnownMarketplaces>(path.join(pluginsDir, "known_marketplaces.json")) || {};
  const out: Array<{ marketplace: string; version: string }> = [];
  for (const key of Object.keys(installed?.plugins || {})) {
    if (!key.startsWith(PLUGIN_NAME + "@")) continue;
    const marketplace = key.slice(PLUGIN_NAME.length + 1);
    const loc = known[marketplace]?.installLocation;
    if (!loc) continue;
    const catalog = readJsonFile<Catalog>(path.join(loc, ".claude-plugin", "marketplace.json"));
    const entry = (catalog?.plugins || []).find((p) => p.name === PLUGIN_NAME && JSON.stringify(p.source || "").includes(REPO_HINT));
    if (entry && typeof entry.version === "string") out.push({ marketplace, version: entry.version });
  }
  return out;
}

/** The newest known version when it is newer than this build, with the command that installs it. */
export function updateAvailable(opts: { configDir?: string; remoteLatest?: string | null; installed?: string } = {}): UpdateInfo | undefined {
  const installed = opts.installed || VERSION;
  const catalogs = catalogVersions(opts.configDir);
  let best: UpdateInfo | undefined;
  for (const c of catalogs) {
    if (compareVersions(c.version, installed) > 0 && (!best || compareVersions(c.version, best.latest) > 0)) {
      best = { installed, latest: c.version, marketplace: c.marketplace, command: `/plugin update ${PLUGIN_NAME}@${c.marketplace}` };
    }
  }
  const remote = opts.remoteLatest;
  if (remote && compareVersions(remote, installed) > 0 && (!best || compareVersions(remote, best.latest) > 0)) {
    // The platform knows a release no local catalog has seen yet: refresh the catalog first.
    const marketplace = best?.marketplace || catalogs[0]?.marketplace || PLUGIN_NAME;
    best = { installed, latest: remote, marketplace, command: `/plugin marketplace update ${marketplace}, then /plugin update ${PLUGIN_NAME}@${marketplace}` };
  }
  return best;
}
