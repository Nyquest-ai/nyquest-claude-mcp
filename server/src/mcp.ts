// Nyquest MCP server (stdio): recall, list_parked, digest_file, savings, configure.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as fs from "node:fs";
import * as path from "node:path";
import { loadConfig, saveConfig, clamp01, thresholdFor, nyquestHome } from "./config";
import { locate, readParked, bumpRecall, listSession, park, storeSize, latestSession } from "./store";
import { loadLedger, summarize, recordRecall, recordPark } from "./ledger";
import { makeDigest, footer } from "./digest";
import { estimateTokens, fmt } from "./tokens";
import type { ContentClass } from "./classify";
import { fullMode, ask as apiAsk, condense as apiCondense, accountSavings } from "./api";

/** Session id: from the environment when Claude Code provides one, else the most recently active parked session. Resolved per call, since sessions start after this process. */
function sessionId(): string {
  return process.env.CLAUDE_SESSION_ID || process.env.CLAUDE_CODE_SESSION_ID || latestSession() || "mcp";
}
const MAX_RETURN = 60_000;

function text(s: string) {
  return { content: [{ type: "text" as const, text: s }] };
}

function parseRange(r: string, n: number): [number, number] | undefined {
  const m = r.trim().match(/^(\d+)\s*(?:-\s*(\d+))?$/);
  if (!m) return undefined;
  const a = Math.max(1, parseInt(m[1], 10));
  const b = m[2] ? Math.min(n, parseInt(m[2], 10)) : Math.min(n, a + 199);
  return a <= b ? [a, b] : undefined;
}

const server = new McpServer({ name: "nyquest", version: "0.2.4" });

// The SDK's registerTool generics trip TS2589 ("excessively deep") with zod 3.25 on
// schemas with several optional fields. Handlers below are explicitly typed, so a
// loosely typed registration wrapper loses nothing at runtime.
type ToolResult = { content: { type: "text"; text: string }[] };
const reg = server.registerTool.bind(server) as unknown as (
  name: string,
  cfg: { description: string; inputSchema: unknown },
  cb: (args: any) => Promise<ToolResult>,
) => void;

reg(
  "recall",
  {
    description: "Retrieve exact text from a tool result that Nyquest parked (ids look like nyq:7f3a9c). Use lines=\"a-b\" for a line range, grep=\"pattern\" (regex) with optional context, or omit both for the first 200 lines. Prefer this over re-running the command.",
    inputSchema: z.object({
      id: z.string().describe("Parked id, e.g. nyq:7f3a9c"),
      lines: z.string().optional().describe("Line range like \"120-180\" or a single line \"57\""),
      grep: z.string().optional().describe("Regular expression to search for (case-insensitive)"),
      context: z.number().int().min(0).max(20).optional().describe("Context lines around grep matches (default 2)"),
      max_matches: z.number().int().min(1).max(500).optional().describe("Cap on grep matches (default 100)"),
      ask: z.string().optional().describe("Full mode only: a question answered over the whole parked output by a Nyquest-routed model"),
    }),
  },
  async ({ id, lines, grep, context, max_matches, ask }: { id: string; lines?: string; grep?: string; context?: number; max_matches?: number; ask?: string }) => {
    const loc = locate(id, sessionId());
    if (!loc) return text(`No parked output with id ${id}. Use list_parked to see what is available.`);
    const body = readParked(loc);
    const all = body.split("\n");
    bumpRecall(loc);
    let out: string;
    let mode: string;
    if (ask) {
      mode = "ask";
      const cfg = loadConfig();
      if (!fullMode(cfg)) {
        out = `recall(ask=...) needs Nyquest full mode: set an API key with configure(apiKey="nq-v1-...") (free, from app.nyquest.ai). Meanwhile use lines= or grep=. The output has ${all.length} lines.`;
      } else {
        const r = await apiAsk(body, ask, cfg);
        out = r
          ? `${id} (${all.length} lines), answered by Nyquest (${r.model}, ${r.ms} ms; ~${fmt(r.original_tokens)} tokens read, ~${fmt(r.answer_tokens)} returned):\n${r.answer}`
          : `Nyquest ask is unavailable right now (network, cap, or provider). Use recall(id="${id}", grep="...") or lines= instead. The output has ${all.length} lines.`;
      }
    } else if (grep) {
      mode = "grep";
      let re: RegExp;
      try { re = new RegExp(grep, "i"); } catch { return text(`Invalid regex: ${grep}`); }
      const ctx = context ?? 2, cap = max_matches ?? 100;
      const keep = new Set<number>();
      let matches = 0;
      for (let i = 0; i < all.length && matches < cap; i++) {
        if (re.test(all[i])) { matches++; for (let j = Math.max(0, i - ctx); j <= Math.min(all.length - 1, i + ctx); j++) keep.add(j); }
      }
      if (!matches) out = `No lines match /${grep}/i in ${id} (${all.length} lines).`;
      else {
        const parts: string[] = [`${matches} match(es) for /${grep}/i in ${id} (${all.length} lines), ${ctx} lines of context:`];
        let last = -2;
        for (const i of [...keep].sort((a, b) => a - b)) {
          if (i !== last + 1) parts.push("--");
          parts.push(`${i + 1}: ${all[i]}`);
          last = i;
        }
        out = parts.join("\n");
      }
    } else {
      mode = "lines";
      const range = lines ? parseRange(lines, all.length) : [1, Math.min(all.length, 200)] as [number, number];
      if (!range) return text(`Bad line range "${lines}". The output has ${all.length} lines.`);
      const [a, b] = range;
      out = `${id} lines ${a}-${b} of ${all.length}:\n` + all.slice(a - 1, b).map((l, i) => `${a + i}: ${l}`).join("\n");
    }
    if (out.length > MAX_RETURN) out = out.slice(0, MAX_RETURN) + `\n... [truncated at ${MAX_RETURN} chars; narrow the range or pattern]`;
    recordRecall(loc.entry.session, { id: loc.entry.id, mode, chars: out.length });
    return text(out);
  },
);

reg(
  "list_parked",
  { description: "List tool results Nyquest has parked in this session (id, tool, class, size, recalls).", inputSchema: {} },
  async () => {
    const entries = listSession(sessionId());
    if (!entries.length) return text("Nothing parked in this session yet.");
    const rows = entries.map((e) => `${e.id}  ${e.tool.padEnd(12)} ${e.cls.padEnd(5)} ${fmt(e.lines).padStart(7)} lines ~${fmt(estimateTokens(e.chars)).padStart(7)} tok  recalls=${e.recalls}  ${e.command ? e.command.slice(0, 60) : ""}`);
    return text(rows.join("\n"));
  },
);

reg(
  "digest_file",
  {
    description: "Read a large file you do not intend to edit and get a compact digest (log/data/code/prose) with the full text parked for recall. Use the Read tool instead when you will edit the file.",
    inputSchema: {
      path: z.string().describe("Absolute or cwd-relative file path"),
      kind: z.enum(["auto", "log", "data", "code", "prose"]).optional().describe("Force a digest style (default auto)"),
    },
  },
  async ({ path: p, kind }: { path: string; kind?: "auto" | "log" | "data" | "code" | "prose" }) => {
    const abs = path.resolve(p);
    let body: string;
    try { body = fs.readFileSync(abs, "utf8"); } catch (e) { return text(`Cannot read ${abs}: ${(e as Error).message}`); }
    if (body.length > 5_000_000) return text(`File is ${fmt(body.length)} bytes; too large to digest. Use recall-style tools on a slice instead.`);
    const forced = kind && kind !== "auto" ? (kind as ContentClass) : undefined;
    const { cls, digest, lines } = makeDigest(body, "digest_file", "cat " + abs, forced);
    if (digest.length >= body.length * 0.85) return text(body);
    const entry = park(sessionId(),body, { tool: "digest_file", command: abs, cls, digestChars: digest.length });
    const out = digest + "\n" + footer(entry.id, lines, body.length);
    recordPark(sessionId(),{ id: entry.id, tool: "digest_file", cls, chars: body.length, digestChars: out.length });
    return text(out);
  },
);

/** Crude HTML to text: drop scripts/styles/tags, decode common entities, collapse whitespace. */
function htmlToText(html: string): string {
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

reg(
  "digest_url",
  {
    description: "Fetch a web page and get a compact digest (Nyquest semantic condensation in full mode, head/tail locally) with the full text parked for recall. Optionally ask a question and get only the answer.",
    inputSchema: z.object({
      url: z.string().url().describe("http(s) URL"),
      question: z.string().optional().describe("Full mode: answer this question from the page instead of returning a digest"),
    }),
  },
  async ({ url, question }: { url: string; question?: string }) => {
    let raw: string;
    try {
      const r = await fetch(url, { headers: { "user-agent": "nyquest-claude-mcp/0.2.0", accept: "text/html,text/plain,application/json;q=0.9,*/*;q=0.5" }, signal: AbortSignal.timeout(15000), redirect: "follow" });
      if (!r.ok) return text(`Fetch failed: HTTP ${r.status} for ${url}`);
      const ct = r.headers.get("content-type") || "";
      const bodyText = await r.text();
      raw = /html/i.test(ct) ? htmlToText(bodyText) : bodyText;
    } catch (e) {
      return text(`Fetch failed for ${url}: ${(e as Error).message}`);
    }
    if (!raw.trim()) return text(`No text content at ${url}`);
    if (raw.length > 400_000) raw = raw.slice(0, 400_000) + "\n... [truncated at 400,000 chars]";
    const cfg = loadConfig();
    const entry = park(sessionId(), raw, { tool: "digest_url", command: url, cls: "prose", digestChars: 0 });
    if (question && fullMode(cfg)) {
      const r = await apiAsk(raw, question, cfg);
      if (r) {
        recordPark(sessionId(), { id: entry.id, tool: "digest_url", cls: "prose", chars: raw.length, digestChars: r.answer.length });
        return text(`${url} → parked as ${entry.id} (${fmt(raw.split("\n").length)} lines). Answer (${r.model}):\n${r.answer}`);
      }
    }
    let digest: string | undefined;
    if (fullMode(cfg)) {
      const r = await apiCondense(raw, "prose", cfg);
      if (r && r.smaller) digest = `[nyquest digest: web page, condensed by Nyquest (${r.model}); ~${fmt(r.original_tokens)} → ~${fmt(r.condensed_tokens)} tokens]\n` + r.digest;
    }
    if (!digest) digest = makeDigest(raw, "digest_url", url, "prose").digest;
    const out = digest + "\n" + footer(entry.id, raw.split("\n").length, raw.length);
    recordPark(sessionId(), { id: entry.id, tool: "digest_url", cls: "prose", chars: raw.length, digestChars: out.length });
    return text(out);
  },
);

reg(
  "savings",
  { description: "Show what Nyquest has kept out of the context this session: parked results, recalls, estimated tokens saved.", inputSchema: {} },
  async () => {
    const cfg = loadConfig();
    const s = summarize(loadLedger(sessionId()));
    const size = storeSize();
    const byTool = Object.entries(s.byTool).map(([t, v]) => `  ${t}: ${v.parks} parked, ~${fmt(estimateTokens(v.chars))} tokens`).join("\n");
    const lines = [
      `Nyquest context manager — ${fullMode(cfg) ? "full" : "local"} mode, level ${cfg.level}, enabled=${cfg.enabled}`,
      `Parked: ${s.parks} results (~${fmt(estimateTokens(s.charsParked))} tokens) replaced by digests (~${fmt(estimateTokens(s.charsDigest))} tokens).`,
      `Recalls: ${s.recalls} (~${fmt(estimateTokens(s.charsRecalled))} tokens brought back).`,
      `Estimated tokens kept out of the context: ~${fmt(s.tokensSavedOnce)} once, and ~${fmt(s.tokensSavedPerTurn)} avoided on every later turn. Estimates use ${3.9} chars/token; real numbers come from /cost.`,
      byTool ? "By tool:\n" + byTool : "",
      `Store: ${size.sessions} sessions, ${fmt(Math.round(size.bytes / 1024))} KB under ${nyquestHome()}.`,
    ];
    if (fullMode(cfg)) {
      const a = await accountSavings(cfg, 30);
      lines.push(a
        ? `Nyquest account (30 days): ${a.condense_calls} condensations, ${a.ask_calls} asks, ~${fmt(Number(a.tokens_in))} tokens read on the platform, ~${fmt(Number(a.tokens_kept_out))} kept out of Claude's context; daily cap ${a.daily_cap}.`
        : "Nyquest account savings: unavailable right now.");
    }
    return text(lines.filter(Boolean).join("\n"));
  },
);

reg(
  "configure",
  {
    description: "Change Nyquest settings: level (0..1 slider; 0=off, 0.5 default), enabled, showSavings, or disable parking for a tool. Persists to ~/.nyquest/config.json.",
    inputSchema: z.object({
      level: z.number().min(0).max(1).optional(),
      enabled: z.boolean().optional(),
      showSavings: z.boolean().optional(),
      tool: z.string().optional().describe("Tool name to enable/disable parking for"),
      toolEnabled: z.boolean().optional(),
      apiKey: z.string().optional().describe("Nyquest API key (nq-v1-...) to enable full mode; empty string removes it"),
    }),
  },
  async ({ level, enabled, showSavings, tool, toolEnabled, apiKey }: { level?: number; enabled?: boolean; showSavings?: boolean; tool?: string; toolEnabled?: boolean; apiKey?: string }) => {
    const cfg = loadConfig();
    if (level !== undefined) cfg.level = clamp01(level);
    if (enabled !== undefined) cfg.enabled = enabled;
    if (showSavings !== undefined) cfg.showSavings = showSavings;
    if (tool) cfg.tools[tool] = toolEnabled ?? true;
    if (apiKey !== undefined) { if (apiKey) cfg.apiKey = apiKey; else delete cfg.apiKey; }
    saveConfig(cfg);
    return text(`Nyquest: enabled=${cfg.enabled}, level=${cfg.level} (park results over ~${fmt(estimateTokens(thresholdFor(cfg.level)))} tokens), showSavings=${cfg.showSavings}, mode=${cfg.apiKey ? "full" : "local"}, tool overrides=${JSON.stringify(cfg.tools)}. Hook changes apply to the next tool call.`);
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
main().catch((e) => { process.stderr.write(String(e) + "\n"); process.exit(1); });
