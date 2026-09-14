// Claude Code hook entry point.
//   PostToolUse: park large tool results, return a digest via updatedToolOutput.
//   SessionStart (--session-start): print a status line, purge old sessions.
// Fail-open: on any error, print nothing and exit 0 so Claude sees the original.
import * as fs from "node:fs";
import * as path from "node:path";
import { loadConfig, thresholdFor, proseThresholdFor, codeParkingEnabled, toolEligible, nyquestHome, type Config } from "./config";
import { makeDigest, footer } from "./digest";
import { park, purgeOld, storeSize } from "./store";
import { recordPark, recordSkip, loadLedger, summarize } from "./ledger";
import { estimateTokens, fmt } from "./tokens";
import { fullMode, condense, reportParks } from "./api";
import * as api from "./api";
import { syncLevel } from "./sync";

interface HookInput {
  session_id?: string;
  hook_event_name?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_response?: unknown;
  tool_use_id?: string;
  cwd?: string;
  source?: string;
}

function log(line: string): void {
  try {
    fs.mkdirSync(nyquestHome(), { recursive: true });
    fs.appendFileSync(path.join(nyquestHome(), "hook.log"), `${new Date().toISOString()} ${line}\n`);
  } catch { /* ignore */ }
}

/** Record the top-level shape of each tool's response once, so unknown shapes get learned from real sessions. */
function learnShape(tool: string, resp: unknown): void {
  try {
    const shape = resp === null ? "null" : Array.isArray(resp)
      ? `array[${resp.length}]<${resp[0] && typeof resp[0] === "object" ? Object.keys(resp[0] as object).join(",") : typeof resp[0]}>`
      : typeof resp === "object" ? "{" + Object.keys(resp as object).map((k) => `${k}:${typeof (resp as any)[k]}`).join(",") + "}" : typeof resp;
    const f = path.join(nyquestHome(), "shapes.json");
    let known: Record<string, string[]> = {};
    try { known = JSON.parse(fs.readFileSync(f, "utf8")); } catch { /* none */ }
    const arr = known[tool] || (known[tool] = []);
    if (!arr.includes(shape)) { arr.push(shape); fs.mkdirSync(nyquestHome(), { recursive: true }); fs.writeFileSync(f, JSON.stringify(known, null, 1)); }
  } catch { /* ignore */ }
}

interface Extracted { text: string; rebuild: (digest: string) => unknown }

/** Pull the text out of a tool_response and know how to put a replacement back in the same shape. */
export function extract(resp: unknown): Extracted | undefined {
  if (typeof resp === "string") return { text: resp, rebuild: (d) => d };
  if (Array.isArray(resp)) {
    // MCP-style content blocks: [{type:"text", text}]
    const texts = resp.filter((b) => b && typeof b === "object" && (b as any).type === "text" && typeof (b as any).text === "string");
    if (texts.length && texts.length === resp.length) {
      return { text: texts.map((b: any) => b.text).join("\n"), rebuild: (d) => [{ type: "text", text: d }] };
    }
    return undefined;
  }
  if (resp && typeof resp === "object") {
    const o = resp as Record<string, unknown>;
    if (typeof o.stdout === "string") {
      // Bash: {stdout, stderr, interrupted, isImage}
      const stderr = typeof o.stderr === "string" ? o.stderr : "";
      const text = stderr ? `${o.stdout}\n[stderr]\n${stderr}` : o.stdout;
      return { text, rebuild: (d) => ({ ...o, stdout: d, stderr: "" }) };
    }
    for (const key of ["content", "output", "result", "text"]) {
      const v = o[key];
      if (typeof v === "string") return { text: v, rebuild: (d) => ({ ...o, [key]: d }) };
      if (Array.isArray(v)) {
        const inner = extract(v);
        if (inner) return { text: inner.text, rebuild: (d) => ({ ...o, [key]: inner.rebuild(d) }) };
      }
    }
  }
  return undefined;
}

function commandOf(tool: string, input?: Record<string, unknown>): string | undefined {
  if (!input) return undefined;
  for (const k of ["command", "url", "prompt", "query", "pattern", "description"]) {
    if (typeof input[k] === "string") return String(input[k]).slice(0, 200);
  }
  return undefined;
}

export async function handlePostToolUse(input: HookInput, cfg: Config): Promise<unknown | undefined> {
  const tool = input.tool_name || "";
  const session = input.session_id || "unknown";
  if (!cfg.enabled || !toolEligible(tool, cfg)) return undefined;
  learnShape(tool, input.tool_response);
  const ex = extract(input.tool_response);
  if (!ex) { recordSkip(session, "unknown-shape:" + tool); return undefined; }
  const threshold = thresholdFor(cfg.level);
  if (ex.text.length < threshold) return undefined;
  // Claude Code already persists Bash output above ~30 KB to a file and shows the
  // model a ~2 KB preview; the hook receives the 30,000-char truncation. Nothing
  // to gain there, and replacing the preview would only hide the saved-file path.
  // Learned from real responses (shapes.json): a persisted Bash result carries
  // persistedOutputPath / persistedOutputSize. The length check stays as a fallback.
  const resp = input.tool_response as Record<string, unknown> | null;
  const persisted = !!(resp && typeof resp === "object" && (resp.persistedOutputPath || resp.persistedOutputSize));
  if (persisted || ex.text.includes("<persisted-output>") || (tool === "Bash" && ex.text.length >= 30_000)) {
    recordSkip(session, "already-persisted-by-claude-code");
    return undefined;
  }

  const command = commandOf(tool, input.tool_input);
  let { cls, digest, lines } = makeDigest(ex.text, tool, command);
  if (cls === "code" && !codeParkingEnabled(cfg.level)) { recordSkip(session, "code-untouched"); return undefined; }
  if (cls === "prose" && ex.text.length < proseThresholdFor(cfg.level)) { recordSkip(session, "prose-below-threshold"); return undefined; }

  // Full mode: prose gets semantic condensation on the Nyquest platform. Any
  // failure or a non-smaller result keeps the local head/tail digest.
  let method = "local";
  if (cls === "prose" && fullMode(cfg)) {
    const r = await condense(ex.text, cls, cfg);
    if (r && r.smaller && r.digest.length < digest.length) {
      digest = `[nyquest digest: prose, condensed by Nyquest (${r.model}); ~${fmt(r.original_tokens)} → ~${fmt(r.condensed_tokens)} tokens]\n` + r.digest;
      method = "condense";
    } else {
      recordSkip(session, r ? "condense-not-smaller" : "condense-unavailable");
    }
  }
  if (digest.length >= ex.text.length * 0.85) { recordSkip(session, "digest-not-smaller"); return undefined; }

  const entry = park(session, ex.text, { tool, command, cls, digestChars: digest.length });
  const body = digest + "\n" + footer(entry.id, lines, ex.text.length);
  recordPark(session, { id: entry.id, tool, cls, chars: ex.text.length, digestChars: body.length });
  // Full mode: tell the account about this park (counts only, never content) so the
  // website's savings page reflects local-mode savings too. Bounded and fail-open.
  if (fullMode(cfg)) {
    const n = await reportParks([{ tool, kind: cls, method, chars_in: ex.text.length, chars_out: body.length, tokens_in: estimateTokens(ex.text.length), tokens_out: estimateTokens(body.length) }], cfg);
    log(`report ${entry.id} accepted=${n}${n ? "" : ` error=${api.lastError || "unknown"}`}`);
  }

  const saved = estimateTokens(ex.text.length) - estimateTokens(body.length);
  const out: Record<string, unknown> = {
    hookSpecificOutput: { hookEventName: "PostToolUse", updatedToolOutput: ex.rebuild(body) },
  };
  if (cfg.showSavings) {
    (out.hookSpecificOutput as any).additionalContext =
      `Nyquest parked this ${cls} output as ${entry.id}: ~${fmt(estimateTokens(ex.text.length))} → ~${fmt(estimateTokens(body.length))} tokens (est., ${fmt(saved)} kept out of context on every later turn). The digest keeps errors, summaries, head and tail verbatim${method === "condense" ? " and the condensed body preserves all facts, numbers, names and paths" : ""}; recall only if a detail you need is absent${fullMode(cfg) ? ` (recall(id="${entry.id}", ask="...") returns just an answer)` : ""}.`;
    // systemMessage is shown to the USER by Claude Code; additionalContext above goes to Claude.
    out.systemMessage = `Nyquest: parked ${cls} output ${entry.id}, ~${fmt(estimateTokens(ex.text.length))} → ~${fmt(estimateTokens(body.length))} tokens (est.), ${fmt(saved)} kept out of context on every later turn.`;
  }
  log(`park ${entry.id} tool=${tool} cls=${cls} method=${method} chars=${ex.text.length} digest=${body.length} session=${session}`);
  return out;
}

async function sessionStart(input: HookInput, cfg: Config): Promise<string> {
  const removed = purgeOld(cfg.retentionDays);
  const size = storeSize();
  const mode = fullMode(cfg) ? "full" : "local";
  // Full mode: reconcile the slider with the website (last writer wins). Bounded, fail-open.
  let synced = "";
  try {
    const s = await syncLevel(cfg);
    if (s.action === "pulled") { cfg.level = s.level; synced = ` Level ${s.level} pulled from your Nyquest account settings.`; }
    else if (s.action === "pushed") synced = " Level published to your Nyquest account settings.";
  } catch { /* offline or no key */ }
  const l = loadLedger(input.session_id || "unknown");
  const s = summarize(l);
  const prior = s.parks ? ` This session so far: ${s.parks} parked, ${s.recalls} recalls.` : "";
  if (!cfg.enabled) return `Nyquest context manager: OFF (NYQUEST_COMPRESS=off or disabled in ~/.nyquest/config.json). Say "turn Nyquest on" to re-enable.`;
  const hint = mode === "local" ? " Full mode (free, adds platform condensation and recall(ask=...)): /nyquest:setup." : "";
  return `Nyquest context manager: ${mode} mode, level ${cfg.level} (/nyquest:level to change), results over ~${fmt(estimateTokens(thresholdFor(cfg.level)))} tokens are parked with a digest; use the nyquest recall tool for exact text. Store: ${size.sessions} sessions, ${fmt(Math.round(size.bytes / 1024))} KB${removed ? `, purged ${removed} old` : ""}.${prior}${synced}${hint}`;
}

async function main(): Promise<void> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  let input: HookInput = {};
  try { input = raw.trim() ? JSON.parse(raw) : {}; } catch { input = {}; }
  const cfg = loadConfig();
  if (process.argv.includes("--session-start") || input.hook_event_name === "SessionStart") {
    // Both audiences: additionalContext for Claude, systemMessage for the user's screen.
    const line = await sessionStart(input, cfg);
    process.stdout.write(JSON.stringify({
      systemMessage: line,
      hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: line },
    }));
    return;
  }
  if (input.hook_event_name !== "PostToolUse") return;
  const out = await handlePostToolUse(input, cfg);
  if (out) process.stdout.write(JSON.stringify(out));
}

if (require.main === module) {
  main().catch((e) => { log("error " + (e && e.stack ? e.stack : String(e))); process.exitCode = 0; });
}
