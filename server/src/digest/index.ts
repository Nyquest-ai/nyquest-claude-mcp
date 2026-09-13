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

export function footer(id: string, lines: number, chars: number): string {
  return [
    "",
    `[nyquest] Full output parked as ${id} (${fmt(lines)} lines, ~${fmt(estimateTokens(chars))} tokens, est.). The digest above keeps every error/warning line, summary line, and the head and tail verbatim; if it already answers the question, use it as-is.`,
    `Only when a specific detail is missing: recall(id="${id}", grep="pattern") or recall(id="${id}", lines="120-180") returns exact text. Do not re-run the command to see the full output again.`,
  ].join("\n");
}
