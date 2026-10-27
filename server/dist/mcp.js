"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// Nyquest MCP server (stdio): recall, list_parked, digest_file, digest_url, savings, configure.
// The transport and JSON-RPC loop are in ./stdio, so this plugin has no third-party
// dependencies; see that file for why.
const stdio_1 = require("./stdio");
const fs = require("node:fs");
const path = require("node:path");
const config_1 = require("./config");
const store_1 = require("./store");
const ledger_1 = require("./ledger");
const digest_1 = require("./digest");
const tokens_1 = require("./tokens");
const version_1 = require("./version");
const api_1 = require("./api");
/** Session id: from the environment when Claude Code provides one, else the most recently active parked session. Resolved per call, since sessions start after this process. */
function sessionId() {
    return process.env.CLAUDE_SESSION_ID || process.env.CLAUDE_CODE_SESSION_ID || (0, store_1.latestSession)() || "mcp";
}
const MAX_RETURN = 60_000;
function text(s) {
    return { content: [{ type: "text", text: s }] };
}
function parseRange(r, n) {
    const m = r.trim().match(/^(\d+)\s*(?:-\s*(\d+))?$/);
    if (!m)
        return undefined;
    const a = Math.max(1, parseInt(m[1], 10));
    const b = m[2] ? Math.min(n, parseInt(m[2], 10)) : Math.min(n, a + 199);
    return a <= b ? [a, b] : undefined;
}
// `reg` keeps the call shape the SDK used, so each tool below reads as it did. What
// changed is that inputSchema is now the JSON Schema that tools/list returns, written
// out rather than compiled from a zod object at startup.
const TOOLS = [];
function reg(name, cfg, handler) {
    TOOLS.push({ name, description: cfg.description, inputSchema: cfg.inputSchema, handler });
}
reg("recall", {
    description: "Retrieve exact text from a tool result that Nyquest parked (ids look like nyq:7f3a9c). Use lines=\"a-b\" for a line range, grep=\"pattern\" (regex) with optional context, or omit both for the first 200 lines. Prefer this over re-running the command.",
    inputSchema: {
        type: "object",
        properties: {
            id: { type: "string", description: "Parked id, e.g. nyq:7f3a9c" },
            lines: { type: "string", description: "Line range like \"120-180\" or a single line \"57\"" },
            grep: { type: "string", description: "Regular expression to search for (case-insensitive)" },
            context: { type: "integer", minimum: 0, maximum: 20, description: "Context lines around grep matches (default 2)" },
            max_matches: { type: "integer", minimum: 1, maximum: 500, description: "Cap on grep matches (default 100)" },
            ask: { type: "string", description: "Full mode only: a question answered over the whole parked output by a Nyquest-routed model. Sends the parked text (secrets redacted) to the Nyquest platform, so it is allowed for web and agent results only; Bash, PowerShell, file and MCP output stays local unless the user opted the tool in." },
        },
        required: ["id"],
    },
}, async ({ id, lines, grep, context, max_matches, ask }) => {
    const loc = (0, store_1.locate)(id, sessionId());
    if (!loc)
        return text(`No parked output with id ${id}. Use list_parked to see what is available.`);
    const body = (0, store_1.readParked)(loc);
    const all = body.split("\n");
    (0, store_1.bumpRecall)(loc);
    let out;
    let mode;
    if (ask) {
        mode = "ask";
        const cfg = (0, config_1.loadConfig)();
        if (!(0, api_1.fullMode)(cfg)) {
            out = `recall(ask=...) needs Nyquest full mode: set an API key with configure(apiKey="nq-v1-...") (free, from app.nyquest.ai). Meanwhile use lines= or grep=. The output has ${all.length} lines.`;
        }
        else if (!(0, config_1.remoteEligible)(loc.entry.tool, cfg)) {
            out = `recall(ask=...) is not available for output parked from ${loc.entry.tool}: that text stays on this machine. Use lines= or grep= (the output has ${all.length} lines), or opt the tool in with configure(remoteTool="${loc.entry.tool}", remoteEnabled=true).`;
        }
        else {
            const r = await (0, api_1.ask)(body, ask, cfg);
            out = r
                ? `${id} (${all.length} lines), answered by Nyquest (${r.model}, ${r.ms} ms; ~${(0, tokens_1.fmt)(r.original_tokens)} tokens read, ~${(0, tokens_1.fmt)(r.answer_tokens)} returned):\n${r.answer}`
                : `Nyquest ask is unavailable right now (network, cap, or provider). Use recall(id="${id}", grep="...") or lines= instead. The output has ${all.length} lines.`;
        }
    }
    else if (grep) {
        mode = "grep";
        let re;
        try {
            re = new RegExp(grep, "i");
        }
        catch {
            return text(`Invalid regex: ${grep}`);
        }
        const ctx = context ?? 2, cap = max_matches ?? 100;
        const keep = new Set();
        let matches = 0;
        for (let i = 0; i < all.length && matches < cap; i++) {
            if (re.test(all[i])) {
                matches++;
                for (let j = Math.max(0, i - ctx); j <= Math.min(all.length - 1, i + ctx); j++)
                    keep.add(j);
            }
        }
        if (!matches)
            out = `No lines match /${grep}/i in ${id} (${all.length} lines).`;
        else {
            const parts = [`${matches} match(es) for /${grep}/i in ${id} (${all.length} lines), ${ctx} lines of context:`];
            let last = -2;
            for (const i of [...keep].sort((a, b) => a - b)) {
                if (i !== last + 1)
                    parts.push("--");
                parts.push(`${i + 1}: ${all[i]}`);
                last = i;
            }
            out = parts.join("\n");
        }
    }
    else {
        mode = "lines";
        const range = lines ? parseRange(lines, all.length) : [1, Math.min(all.length, 200)];
        if (!range)
            return text(`Bad line range "${lines}". The output has ${all.length} lines.`);
        const [a, b] = range;
        out = `${id} lines ${a}-${b} of ${all.length}:\n` + all.slice(a - 1, b).map((l, i) => `${a + i}: ${l}`).join("\n");
    }
    if (out.length > MAX_RETURN)
        out = out.slice(0, MAX_RETURN) + `\n... [truncated at ${MAX_RETURN} chars; narrow the range or pattern]`;
    (0, ledger_1.recordRecall)(loc.entry.session, { id: loc.entry.id, mode, chars: out.length });
    return text(out);
});
reg("list_parked", { description: "List tool results Nyquest has parked in this session (id, tool, class, size, recalls).", inputSchema: { type: "object", properties: {} } }, async () => {
    const entries = (0, store_1.listSession)(sessionId());
    if (!entries.length)
        return text("Nothing parked in this session yet.");
    const rows = entries.map((e) => `${e.id}  ${e.tool.padEnd(12)} ${e.cls.padEnd(5)} ${(0, tokens_1.fmt)(e.lines).padStart(7)} lines ~${(0, tokens_1.fmt)((0, tokens_1.estimateTokens)(e.chars)).padStart(7)} tok  recalls=${e.recalls}  ${e.command ? e.command.slice(0, 60) : ""}`);
    return text(rows.join("\n"));
});
reg("digest_file", {
    description: "Read a large file you do not intend to edit and get a compact digest (log/data/code/prose) with the full text parked for recall. Use the Read tool instead when you will edit the file.",
    inputSchema: {
        type: "object",
        properties: {
            path: { type: "string", description: "Absolute or cwd-relative file path" },
            kind: { type: "string", enum: ["auto", "log", "data", "code", "prose"], description: "Force a digest style (default auto)" },
        },
        required: ["path"],
    },
}, async ({ path: p, kind }) => {
    const abs = path.resolve(p);
    let body;
    try {
        body = fs.readFileSync(abs, "utf8");
    }
    catch (e) {
        return text(`Cannot read ${abs}: ${e.message}`);
    }
    if (body.length > 5_000_000)
        return text(`File is ${(0, tokens_1.fmt)(body.length)} bytes; too large to digest. Use recall-style tools on a slice instead.`);
    const forced = kind && kind !== "auto" ? kind : undefined;
    const { cls, digest, lines } = (0, digest_1.makeDigest)(body, "digest_file", "cat " + abs, forced);
    if (digest.length >= body.length * 0.85)
        return text(body);
    const entry = (0, store_1.park)(sessionId(), body, { tool: "digest_file", command: abs, cls, digestChars: digest.length });
    const out = digest + "\n" + (0, digest_1.footer)(entry.id, lines, body.length, cls);
    (0, ledger_1.recordPark)(sessionId(), { id: entry.id, tool: "digest_file", cls, chars: body.length, digestChars: out.length });
    return text(out);
});
/** Crude HTML to text: drop scripts/styles/tags, decode common entities, collapse whitespace. */
function htmlToText(html) {
    return html
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr)\b[^>]*>/gi, "\n")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;/g, "'")
        .replace(/[ \t]+/g, " ")
        .replace(/\n\s*\n\s*\n+/g, "\n\n")
        .trim();
}
reg("digest_url", {
    description: "Fetch a web page and get a compact digest (Nyquest semantic condensation in full mode, head/tail locally) with the full text parked for recall. Optionally ask a question and get only the answer. In full mode the page text (secrets redacted) is sent to the Nyquest platform.",
    inputSchema: {
        type: "object",
        properties: {
            url: { type: "string", pattern: "^https?://", description: "an http(s) URL" },
            question: { type: "string", description: "Full mode: answer this question from the page instead of returning a digest" },
        },
        required: ["url"],
    },
}, async ({ url, question }) => {
    let raw;
    try {
        const r = await fetch(url, { headers: { "user-agent": `nyquest-claude-mcp/${version_1.VERSION}`, accept: "text/html,text/plain,application/json;q=0.9,*/*;q=0.5" }, signal: AbortSignal.timeout(15000), redirect: "follow" });
        if (!r.ok)
            return text(`Fetch failed: HTTP ${r.status} for ${url}`);
        const ct = r.headers.get("content-type") || "";
        const bodyText = await r.text();
        raw = /html/i.test(ct) ? htmlToText(bodyText) : bodyText;
    }
    catch (e) {
        return text(`Fetch failed for ${url}: ${e.message}`);
    }
    if (!raw.trim())
        return text(`No text content at ${url}`);
    if (raw.length > 400_000)
        raw = raw.slice(0, 400_000) + "\n... [truncated at 400,000 chars]";
    const cfg = (0, config_1.loadConfig)();
    const entry = (0, store_1.park)(sessionId(), raw, { tool: "digest_url", command: url, cls: "prose", digestChars: 0 });
    if (question && (0, api_1.fullMode)(cfg)) {
        const r = await (0, api_1.ask)(raw, question, cfg);
        if (r) {
            (0, ledger_1.recordPark)(sessionId(), { id: entry.id, tool: "digest_url", cls: "prose", chars: raw.length, digestChars: r.answer.length });
            return text(`${url} → parked as ${entry.id} (${(0, tokens_1.fmt)(raw.split("\n").length)} lines). Answer (${r.model}):\n${r.answer}`);
        }
    }
    let digest;
    let method = "local";
    if ((0, api_1.fullMode)(cfg)) {
        const r = await (0, api_1.condense)(raw, "prose", cfg);
        if (r && r.smaller) {
            digest = `[nyquest digest: web page, condensed by Nyquest (${r.model}); ~${(0, tokens_1.fmt)(r.original_tokens)} → ~${(0, tokens_1.fmt)(r.condensed_tokens)} tokens. Model-written summary; recall for exact text]\n` + r.digest;
            method = "condense";
        }
    }
    if (!digest)
        digest = (0, digest_1.makeDigest)(raw, "digest_url", url, "prose").digest;
    const out = digest + "\n" + (0, digest_1.footer)(entry.id, raw.split("\n").length, raw.length, "prose", method);
    (0, ledger_1.recordPark)(sessionId(), { id: entry.id, tool: "digest_url", cls: "prose", chars: raw.length, digestChars: out.length });
    return text(out);
});
reg("savings", { description: "Show what Nyquest has kept out of the context this session: parked results, recalls, estimated tokens saved.", inputSchema: { type: "object", properties: {} } }, async () => {
    const cfg = (0, config_1.loadConfig)();
    const s = (0, ledger_1.summarize)((0, ledger_1.loadLedger)(sessionId()));
    const size = (0, store_1.storeSize)();
    const byTool = Object.entries(s.byTool).map(([t, v]) => `  ${t}: ${v.parks} parked, ~${(0, tokens_1.fmt)((0, tokens_1.estimateTokens)(v.chars))} tokens`).join("\n");
    const lines = [
        `Nyquest context manager ${version_1.VERSION} — ${(0, api_1.fullMode)(cfg) ? "full" : "local"} mode, level ${cfg.level}, enabled=${cfg.enabled}`,
        `Parked: ${s.parks} results (~${(0, tokens_1.fmt)((0, tokens_1.estimateTokens)(s.charsParked))} tokens) replaced by digests (~${(0, tokens_1.fmt)((0, tokens_1.estimateTokens)(s.charsDigest))} tokens).`,
        `Recalls: ${s.recalls} (~${(0, tokens_1.fmt)((0, tokens_1.estimateTokens)(s.charsRecalled))} tokens brought back).`,
        `Estimated tokens kept out of the context: ~${(0, tokens_1.fmt)(s.tokensSavedOnce)} once, and ~${(0, tokens_1.fmt)(s.tokensSavedPerTurn)} avoided on every later turn. Estimates use ${3.9} chars/token; real numbers come from /cost.`,
        byTool ? "By tool:\n" + byTool : "",
        `Store: ${size.sessions} sessions, ${(0, tokens_1.fmt)(Math.round(size.bytes / 1024))} KB under ${(0, config_1.nyquestHome)()}.`,
    ];
    if ((0, api_1.fullMode)(cfg)) {
        const a = await (0, api_1.accountSavings)(cfg, 30);
        lines.push(a
            ? `Nyquest account (30 days, all your machines): ${(0, tokens_1.fmt)(Number(a.parks || 0))} results parked (~${(0, tokens_1.fmt)(Number(a.park_tokens_kept_out || 0))} tokens kept out), ${a.condense_calls} condensations, ${a.ask_calls} asks (~${(0, tokens_1.fmt)(Number(a.tokens_kept_out))} tokens kept out); total ~${(0, tokens_1.fmt)(Number(a.total_tokens_kept_out ?? a.tokens_kept_out))} tokens. See app.nyquest.ai/savings. Daily platform cap ${a.daily_cap}.`
            : "Nyquest account savings: unavailable right now.");
    }
    return text(lines.filter(Boolean).join("\n"));
});
reg("configure", {
    description: "Change Nyquest settings: level (0..1 slider; 0=off, 0.5 default), enabled, showSavings, disable parking for a tool, or allow a tool's prose to be sent to the Nyquest platform in full mode (remoteTool). Persists to ~/.nyquest/config.json.",
    inputSchema: {
        type: "object",
        properties: {
            level: { type: "number", minimum: 0, maximum: 1, description: "Slider 0..1; 0 parks nothing, 0.5 is the default" },
            enabled: { type: "boolean" },
            showSavings: { type: "boolean" },
            tool: { type: "string", description: "Tool name to enable/disable parking for" },
            toolEnabled: { type: "boolean" },
            remoteTool: { type: "string", description: "Tool name whose prose may (true) or may never (false) be sent to Nyquest for condensation and recall(ask=...) in full mode. By default only WebFetch, WebSearch, Agent and digest_url may." },
            remoteEnabled: { type: "boolean" },
            apiKey: { type: "string", description: "Nyquest API key (nq-v1-...) to enable full mode; empty string removes it" },
        },
    },
}, async ({ level, enabled, showSavings, tool, toolEnabled, remoteTool, remoteEnabled, apiKey }) => {
    const cfg = (0, config_1.loadConfig)();
    if (level !== undefined) {
        cfg.level = (0, config_1.clamp01)(level);
        cfg.levelUpdatedAt = new Date().toISOString();
    }
    if (enabled !== undefined)
        cfg.enabled = enabled;
    if (showSavings !== undefined)
        cfg.showSavings = showSavings;
    if (tool)
        cfg.tools[tool] = toolEnabled ?? true;
    if (remoteTool)
        cfg.remoteTools[remoteTool] = remoteEnabled ?? true;
    if (apiKey !== undefined) {
        if (apiKey)
            cfg.apiKey = apiKey;
        else
            delete cfg.apiKey;
    }
    (0, config_1.saveConfig)(cfg);
    // Keep the website's Settings → Claude Code slider in step (full mode only, fail-open).
    let synced = "";
    if (level !== undefined && (0, api_1.fullMode)(cfg)) {
        const r = await (0, api_1.putSettings)(cfg.level, cfg);
        synced = r ? " Level saved to your Nyquest account too." : " (Could not reach Nyquest to sync the level; it will sync at the next session start.)";
    }
    return text(`Nyquest: enabled=${cfg.enabled}, level=${cfg.level} (park results over ~${(0, tokens_1.fmt)((0, tokens_1.estimateTokens)((0, config_1.thresholdFor)(cfg.level)))} tokens), showSavings=${cfg.showSavings}, mode=${(0, api_1.fullMode)(cfg) ? "full" : "local"}, tool overrides=${JSON.stringify(cfg.tools)}, remote overrides=${JSON.stringify(cfg.remoteTools)}. Hook changes apply to the next tool call.${synced}`);
});
(0, stdio_1.serve)({ name: "nyquest", version: version_1.VERSION }, TOOLS);
