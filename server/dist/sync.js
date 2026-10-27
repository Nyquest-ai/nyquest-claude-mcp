"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.syncLevel = syncLevel;
// Level sync between this machine and the website's Settings → Claude Code slider.
// Last writer wins by timestamp. Full mode only; every failure leaves local config alone.
const config_1 = require("./config");
const api_1 = require("./api");
async function syncLevel(cfg = (0, config_1.loadConfig)()) {
    if (!(0, api_1.fullMode)(cfg))
        return { action: "skipped", level: cfg.level };
    const remote = await (0, api_1.getSettings)(cfg);
    if (!remote)
        return { action: "skipped", level: cfg.level };
    const localAt = cfg.levelUpdatedAt ? Date.parse(cfg.levelUpdatedAt) : 0;
    const remoteAt = remote.updated_at ? Date.parse(remote.updated_at) : 0;
    if (remote.level === null) {
        // Website has never set a level: publish ours so the slider shows the truth.
        const r = await (0, api_1.putSettings)(cfg.level, cfg);
        return { action: r ? "pushed" : "skipped", level: cfg.level, latestVersion: remote.latestVersion };
    }
    if (Math.abs(remote.level - cfg.level) < 0.005)
        return { action: "same", level: cfg.level, latestVersion: remote.latestVersion };
    if (remoteAt >= localAt) {
        cfg.level = (0, config_1.clamp01)(remote.level);
        cfg.levelUpdatedAt = remote.updated_at || new Date().toISOString();
        (0, config_1.saveConfig)(cfg);
        return { action: "pulled", level: cfg.level, latestVersion: remote.latestVersion };
    }
    const r = await (0, api_1.putSettings)(cfg.level, cfg);
    return { action: r ? "pushed" : "skipped", level: cfg.level, latestVersion: remote.latestVersion };
}
