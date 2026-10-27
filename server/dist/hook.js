"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extract = extract;
exports.handlePostToolUse = handlePostToolUse;
// Claude Code hook entry point.
//   PostToolUse: park large tool results, return a digest via updatedToolOutput.
//   SessionStart (--session-start): print a status line, purge old sessions.
// Fail-open: on any error, print nothing and exit 0 so Claude sees the original.
const fs = require("node:fs");
const path = require("node:path");
const config_1 = require("./config");
const digest_1 = require("./digest");
const settings_1 = require("./settings");
const fsutil_1 = require("./fsutil");
const store_1 = require("./store");
const version_1 = require("./version");
const ledger_1 = require("./ledger");
const tokens_1 = require("./tokens");
const api_1 = require("./api");
const api = require("./api");
const sync_1 = require("./sync");
const update_1 = require("./update");
/**
 * Targeted reads: grep, sed -n, head, tail, awk, their PowerShell equivalents, or
 * anything piped through head/tail. These are the excerpts the model asked for; a
 * digest would remove the very lines it wanted. A leading `cd dir &&` is ignored.
 */
const TARGETED_READ = /^\s*(?:grep|rg|sed\s+-n|head|tail|awk|Select-String)\b|\|\s*(?:head|tail|Select-String|Select-Object\s+-(?:First|Last))\b|\bGet-Content\b[^|]*-(?:Head|Tail|TotalCount)\b/i;
const TARGETED_READ_MAX_CHARS = 8_000;
/** Estimated size of the parking note (additionalContext) that enters the context with every park. */
const NOTE_TOKENS = 85;
function log(line) {
    try {
        fs.mkdirSync((0, config_1.nyquestHome)(), { recursive: true });
        fs.appendFileSync(path.join((0, config_1.nyquestHome)(), "hook.log"), `${new Date().toISOString()} ${line}\n`);
    }
    catch { /* ignore */ }
}
/** Record the top-level shape of each tool's response once, so unknown shapes get learned from real sessions. */
function learnShape(tool, resp) {
    try {
        const shape = resp === null ? "null" : Array.isArray(resp)
            ? `array[${resp.length}]<${resp[0] && typeof resp[0] === "object" ? Object.keys(resp[0]).join(",") : typeof resp[0]}>`
            : typeof resp === "object" ? "{" + Object.keys(resp).map((k) => `${k}:${typeof resp[k]}`).join(",") + "}" : typeof resp;
        const f = path.join((0, config_1.nyquestHome)(), "shapes.json");
        const known = (0, fsutil_1.readJsonFile)(f) || {};
        const arr = known[tool] || (known[tool] = []);
        if (!arr.includes(shape)) {
            arr.push(shape);
            (0, fsutil_1.writeJsonAtomic)(f, known);
        }
    }
    catch { /* ignore */ }
}
/** Pull the text out of a tool_response and know how to put a replacement back in the same shape. */
function extract(resp) {
    if (typeof resp === "string")
        return { text: resp, rebuild: (d) => d };
    if (Array.isArray(resp)) {
        // MCP-style content blocks: [{type:"text", text}]
        const texts = resp.filter((b) => b && typeof b === "object" && b.type === "text" && typeof b.text === "string");
        if (texts.length && texts.length === resp.length) {
            return { text: texts.map((b) => b.text).join("\n"), rebuild: (d) => [{ type: "text", text: d }] };
        }
        return undefined;
    }
    if (resp && typeof resp === "object") {
        const o = resp;
        if (typeof o.stdout === "string") {
            // Bash: {stdout, stderr, interrupted, isImage}
            const stderr = typeof o.stderr === "string" ? o.stderr : "";
            const text = stderr ? `${o.stdout}\n[stderr]\n${stderr}` : o.stdout;
            return { text, rebuild: (d) => ({ ...o, stdout: d, stderr: "" }) };
        }
        for (const key of ["content", "output", "result", "text"]) {
            const v = o[key];
            if (typeof v === "string")
                return { text: v, rebuild: (d) => ({ ...o, [key]: d }) };
            if (Array.isArray(v)) {
                const inner = extract(v);
                if (inner)
                    return { text: inner.text, rebuild: (d) => ({ ...o, [key]: inner.rebuild(d) }) };
            }
        }
    }
    return undefined;
}
function commandOf(tool, input) {
    if (!input)
        return undefined;
    for (const k of ["command", "url", "prompt", "query", "pattern", "description"]) {
        if (typeof input[k] === "string")
            return String(input[k]).slice(0, 200);
    }
    return undefined;
}
async function handlePostToolUse(input, cfg) {
    const tool = input.tool_name || "";
    const session = input.session_id || "unknown";
    if (!cfg.enabled || !(0, config_1.toolEligible)(tool, cfg))
        return undefined;
    learnShape(tool, input.tool_response);
    const ex = extract(input.tool_response);
    if (!ex) {
        (0, ledger_1.recordSkip)(session, "unknown-shape:" + tool);
        return undefined;
    }
    const threshold = (0, config_1.thresholdFor)(cfg.level);
    if (ex.text.length < threshold)
        return undefined;
    // Claude Code already persists Bash output above bashOutputMaxChars (30 KB unless
    // the user raised it) to a file and shows the model a ~2 KB preview; the hook
    // receives the truncation. Nothing to gain there, and replacing the preview would
    // only hide the saved-file path. Learned from real responses (shapes.json): a
    // persisted Bash result carries persistedOutputPath / persistedOutputSize. The
    // length check stays as a fallback for older versions.
    const resp = input.tool_response;
    const persisted = !!(resp && typeof resp === "object" && (resp.persistedOutputPath || resp.persistedOutputSize));
    if (persisted || ex.text.includes("<persisted-output>") || (tool === "Bash" && ex.text.length >= (0, settings_1.bashPersistLimit)(input.cwd))) {
        (0, ledger_1.recordSkip)(session, "already-persisted-by-claude-code");
        return undefined;
    }
    const command = commandOf(tool, input.tool_input);
    const bare = command ? command.replace(/^\s*cd\s+[^&;|]+(?:&&|;)\s*/, "") : undefined;
    if (bare && TARGETED_READ.test(bare) && ex.text.length < TARGETED_READ_MAX_CHARS) {
        (0, ledger_1.recordSkip)(session, "targeted-read");
        return undefined;
    }
    let { cls, digest, lines } = (0, digest_1.makeDigest)(ex.text, tool, command);
    if (cls === "code" && !(0, config_1.codeParkingEnabled)(cfg.level)) {
        (0, ledger_1.recordSkip)(session, "code-untouched");
        return undefined;
    }
    if (cls === "prose" && ex.text.length < (0, config_1.proseThresholdFor)(cfg.level)) {
        (0, ledger_1.recordSkip)(session, "prose-below-threshold");
        return undefined;
    }
    // Full mode: prose from web and agent tools gets semantic condensation on the
    // Nyquest platform. Shell, file and MCP output never leaves the machine unless the
    // user opted the tool in (remoteTools). Any failure or a non-smaller result keeps
    // the local head/tail digest.
    let method = "local";
    if (cls === "prose" && (0, api_1.fullMode)(cfg)) {
        if (!(0, config_1.remoteEligible)(tool, cfg)) {
            (0, ledger_1.recordSkip)(session, "remote-not-eligible");
        }
        else {
            const r = await (0, api_1.condense)(ex.text, cls, cfg);
            if (r && r.smaller && r.digest.length < digest.length) {
                digest = `[nyquest digest: prose, condensed by Nyquest (${r.model}); ~${(0, tokens_1.fmt)(r.original_tokens)} → ~${(0, tokens_1.fmt)(r.condensed_tokens)} tokens. Model-written summary; recall for exact text]\n` + r.digest;
                method = "condense";
            }
            else {
                (0, ledger_1.recordSkip)(session, r ? "condense-not-smaller" : "condense-unavailable");
            }
        }
    }
    // Net-saving gate on the whole replacement: digest + footer + the parking note that
    // enters the context with it. The old 85% check looked at the bare digest and let
    // through parks that dropped a dozen lines to save under a hundred tokens.
    const footerChars = (0, digest_1.footer)("nyq:000000", lines, ex.text.length, cls, method).length;
    const originalTokens = (0, tokens_1.estimateTokens)(ex.text.length);
    const replacementTokens = (0, tokens_1.estimateTokens)(digest.length + footerChars);
    const netSaved = originalTokens - replacementTokens - (cfg.showSavings ? NOTE_TOKENS : 0);
    if (netSaved < cfg.minSavingTokens || replacementTokens > originalTokens * 0.7) {
        (0, ledger_1.recordSkip)(session, "saving-too-small");
        return undefined;
    }
    const entry = (0, store_1.park)(session, ex.text, { tool, command, cls, digestChars: digest.length });
    const body = digest + "\n" + (0, digest_1.footer)(entry.id, lines, ex.text.length, cls, method);
    (0, ledger_1.recordPark)(session, { id: entry.id, tool, cls, chars: ex.text.length, digestChars: body.length });
    // Full mode: tell the account about this park (counts only, never content) so the
    // website's savings page reflects local-mode savings too. Bounded and fail-open.
    if ((0, api_1.fullMode)(cfg)) {
        const n = await (0, api_1.reportParks)([{ tool, kind: cls, method, chars_in: ex.text.length, chars_out: body.length, tokens_in: (0, tokens_1.estimateTokens)(ex.text.length), tokens_out: (0, tokens_1.estimateTokens)(body.length) }], cfg);
        log(`report ${entry.id} accepted=${n}${n ? "" : ` error=${api.lastError || "unknown"}`}`);
    }
    const saved = (0, tokens_1.estimateTokens)(ex.text.length) - (0, tokens_1.estimateTokens)(body.length);
    const out = {
        hookSpecificOutput: { hookEventName: "PostToolUse", updatedToolOutput: ex.rebuild(body) },
    };
    if (cfg.showSavings) {
        // Only advertise ask= where it is allowed: the parked text would be sent to the platform.
        const askHint = (0, api_1.fullMode)(cfg) && (0, config_1.remoteEligible)(tool, cfg) ? ` (recall(id="${entry.id}", ask="...") returns just an answer)` : "";
        out.hookSpecificOutput.additionalContext =
            `Nyquest parked this ${cls} output as ${entry.id}: ~${(0, tokens_1.fmt)((0, tokens_1.estimateTokens)(ex.text.length))} → ~${(0, tokens_1.fmt)((0, tokens_1.estimateTokens)(body.length))} tokens (est., ${(0, tokens_1.fmt)(saved)} kept out of context on every later turn). ${(0, digest_1.guarantee)(cls, method)}; recall only if a detail you need is absent${askHint}.`;
        // systemMessage is shown to the USER by Claude Code; additionalContext above goes to Claude.
        out.systemMessage = `Nyquest: parked ${cls} output ${entry.id}, ~${(0, tokens_1.fmt)((0, tokens_1.estimateTokens)(ex.text.length))} → ~${(0, tokens_1.fmt)((0, tokens_1.estimateTokens)(body.length))} tokens (est.), ${(0, tokens_1.fmt)(saved)} kept out of context on every later turn.`;
    }
    log(`park ${entry.id} tool=${tool} cls=${cls} method=${method} chars=${ex.text.length} digest=${body.length} session=${session}`);
    return out;
}
async function sessionStart(input, cfg) {
    const removed = (0, store_1.purgeOld)(cfg.retentionDays);
    // Housekeeping on the same clock: counters for sessions that have gone quiet, and this
    // hook's own log, which nothing else bounds.
    (0, store_1.purgeLedgers)(cfg.retentionDays);
    (0, store_1.trimLog)();
    const size = (0, store_1.storeSize)();
    const mode = (0, api_1.fullMode)(cfg) ? "full" : "local";
    // Full mode: reconcile the slider with the website (last writer wins). Bounded, fail-open.
    let synced = "";
    let remoteLatest;
    try {
        const s = await (0, sync_1.syncLevel)(cfg);
        remoteLatest = s.latestVersion;
        if (s.action === "pulled") {
            cfg.level = s.level;
            synced = ` Level ${s.level} pulled from your Nyquest account settings.`;
        }
        else if (s.action === "pushed")
            synced = " Level published to your Nyquest account settings.";
    }
    catch { /* offline or no key */ }
    // Update nudge: this build against the marketplace catalog Claude Code keeps on disk
    // (no network), and against the version the platform reported above in full mode.
    let update = "";
    try {
        const u = (0, update_1.updateAvailable)({ remoteLatest });
        if (u)
            update = ` Nyquest ${u.latest} is available (this session runs ${u.installed}): ${u.command}, then /reload-plugins.`;
    }
    catch { /* never block the status line */ }
    const l = (0, ledger_1.loadLedger)(input.session_id || "unknown");
    const s = (0, ledger_1.summarize)(l);
    const prior = s.parks ? ` This session so far: ${s.parks} parked, ${s.recalls} recalls.` : "";
    if (!cfg.enabled)
        return `Nyquest context manager ${version_1.VERSION}: OFF (NYQUEST_COMPRESS=off or disabled in ~/.nyquest/config.json). Say "turn Nyquest on" to re-enable.${update}`;
    const hint = mode === "local" ? " Full mode (free, adds platform condensation and recall(ask=...)): /nyquest:setup." : "";
    return `Nyquest context manager ${version_1.VERSION}: ${mode} mode, level ${cfg.level} (/nyquest:level to change), results over ~${(0, tokens_1.fmt)((0, tokens_1.estimateTokens)((0, config_1.thresholdFor)(cfg.level)))} tokens are parked with a digest; use the nyquest recall tool for exact text. Store: ${size.sessions} sessions, ${(0, tokens_1.fmt)(Math.round(size.bytes / 1024))} KB${removed ? `, purged ${removed} expired` : ""}.${prior}${synced}${update}${hint}`;
}
async function main() {
    const chunks = [];
    for await (const c of process.stdin)
        chunks.push(c);
    const raw = Buffer.concat(chunks).toString("utf8");
    let input = {};
    try {
        input = raw.trim() ? JSON.parse(raw) : {};
    }
    catch {
        input = {};
    }
    const cfg = (0, config_1.loadConfig)();
    if (process.argv.includes("--session-start") || input.hook_event_name === "SessionStart") {
        // Both audiences: additionalContext for Claude, systemMessage for the user's screen.
        const line = await sessionStart(input, cfg);
        process.stdout.write(JSON.stringify({
            systemMessage: line,
            hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: line },
        }));
        return;
    }
    if (input.hook_event_name !== "PostToolUse")
        return;
    const out = await handlePostToolUse(input, cfg);
    if (out)
        process.stdout.write(JSON.stringify(out));
}
if (require.main === module) {
    main().catch((e) => { log("error " + (e && e.stack ? e.stack : String(e))); process.exitCode = 0; });
}
