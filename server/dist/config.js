"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.REMOTE_OK = exports.NEVER_PARK = exports.DEFAULTS = void 0;
exports.nyquestHome = nyquestHome;
exports.configPath = configPath;
exports.loadConfig = loadConfig;
exports.pluginOptionApiKey = pluginOptionApiKey;
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
    // The API key. Since 0.6.0 it is the plugin's `api_key` option (userConfig, marked
    // sensitive: Claude Code prompts for it and stores it with its own login, in the macOS
    // Keychain or its protected credentials file elsewhere).
    // Claude Code exports it to hook processes as CLAUDE_PLUGIN_OPTION_API_KEY, and .mcp.json
    // substitutes it into the MCP server's environment under the same name. A key saved in
    // config.json by configure(apiKey=...) is used when the option is empty.
    //
    // NYQUEST_API_KEY is deliberately not read any more. The plugin directory holds a plugin
    // that takes a credential already present in the user's environment and sends it to a
    // server, and asks for it through userConfig instead, which is what this is.
    cfg.fileApiKey = typeof cfg.apiKey === "string" && cfg.apiKey ? cfg.apiKey : undefined;
    cfg.apiKey = cfg.fileApiKey;
    cfg.apiKeySource = cfg.fileApiKey ? "file" : undefined;
    const option = pluginOptionApiKey();
    if (option) {
        cfg.apiKey = option;
        cfg.apiKeySource = "plugin";
    }
    cfg.level = clamp01(cfg.level);
    if (typeof cfg.minSavingTokens !== "number" || !Number.isFinite(cfg.minSavingTokens) || cfg.minSavingTokens < 0)
        cfg.minSavingTokens = exports.DEFAULTS.minSavingTokens;
    return cfg;
}
/**
 * The plugin option's value, or undefined when it is unset. An option left empty arrives as
 * "", and a client too old to substitute `${user_config.api_key}` in .mcp.json passes the
 * placeholder through verbatim; neither is a key.
 */
function pluginOptionApiKey() {
    const v = (process.env.CLAUDE_PLUGIN_OPTION_API_KEY || "").trim();
    if (!v || v.includes("${"))
        return undefined;
    return v;
}
function saveConfig(cfg) {
    // Only the key that came from this file goes back into it. The key in effect may be the
    // plugin option, which Claude Code keeps with its own login, and writing that into a
    // plain file would undo the point of it. Until 0.6.0 this wrote the effective key, so any
    // save (a level change, or the website's level winning a sync) copied a NYQUEST_API_KEY
    // from the environment into config.json.
    const { apiKey, apiKeySource, fileApiKey, ...rest } = cfg;
    const out = { ...rest };
    if (fileApiKey)
        out.apiKey = fileApiKey;
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
