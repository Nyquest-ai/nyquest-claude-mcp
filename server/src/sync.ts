// Level sync between this machine and the website's Settings → Claude Code slider.
// Last writer wins by timestamp. Full mode only; every failure leaves local config alone.
import { loadConfig, saveConfig, clamp01, type Config } from "./config";
import { fullMode, getSettings, putSettings } from "./api";

export interface SyncResult {
  /** "pulled" (website was newer), "pushed" (local was newer), "same", "skipped" (local mode / offline) */
  action: "pulled" | "pushed" | "same" | "skipped";
  level: number;
}

export async function syncLevel(cfg: Config = loadConfig()): Promise<SyncResult> {
  if (!fullMode(cfg)) return { action: "skipped", level: cfg.level };
  const remote = await getSettings(cfg);
  if (!remote) return { action: "skipped", level: cfg.level };
  const localAt = cfg.levelUpdatedAt ? Date.parse(cfg.levelUpdatedAt) : 0;
  const remoteAt = remote.updated_at ? Date.parse(remote.updated_at) : 0;
  if (remote.level === null) {
    // Website has never set a level: publish ours so the slider shows the truth.
    const r = await putSettings(cfg.level, cfg);
    return { action: r ? "pushed" : "skipped", level: cfg.level };
  }
  if (Math.abs(remote.level - cfg.level) < 0.005) return { action: "same", level: cfg.level };
  if (remoteAt >= localAt) {
    cfg.level = clamp01(remote.level);
    cfg.levelUpdatedAt = remote.updated_at || new Date().toISOString();
    saveConfig(cfg);
    return { action: "pulled", level: cfg.level };
  }
  const r = await putSettings(cfg.level, cfg);
  return { action: r ? "pushed" : "skipped", level: cfg.level };
}
