import { classify, type ContentClass } from "../classify";
import { digestLog } from "./log";
import { digestData } from "./data";
import { digestCode } from "./code";
import { digestProse } from "./prose";
import { estimateTokens, fmt } from "../tokens";

export interface DigestResult {
  cls: ContentClass;
  digest: string;
  lines: number;
}

export function digestFor(cls: ContentClass, text: string): string {
  switch (cls) {
    case "log": return digestLog(text);
    case "data": return digestData(text);
    case "code": return digestCode(text);
    case "prose": return digestProse(text);
  }
}

export function makeDigest(text: string, tool: string, command?: string, forced?: ContentClass): DigestResult {
  const cls = forced ?? classify(text, tool, command);
  const digest = digestFor(cls, text);
  return { cls, digest, lines: text.split("\n").length };
}

export type DigestMethod = "local" | "condense";

/**
 * What a digest of this class actually guarantees. Shown to Claude in the footer and
 * the parking note, so it never over-trusts a lossy digest: a condensed prose digest
 * is a model-written summary and may have dropped values.
 */
export function guarantee(cls: ContentClass, method: DigestMethod = "local"): string {
  if (method === "condense") return "The body above is a model-written summary: values, counts and exact wording may be missing";
  switch (cls) {
    case "log": return "The digest keeps every error and warning line, summary lines, and the head and tail verbatim";
    case "data": return "The digest keeps the head and tail verbatim plus the shape of the data; most rows are omitted";
    case "code": return "The digest keeps the head, the tail and a definition index; the body is omitted";
    case "prose": return "The digest keeps the head and tail verbatim; the middle is omitted";
  }
}

export function footer(id: string, lines: number, chars: number, cls: ContentClass = "log", method: DigestMethod = "local"): string {
  return [
    "",
    `[nyquest] Full output parked as ${id} (${fmt(lines)} lines, ~${fmt(estimateTokens(chars))} tokens, est.). ${guarantee(cls, method)}; if it already answers the question, use it as-is.`,
    `Only when a specific detail is missing: recall(id="${id}", grep="pattern") or recall(id="${id}", lines="120-180") returns exact text. Do not re-run the command to see the full output again.`,
  ].join("\n");
}
