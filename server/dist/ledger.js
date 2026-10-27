"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadLedger = loadLedger;
exports.saveLedger = saveLedger;
exports.recordPark = recordPark;
exports.recordRecall = recordRecall;
exports.recordSkip = recordSkip;
exports.summarize = summarize;
// Per-session savings ledger: ~/.nyquest/sessions/<session>.json
// Statistics only. Writes are atomic and never allowed to fail a park or a recall;
// under heavy parallelism a counter may be under-reported, never corrupted.
const path = require("node:path");
const config_1 = require("./config");
const tokens_1 = require("./tokens");
const fsutil_1 = require("./fsutil");
function file(session) {
    return path.join((0, config_1.nyquestHome)(), "sessions", String(session || "unknown").replace(/[^A-Za-z0-9_.-]/g, "_") + ".json");
}
function loadLedger(session) {
    const l = (0, fsutil_1.readJsonFile)(file(session));
    if (l && Array.isArray(l.parks) && Array.isArray(l.recalls))
        return { ...l, skipped: l.skipped || {} };
    return { session, started: new Date().toISOString(), parks: [], recalls: [], skipped: {} };
}
function saveLedger(l) {
    (0, fsutil_1.writeJsonAtomic)(file(l.session), l);
}
function saveQuietly(l) {
    try {
        saveLedger(l);
    }
    catch { /* statistics must never block the work */ }
}
function recordPark(session, r) {
    const l = loadLedger(session);
    l.parks.push({ ...r, at: new Date().toISOString() });
    saveQuietly(l);
    return l;
}
function recordRecall(session, r) {
    const l = loadLedger(session);
    l.recalls.push({ ...r, at: new Date().toISOString() });
    saveQuietly(l);
}
function recordSkip(session, reason) {
    const l = loadLedger(session);
    l.skipped[reason] = (l.skipped[reason] || 0) + 1;
    saveQuietly(l);
}
function summarize(l) {
    const byTool = {};
    let charsParked = 0, charsDigest = 0, charsRecalled = 0;
    for (const p of l.parks) {
        charsParked += p.chars;
        charsDigest += p.digestChars;
        const t = byTool[p.tool] || (byTool[p.tool] = { parks: 0, chars: 0 });
        t.parks++;
        t.chars += p.chars;
    }
    for (const r of l.recalls)
        charsRecalled += r.chars;
    const net = Math.max(0, charsParked - charsDigest - charsRecalled);
    return {
        parks: l.parks.length, recalls: l.recalls.length, charsParked, charsDigest, charsRecalled,
        tokensSavedOnce: (0, tokens_1.estimateTokens)(net), tokensSavedPerTurn: (0, tokens_1.estimateTokens)(Math.max(0, charsParked - charsDigest)), byTool,
    };
}
