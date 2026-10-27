"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.REMOTE_OK = exports.NEVER_PARK = exports.DEFAULTS = void 0;
exports.nyquestHome = nyquestHome;
exports.configPath = configPath;
exports.loadConfig = loadConfig;
exports.saveConfig = saveConfig;
exports.clamp01 = clamp01;
exports.thresholdFor = thresholdFor;
exports.proseThresholdFor = proseThresholdFor;
exports.codeParkingEnabled = codeParkingEnabled;
exports.toolEligible = toolEligible;
exports.remoteEligible = remoteEligible;
// User configuration: ~/.nyquest/config.json plus env overrides.
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const fsutil_1 = require("./fsutil");
exports.DEFAULTS = {
    enabled: true,
    level: 0.5,
    showSavings: true,
    retentionDays: 7,
    tools: {},
    remoteTools: {},
    minSavingTokens: 300,
};
function nyquestHome() {
    return process.env.NYQUEST_HOME || path.join(os.homedir(), ".nyquest");
}
function configPath() {
    return path.join(nyquestHome(), "config.json");
}
function loadConfig() {
    let cfg = { ...exports.DEFAULTS, tools: {}, remoteTools: {} };
    try {
        const raw = fs.readFileSync(configPath(), "utf8");
        const parsed = JSON.parse(raw);
        cfg = { ...cfg, ...parsed, tools: { ...(parsed.tools || {}) }, remoteTools: { ...(parsed.remoteTools || {}) } };
    }
    catch {
        /* no config yet */
    }
    const env = (process.env.NYQUEST_COMPRESS || "").toLowerCase();
    if (env === "off" || env === "0" || env === "false")
        cfg.enabled = false;
    if (process.env.NYQUEST_LEVEL) {
        const l = Number(process.env.NYQUEST_LEVEL);
        if (Number.isFinite(l))
            cfg.level = l;
    }
    if (process.env.NYQUEST_API_KEY)
        cfg.apiKey = process.env.NYQUEST_API_KEY;
    cfg.level = clamp01(cfg.level);
    if (typeof cfg.minSavingTokens !== "number" || !Number.isFinite(cfg.minSavingTokens) || cfg.minSavingTokens < 0)
        cfg.minSavingTokens = exports.DEFAULTS.minSavingTokens;
    return cfg;
}
function saveConfig(cfg) {
    const { apiKey, ...rest } = cfg;
    const out = { ...rest };
    if (apiKey)
        out.apiKey = apiKey;
    (0, fsutil_1.writeJsonAtomic)(configPath(), out, 2);
}
function clamp01(n) {
    if (!Number.isFinite(n))
        return exports.DEFAULTS.level;
    return Math.max(0, Math.min(1, n));
}
/** Characters above which a tool result is parked, by slider level. */
function thresholdFor(level) {
    if (level <= 0)
        return Number.POSITIVE_INFINITY;
    if (level < 0.4)
        return 16_000;
    if (level < 0.7)
        return 6_000;
    if (level < 0.95)
        return 3_000;
    return 2_000;
}
/**
 * Prose is parked only above twice the normal threshold. Phase 3 (2026-09-12): a
 * condensed prose digest is the lossy kind, and Claude verifies it with a recall
 * before answering factual questions, which costs a turn. Parking an 11.9 KB
 * docs dump lost money on every rerun; the digest only pays when the prose is big.
 */
function proseThresholdFor(level) {
    return thresholdFor(level) * 2;
}
/** Code listings fetched through Bash are only parked at high levels. */
function codeParkingEnabled(level) {
    return level >= 0.8;
}
/** Tools whose results are never parked, whatever the config says. */
exports.NEVER_PARK = new Set([
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
function toolEligible(tool, cfg) {
    if (exports.NEVER_PARK.has(tool))
        return false;
    if (tool.startsWith("mcp__plugin_nyquest"))
        return false; // never park our own tools
    if (cfg.tools[tool] === false)
        return false;
    return true;
}
/**
 * Tools whose prose may be sent to the Nyquest platform in full mode (condensation,
 * recall(ask=...)). Web pages and agent reports are already text the user asked for
 * from outside; shell output, files and MCP results stay on the machine unless the
 * user opts the tool in through `remoteTools`.
 */
exports.REMOTE_OK = new Set(["WebFetch", "WebSearch", "Agent", "Task", "digest_url"]);
function remoteEligible(tool, cfg) {
    const override = cfg.remoteTools[tool];
    if (override === true)
        return true;
    if (override === false)
        return false;
    return exports.REMOTE_OK.has(tool);
}
