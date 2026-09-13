// Token estimate for Claude-family tokenizers. Phase 0 measured the Nyquest engine's
// exact Claude count at 3.88 chars/token on real tool output; 3.9 keeps the estimate
// slightly conservative. Always label as estimated.
export const CHARS_PER_TOKEN = 3.9;

/** Accepts text or a character count. */
export function estimateTokens(textOrChars: string | number): number {
  const chars = typeof textOrChars === "number" ? textOrChars : textOrChars.length;
  if (!Number.isFinite(chars)) return 0;
  return Math.max(0, Math.round(chars / CHARS_PER_TOKEN));
}

export function fmt(n: number): string {
  return n.toLocaleString("en-US");
}
