"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CHARS_PER_TOKEN = void 0;
exports.estimateTokens = estimateTokens;
exports.fmt = fmt;
// Token estimate for Claude-family tokenizers. Phase 0 measured the Nyquest engine's
// exact Claude count at 3.88 chars/token on real tool output; 3.9 keeps the estimate
// slightly conservative. Always label as estimated.
exports.CHARS_PER_TOKEN = 3.9;
/** Accepts text or a character count. */
function estimateTokens(textOrChars) {
    const chars = typeof textOrChars === "number" ? textOrChars : textOrChars.length;
    if (!Number.isFinite(chars))
        return 0;
    return Math.max(0, Math.round(chars / exports.CHARS_PER_TOKEN));
}
function fmt(n) {
    return n.toLocaleString("en-US");
}
