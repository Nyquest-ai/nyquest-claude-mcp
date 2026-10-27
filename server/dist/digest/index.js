"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.digestFor = digestFor;
exports.makeDigest = makeDigest;
exports.guarantee = guarantee;
exports.footer = footer;
const classify_1 = require("../classify");
const log_1 = require("./log");
const data_1 = require("./data");
const code_1 = require("./code");
const prose_1 = require("./prose");
const tokens_1 = require("../tokens");
function digestFor(cls, text) {
    switch (cls) {
        case "log": return (0, log_1.digestLog)(text);
        case "data": return (0, data_1.digestData)(text);
        case "code": return (0, code_1.digestCode)(text);
        case "prose": return (0, prose_1.digestProse)(text);
    }
}
function makeDigest(text, tool, command, forced) {
    const cls = forced ?? (0, classify_1.classify)(text, tool, command);
    const digest = digestFor(cls, text);
    return { cls, digest, lines: text.split("\n").length };
}
/**
 * What a digest of this class actually guarantees. Shown to Claude in the footer and
 * the parking note, so it never over-trusts a lossy digest: a condensed prose digest
 * is a model-written summary and may have dropped values.
 */
function guarantee(cls, method = "local") {
    if (method === "condense")
        return "The body above is a model-written summary: values, counts and exact wording may be missing";
    switch (cls) {
        case "log": return "The digest keeps every error and warning line, summary lines, and the head and tail verbatim";
        case "data": return "The digest keeps the head and tail verbatim plus the shape of the data; most rows are omitted";
        case "code": return "The digest keeps the head, the tail and a definition index; the body is omitted";
        case "prose": return "The digest keeps the head and tail verbatim; the middle is omitted";
    }
}
function footer(id, lines, chars, cls = "log", method = "local") {
    return [
        "",
        `[nyquest] Full output parked as ${id} (${(0, tokens_1.fmt)(lines)} lines, ~${(0, tokens_1.fmt)((0, tokens_1.estimateTokens)(chars))} tokens, est.). ${guarantee(cls, method)}; if it already answers the question, use it as-is.`,
        `Only when a specific detail is missing: recall(id="${id}", grep="pattern") or recall(id="${id}", lines="120-180") returns exact text. Do not re-run the command to see the full output again.`,
    ].join("\n");
}
