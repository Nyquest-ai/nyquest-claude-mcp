"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/lib.ts
var lib_exports = {};
__export(lib_exports, {
  DEFAULTS: () => DEFAULTS,
  DEFAULT_PERSIST_LIMIT: () => DEFAULT_PERSIST_LIMIT,
  ERR_RE: () => ERR_RE,
  NEVER_PARK: () => NEVER_PARK,
  REMOTE_OK: () => REMOTE_OK,
  bashPersistLimit: () => bashPersistLimit,
  classify: () => classify,
  codeParkingEnabled: () => codeParkingEnabled,
  digestCode: () => digestCode,
  digestData: () => digestData,
  digestFor: () => digestFor,
  digestLog: () => digestLog,
  digestProse: () => digestProse,
  errKey: () => errKey,
  estimateTokens: () => estimateTokens,
  extract: () => extract,
  footer: () => footer,
  fullMode: () => fullMode,
  guarantee: () => guarantee,
  handlePostToolUse: () => handlePostToolUse,
  listSession: () => listSession,
  loadConfig: () => loadConfig,
  loadLedger: () => loadLedger,
  locate: () => locate,
  makeDigest: () => makeDigest,
  park: () => park,
  persistLimit: () => persistLimit,
  purgeOld: () => purgeOld,
  readParked: () => readParked,
  redact: () => redact,
  remoteEligible: () => remoteEligible,
  storeSize: () => storeSize,
  summarize: () => summarize,
  thresholdFor: () => thresholdFor,
  toolEligible: () => toolEligible
});
module.exports = __toCommonJS(lib_exports);

// src/classify.ts
var CODE_CMD = /\b(sed\s+-n|cat\s+(-n\s+)?[^|;]*\.(rs|js|jsx|ts|tsx|py|go|java|rb|php|c|cc|cpp|h|hpp|cs|swift|kt|html|css|scss|toml|json|ya?ml|sh|sql)\b|git\s+(diff|show)\b|grep\s+-[a-zA-Z]*n)/;
var CODE_LINE = /^\s*(import\s|export\s|from\s+\S+\s+import|#include|use\s+\S+;|package\s|(pub\s+)?(async\s+)?fn\s|def\s|class\s|function\s|const\s|let\s|var\s|return\b|if\s*\(|for\s*\(|while\s*\(|\}\s*else|#\[|@\w+|<\/?[a-zA-Z][^>]*>)/;
var LOG_LINE = /(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}|\b(INFO|WARN|WARNING|ERROR|DEBUG|TRACE|FATAL)\b|^\s*(npm|yarn|pnpm|pip|cargo|go|make|gcc|rustc|tsc|jest|pytest|PASS|FAIL|ok|\[\d+\/\d+\])\b|^\s*(===|---|>>>|\$ |# ))/;
function classify(text, tool, command) {
  const t = text.trim();
  if (!t) return "log";
  if (t.startsWith("{") && t.endsWith("}") || t.startsWith("[") && t.endsWith("]")) {
    try {
      JSON.parse(t);
      return "data";
    } catch {
    }
  }
  const lines = t.split("\n");
  const nonEmpty = lines.filter((l) => l.trim() !== "");
  const n = Math.max(1, nonEmpty.length);
  const sample = nonEmpty.slice(0, 400);
  if (command && CODE_CMD.test(command)) return "code";
  let inFence = false, fencedLines = 0;
  for (const l of lines) {
    if (/^\s*```/.test(l)) {
      inFence = !inFence;
      fencedLines++;
      continue;
    }
    if (inFence) fencedLines++;
  }
  if (fencedLines / Math.max(1, lines.length) >= 0.3) return "code";
  let codeLines = 0, logLines = 0, sepLines = 0, longProse = 0, headings = 0, sentences = 0, totalLen = 0;
  const lens = [];
  for (const l of sample) {
    totalLen += l.length;
    lens.push(l.length);
    if (CODE_LINE.test(l)) codeLines++;
    if (LOG_LINE.test(l)) logLines++;
    if (/\t|\|/.test(l) || /^\s*[\w.-]{1,40}\s*[:=]\s*\S/.test(l) || /^[^,\s]{1,40}(,[^,]{0,60}){3,}$/.test(l) || (l.match(/(?:^|\s)[\w.-]{1,40}=\S/g) || []).length >= 2) sepLines++;
    if (l.length > 90 && (l.match(/[a-zA-Z]{3,}\s+[a-zA-Z]{3,}/g) || []).length >= 6) longProse++;
    if (/^\s*#{1,6}\s+\S/.test(l)) headings++;
    if (/[.!?]["')\]]?\s*$/.test(l)) sentences++;
  }
  const s = sample.length || 1;
  const avgLen = totalLen / s;
  const sorted = [...lens].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] || 0;
  const regular = median ? lens.filter((x) => Math.abs(x - median) <= median * 0.15).length / s : 0;
  const blanks = (lines.length - nonEmpty.length) / Math.max(1, lines.length);
  if (codeLines / s >= 0.25) return "code";
  if (tool === "WebFetch" || tool === "WebSearch" || tool === "Agent" || tool === "Task") {
    return longProse / s >= 0.15 || avgLen > 60 ? "prose" : "log";
  }
  if (headings >= 2 && longProse / s >= 0.2) return "prose";
  if (logLines / s >= 0.3) return "log";
  if (sepLines / s >= 0.8 && n >= 8) return "data";
  if (regular >= 0.7 && n >= 8) return "data";
  if (longProse / s >= 0.3 && (sentences / s >= 0.4 || blanks >= 0.05)) return "prose";
  return "log";
}

// src/digest/log.ts
var ERR_RE = /\b(error|errors|fail|failed|failure|failures|warn|warning|exception|panic|panicked|denied|fatal|traceback|unhandled|cannot|could not|not found|ENOENT|EACCES|timed? ?out)\b|\b[A-Z][A-Za-z]*Error\b|^\s*(✕|✗|×|●|FAIL\b)|^\s*(Expected|Received|expected|got|actual)\s*:/im;
var SUMMARY_RE = /\b\d+\s+(passed|failed|skipped|errors?|warnings?|tests?|packages?|files?|vulnerabilit(y|ies)|added|removed|changed|insertions?|deletions?)\b|\btest result:|\bTests?:\s|\bSuites?:\s|\bSnapshots?:\s|^\s*(Time|Duration|Elapsed|Total|Ran)\b.*:|\bexit(ed)? (code|status)\b|\bDone in\b|\bFinished\b|\bcompiled\b|\bBuild (succeeded|failed|completed)\b/i;
var ANSI = /\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*\x07/g;
function digestLog(text, opts = {}) {
  const head = opts.head ?? 25, tail = opts.tail ?? 15, maxErr = opts.maxErr ?? 80, ctx = opts.context ?? 1;
  const lines = text.replace(/\r\n/g, "\n").replace(ANSI, "").split("\n");
  const n = lines.length;
  if (n <= head + tail + 5) return lines.join("\n");
  const keep = /* @__PURE__ */ new Set();
  for (let i = 0; i < Math.min(head, n); i++) keep.add(i);
  let kept = 0;
  for (let i = n - 1; i >= 0 && kept < tail; i--) {
    keep.add(i);
    if (lines[i].trim() !== "") kept++;
  }
  let errCount = 0, warnCount = 0, distinct = 0;
  const firstSeen = /* @__PURE__ */ new Map();
  const repeats = /* @__PURE__ */ new Map();
  const summaries = [];
  for (let i = 0; i < n; i++) {
    const l = lines[i];
    if (l.trim() === "") continue;
    if (ERR_RE.test(l)) {
      if (/\bwarn/i.test(l)) warnCount++;
      else errCount++;
      const key = errKey(l);
      const first = firstSeen.get(key);
      if (first === void 0) {
        if (distinct < maxErr) {
          firstSeen.set(key, i);
          distinct++;
          for (let j = Math.max(0, i - ctx); j <= Math.min(n - 1, i + ctx + 1); j++) keep.add(j);
        }
      } else {
        repeats.set(first, (repeats.get(first) || 1) + 1);
      }
    }
    if (SUMMARY_RE.test(l) && summaries.length < 12) summaries.push(i);
  }
  for (const i of summaries) keep.add(i);
  const totalErr = errCount + warnCount;
  const out = [];
  out.push(`[nyquest digest: log output, ${n} lines; ${errCount} error-like and ${warnCount} warning-like lines, ${distinct} distinct${distinct >= maxErr && distinct < totalErr ? ` (first ${maxErr} distinct shown)` : " (all shown, repeats counted)"}; head and tail kept verbatim]`);
  let last = -1;
  const sorted = [...keep].sort((a, b) => a - b);
  for (const i of sorted) {
    if (i !== last + 1 && last >= 0) out.push(`... [${i - last - 1} lines omitted: ${last + 2}-${i}] ...`);
    const rep = repeats.get(i);
    out.push(rep ? `${lines[i]}  [x${rep} similar]` : lines[i]);
    last = i;
  }
  return out.join("\n");
}
var TS_RE = /\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?|\b\d{2}:\d{2}:\d{2}(\.\d+)?\b|\[\s*\d+(\.\d+)?\]|\bpid[= ]\d+\b|#\d+\b/gi;
function errKey(l) {
  return l.replace(TS_RE, "").replace(/\s+/g, " ").trim().toLowerCase();
}

// src/digest/data.ts
function typeOf(v) {
  if (v === null) return "null";
  if (Array.isArray(v)) return `array[${v.length}]`;
  return typeof v;
}
function short(v, max = 160) {
  const s = JSON.stringify(v);
  return s.length > max ? s.slice(0, max - 3) + "..." : s;
}
function digestData(text, opts = {}) {
  const records = opts.records ?? 3, head = opts.head ?? 25, tail = opts.tail ?? 8;
  const t = text.trim();
  try {
    const v = JSON.parse(t);
    const out2 = [];
    if (Array.isArray(v)) {
      out2.push(`[nyquest digest: JSON array of ${v.length} items; first ${Math.min(records, v.length)} shown verbatim]`);
      const first = v[0];
      if (first && typeof first === "object" && !Array.isArray(first)) {
        out2.push("keys: " + Object.entries(first).map(([k, x]) => `${k}:${typeOf(x)}`).join(", "));
      }
      for (const item of v.slice(0, records)) out2.push(short(item, 600));
    } else if (v && typeof v === "object") {
      const entries = Object.entries(v);
      out2.push(`[nyquest digest: JSON object with ${entries.length} keys; values summarised]`);
      for (const [k, x] of entries.slice(0, 60)) out2.push(`${k}: ${typeOf(x)} ${short(x, 120)}`);
      if (entries.length > 60) out2.push(`... ${entries.length - 60} more keys`);
    } else {
      return t.slice(0, 2e3);
    }
    return out2.join("\n");
  } catch {
  }
  const lines = t.replace(/\r\n/g, "\n").split("\n");
  const n = lines.length;
  if (n <= head + tail + 5) return lines.join("\n");
  const sepCount = (re) => lines.slice(0, 50).filter((l) => re.test(l)).length;
  const kind = sepCount(/\t/) > 25 ? "TSV" : sepCount(/,/) > 25 ? "CSV" : sepCount(/\|/) > 25 ? "table" : "listing";
  const flagged = [];
  for (let i = head; i < n - tail && flagged.length < 40; i++) {
    if (ERR_RE.test(lines[i]) && lines[i].trim().length < 400) flagged.push(`${i + 1}: ${lines[i]}`);
  }
  const out = [
    `[nyquest digest: ${kind}, ${n} lines; first ${head} and last ${tail} kept verbatim${flagged.length ? `, ${flagged.length} error-like rows kept` : ""}]`,
    ...lines.slice(0, head),
    `... [${n - head - tail} lines omitted: ${head + 1}-${n - tail}] ...`
  ];
  if (flagged.length) out.push("error-like rows:", ...flagged);
  out.push(...lines.slice(n - tail));
  return out.join("\n");
}

// src/digest/code.ts
var DEF_RE = /^\s*(export\s+)?(default\s+)?(pub(\([^)]*\))?\s+)?(async\s+)?(unsafe\s+)?(function\*?|class|def|fn|impl|struct|enum|trait|interface|type|mod|module|namespace|const|let|var|static|public|private|protected|func|object)\b\s*([A-Za-z_$][\w$]*)?/;
var LINE_NO = /^\s*(\d+)[\t:→| ]/;
function digestCode(text, opts = {}) {
  const head = opts.head ?? 10, tail = opts.tail ?? 5, maxDefs = opts.maxDefs ?? 80;
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const n = lines.length;
  if (n <= head + tail + 10) return lines.join("\n");
  const defs = [];
  for (let i = 0; i < n && defs.length < maxDefs; i++) {
    const l = lines[i];
    const m = l.match(LINE_NO);
    const body = m ? l.slice(m[0].length) : l;
    const d = body.match(DEF_RE);
    if (d && d[7] && !/^\s*(return|const|let|var)\s*$/.test(body)) {
      const no = m ? m[1] : String(i + 1);
      defs.push(`${no}: ${body.trim().slice(0, 110)}`);
    }
  }
  const out = [
    `[nyquest digest: code listing, ${n} lines; head/tail verbatim, ${defs.length} definitions indexed. Use recall(lines="a-b") for exact text before editing]`,
    ...lines.slice(0, head),
    `... [${n - head - tail} lines omitted: ${head + 1}-${n - tail}] ...`
  ];
  if (defs.length) out.push("definitions:", ...defs);
  out.push(...lines.slice(n - tail));
  return out.join("\n");
}

// src/digest/prose.ts
function digestProse(text, opts = {}) {
  const head = opts.head ?? 25, tail = opts.tail ?? 10;
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const n = lines.length;
  if (n <= head + tail + 5) {
    if (text.length > 4e3) {
      const h = text.slice(0, 1500), t = text.slice(-600);
      return `[nyquest digest: prose, ${n} lines / ${text.length} chars; first 1,500 and last 600 chars verbatim]
${h}
... [${text.length - 2100} chars omitted] ...
${t}`;
    }
    return lines.join("\n");
  }
  const headings = [];
  for (let i = head; i < n - tail && headings.length < 40; i++) {
    if (/^\s*#{1,4}\s+\S/.test(lines[i])) headings.push(`${i + 1}: ${lines[i].trim().slice(0, 100)}`);
  }
  const out = [
    `[nyquest digest: prose, ${n} lines; first ${head} and last ${tail} lines verbatim${headings.length ? `, ${headings.length} headings indexed` : ""}]`,
    ...lines.slice(0, head),
    `... [${n - head - tail} lines omitted: ${head + 1}-${n - tail}] ...`
  ];
  if (headings.length) out.push("headings:", ...headings);
  out.push(...lines.slice(n - tail));
  return out.join("\n");
}

// src/tokens.ts
var CHARS_PER_TOKEN = 3.9;
function estimateTokens(textOrChars) {
  const chars = typeof textOrChars === "number" ? textOrChars : textOrChars.length;
  if (!Number.isFinite(chars)) return 0;
  return Math.max(0, Math.round(chars / CHARS_PER_TOKEN));
}
function fmt(n) {
  return n.toLocaleString("en-US");
}

// src/digest/index.ts
function digestFor(cls, text) {
  switch (cls) {
    case "log":
      return digestLog(text);
    case "data":
      return digestData(text);
    case "code":
      return digestCode(text);
    case "prose":
      return digestProse(text);
  }
}
function makeDigest(text, tool, command, forced) {
  const cls = forced ?? classify(text, tool, command);
  const digest = digestFor(cls, text);
  return { cls, digest, lines: text.split("\n").length };
}
function guarantee(cls, method = "local") {
  if (method === "condense") return "The body above is a model-written summary: values, counts and exact wording may be missing";
  switch (cls) {
    case "log":
      return "The digest keeps every error and warning line, summary lines, and the head and tail verbatim";
    case "data":
      return "The digest keeps the head and tail verbatim plus the shape of the data; most rows are omitted";
    case "code":
      return "The digest keeps the head, the tail and a definition index; the body is omitted";
    case "prose":
      return "The digest keeps the head and tail verbatim; the middle is omitted";
  }
}
function footer(id, lines, chars, cls = "log", method = "local") {
  return [
    "",
    `[nyquest] Full output parked as ${id} (${fmt(lines)} lines, ~${fmt(estimateTokens(chars))} tokens, est.). ${guarantee(cls, method)}; if it already answers the question, use it as-is.`,
    `Only when a specific detail is missing: recall(id="${id}", grep="pattern") or recall(id="${id}", lines="120-180") returns exact text. Do not re-run the command to see the full output again.`
  ].join("\n");
}

// src/config.ts
var fs = __toESM(require("node:fs"));
var path = __toESM(require("node:path"));
var os = __toESM(require("node:os"));
var DEFAULTS = {
  enabled: true,
  level: 0.5,
  showSavings: true,
  retentionDays: 7,
  tools: {},
  remoteTools: {},
  minSavingTokens: 300
};
function nyquestHome() {
  return process.env.NYQUEST_HOME || path.join(os.homedir(), ".nyquest");
}
function configPath() {
  return path.join(nyquestHome(), "config.json");
}
function loadConfig() {
  let cfg = { ...DEFAULTS, tools: {}, remoteTools: {} };
  try {
    const raw = fs.readFileSync(configPath(), "utf8");
    const parsed = JSON.parse(raw);
    cfg = { ...cfg, ...parsed, tools: { ...parsed.tools || {} }, remoteTools: { ...parsed.remoteTools || {} } };
  } catch {
  }
  const env = (process.env.NYQUEST_COMPRESS || "").toLowerCase();
  if (env === "off" || env === "0" || env === "false") cfg.enabled = false;
  if (process.env.NYQUEST_LEVEL) {
    const l = Number(process.env.NYQUEST_LEVEL);
    if (Number.isFinite(l)) cfg.level = l;
  }
  if (process.env.NYQUEST_API_KEY) cfg.apiKey = process.env.NYQUEST_API_KEY;
  cfg.level = clamp01(cfg.level);
  if (typeof cfg.minSavingTokens !== "number" || !Number.isFinite(cfg.minSavingTokens) || cfg.minSavingTokens < 0) cfg.minSavingTokens = DEFAULTS.minSavingTokens;
  return cfg;
}
function saveConfig(cfg) {
  fs.mkdirSync(nyquestHome(), { recursive: true });
  const { apiKey, ...rest } = cfg;
  const out = { ...rest };
  if (apiKey) out.apiKey = apiKey;
  fs.writeFileSync(configPath(), JSON.stringify(out, null, 2));
}
function clamp01(n) {
  if (!Number.isFinite(n)) return DEFAULTS.level;
  return Math.max(0, Math.min(1, n));
}
function thresholdFor(level) {
  if (level <= 0) return Number.POSITIVE_INFINITY;
  if (level < 0.4) return 16e3;
  if (level < 0.7) return 6e3;
  if (level < 0.95) return 3e3;
  return 2e3;
}
function proseThresholdFor(level) {
  return thresholdFor(level) * 2;
}
function codeParkingEnabled(level) {
  return level >= 0.8;
}
var NEVER_PARK = /* @__PURE__ */ new Set([
  "Read",
  "Edit",
  "Write",
  "NotebookEdit",
  "Glob",
  "Grep",
  "MultiEdit",
  "TodoWrite",
  "AskUserQuestion",
  "ExitPlanMode"
]);
function toolEligible(tool, cfg) {
  if (NEVER_PARK.has(tool)) return false;
  if (tool.startsWith("mcp__plugin_nyquest")) return false;
  if (cfg.tools[tool] === false) return false;
  return true;
}
var REMOTE_OK = /* @__PURE__ */ new Set(["WebFetch", "WebSearch", "Agent", "Task", "digest_url"]);
function remoteEligible(tool, cfg) {
  const override = cfg.remoteTools[tool];
  if (override === true) return true;
  if (override === false) return false;
  return REMOTE_OK.has(tool);
}

// src/store.ts
var fs2 = __toESM(require("node:fs"));
var path2 = __toESM(require("node:path"));
var crypto = __toESM(require("node:crypto"));
function ctxRoot() {
  return path2.join(nyquestHome(), "ctx");
}
function sessionDir(session) {
  return path2.join(ctxRoot(), safe(session));
}
function safe(s) {
  return String(s || "unknown").replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 80);
}
function makeId(seed) {
  return "nyq:" + crypto.createHash("sha1").update(seed + ":" + Date.now() + ":" + Math.random()).digest("hex").slice(0, 6);
}
function readIndex(dir) {
  try {
    return JSON.parse(fs2.readFileSync(path2.join(dir, "index.json"), "utf8"));
  } catch {
    return [];
  }
}
function writeIndex(dir, entries) {
  fs2.writeFileSync(path2.join(dir, "index.json"), JSON.stringify(entries, null, 1));
}
function park(session, text, meta) {
  const dir = sessionDir(session);
  fs2.mkdirSync(dir, { recursive: true });
  const id = makeId(session + meta.tool);
  fs2.writeFileSync(path2.join(dir, id.slice(4) + ".txt"), text);
  const entry = {
    id,
    session: safe(session),
    created: (/* @__PURE__ */ new Date()).toISOString(),
    recalls: 0,
    chars: text.length,
    lines: text.split("\n").length,
    ...meta
  };
  const idx = readIndex(dir);
  idx.push(entry);
  writeIndex(dir, idx);
  return entry;
}
function locate(id, session) {
  const norm = id.startsWith("nyq:") ? id : "nyq:" + id;
  const dirs = [];
  if (session) dirs.push(sessionDir(session));
  try {
    for (const d of fs2.readdirSync(ctxRoot())) dirs.push(path2.join(ctxRoot(), d));
  } catch {
  }
  for (const dir of dirs) {
    const entry = readIndex(dir).find((e) => e.id === norm);
    if (entry) {
      const file2 = path2.join(dir, norm.slice(4) + ".txt");
      if (fs2.existsSync(file2)) return { entry, file: file2, dir };
    }
  }
  return void 0;
}
function readParked(loc) {
  return fs2.readFileSync(loc.file, "utf8");
}
function listSession(session) {
  return readIndex(sessionDir(session));
}
function purgeOld(retentionDays) {
  let removed = 0;
  const cutoff = Date.now() - retentionDays * 864e5;
  try {
    for (const d of fs2.readdirSync(ctxRoot())) {
      const p = path2.join(ctxRoot(), d);
      let mtime = 0;
      try {
        mtime = fs2.statSync(p).mtimeMs;
      } catch {
        continue;
      }
      if (mtime < cutoff) {
        fs2.rmSync(p, { recursive: true, force: true });
        removed++;
      }
    }
  } catch {
  }
  return removed;
}
function storeSize() {
  let sessions = 0, bytes = 0;
  try {
    for (const d of fs2.readdirSync(ctxRoot())) {
      sessions++;
      const p = path2.join(ctxRoot(), d);
      for (const f of fs2.readdirSync(p)) {
        try {
          bytes += fs2.statSync(path2.join(p, f)).size;
        } catch {
        }
      }
    }
  } catch {
  }
  return { sessions, bytes };
}

// src/ledger.ts
var fs3 = __toESM(require("node:fs"));
var path3 = __toESM(require("node:path"));
function file(session) {
  return path3.join(nyquestHome(), "sessions", String(session || "unknown").replace(/[^A-Za-z0-9_.-]/g, "_") + ".json");
}
function loadLedger(session) {
  try {
    return JSON.parse(fs3.readFileSync(file(session), "utf8"));
  } catch {
    return { session, started: (/* @__PURE__ */ new Date()).toISOString(), parks: [], recalls: [], skipped: {} };
  }
}
function saveLedger(l) {
  fs3.mkdirSync(path3.dirname(file(l.session)), { recursive: true });
  fs3.writeFileSync(file(l.session), JSON.stringify(l, null, 1));
}
function recordPark(session, r) {
  const l = loadLedger(session);
  l.parks.push({ ...r, at: (/* @__PURE__ */ new Date()).toISOString() });
  saveLedger(l);
  return l;
}
function recordSkip(session, reason) {
  const l = loadLedger(session);
  l.skipped[reason] = (l.skipped[reason] || 0) + 1;
  saveLedger(l);
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
  for (const r of l.recalls) charsRecalled += r.chars;
  const net = Math.max(0, charsParked - charsDigest - charsRecalled);
  return {
    parks: l.parks.length,
    recalls: l.recalls.length,
    charsParked,
    charsDigest,
    charsRecalled,
    tokensSavedOnce: estimateTokens(net),
    tokensSavedPerTurn: estimateTokens(Math.max(0, charsParked - charsDigest)),
    byTool
  };
}

// src/hook.ts
var fs5 = __toESM(require("node:fs"));
var path5 = __toESM(require("node:path"));

// src/settings.ts
var fs4 = __toESM(require("node:fs"));
var path4 = __toESM(require("node:path"));
var os2 = __toESM(require("node:os"));
var DEFAULT_PERSIST_LIMIT = 3e4;
function readJson(file2) {
  try {
    const v = JSON.parse(fs4.readFileSync(file2, "utf8"));
    return v && typeof v === "object" ? v : void 0;
  } catch {
    return void 0;
  }
}
function persistLimit(...settings) {
  let limit = DEFAULT_PERSIST_LIMIT;
  for (const s of settings) {
    const v = s?.bashOutputMaxChars;
    if (typeof v === "number" && Number.isFinite(v) && v >= 1e3) limit = Math.floor(v);
  }
  return limit;
}
function bashPersistLimit(cwd) {
  const configDir = process.env.CLAUDE_CONFIG_DIR || path4.join(os2.homedir(), ".claude");
  const files = [path4.join(configDir, "settings.json")];
  if (cwd) files.push(path4.join(cwd, ".claude", "settings.json"), path4.join(cwd, ".claude", "settings.local.json"));
  return persistLimit(...files.map(readJson));
}

// src/api.ts
var DEFAULT_BASE = "https://api.nyquest.ai";
var SECRET_PATTERNS = [
  String.raw`sk-[A-Za-z0-9_-]{16,}`,
  // OpenAI, Anthropic (sk-ant-), sk-proj-
  String.raw`sk_(?:live|test)_[A-Za-z0-9]{16,}`,
  // Stripe secret keys
  String.raw`rk_(?:live|test)_[A-Za-z0-9]{16,}`,
  // Stripe restricted keys
  String.raw`gh[pousr]_[A-Za-z0-9]{20,}`,
  // GitHub ghp_/gho_/ghu_/ghs_/ghr_
  String.raw`github_pat_[A-Za-z0-9_]{20,}`,
  String.raw`(?:AKIA|ASIA)[A-Z0-9]{16}`,
  // AWS access key ids
  String.raw`xox[baprs]-[A-Za-z0-9-]{10,}`,
  // Slack
  String.raw`AIza[0-9A-Za-z_-]{35}`,
  // Google API keys
  String.raw`nq-v1-[A-Za-z0-9_-]{20,}`,
  // Nyquest
  String.raw`-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----`,
  String.raw`eyJ[A-Za-z0-9_-]{30,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}`,
  // JWT
  String.raw`[a-z][a-z0-9+.-]*://[^\s/:@]+:[^\s@]+@`,
  // scheme://user:password@host
  String.raw`authorization:\s*(?:bearer|basic|token)\s+\S{8,}`,
  String.raw`\bbasic\s+[A-Za-z0-9+/]{16,}={0,2}`,
  String.raw`sharedaccesssignature=\S+`,
  String.raw`\bsig=[A-Za-z0-9%+/=]{20,}`,
  String.raw`(?<![A-Za-z0-9])(?:password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|client[_-]?secret|secret[_-]?access[_-]?key|secret[_-]?key|auth[_-]?token|session[_-]?token)\s*[:=]\s*["']?[^\s"']+`
];
var RE_SECRET = new RegExp(SECRET_PATTERNS.join("|"), "gi");
function redact(text) {
  return text.replace(RE_SECRET, "[REDACTED]");
}
function fullMode(cfg = loadConfig()) {
  return Boolean(cfg.apiKey && cfg.apiKey.startsWith("nq-v1-"));
}
var lastError;
async function post(cfg, path6, body, timeoutMs) {
  lastError = void 0;
  if (!fullMode(cfg)) {
    lastError = "not-full-mode";
    return void 0;
  }
  const base = (cfg.apiBase || process.env.NYQUEST_API_BASE || DEFAULT_BASE).replace(/\/$/, "");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(base + path6, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${cfg.apiKey}`, "user-agent": "nyquest-claude-mcp/0.3.0" },
      body: JSON.stringify(body),
      signal: ctrl.signal
    });
    if (!r.ok) {
      lastError = `HTTP ${r.status}`;
      return void 0;
    }
    return await r.json();
  } catch (e) {
    lastError = e?.name === "AbortError" ? `timeout ${timeoutMs}ms` : String(e?.message || e).slice(0, 120);
    return void 0;
  } finally {
    clearTimeout(timer);
  }
}
async function condense(text, kind, cfg = loadConfig(), timeoutMs = 15e3) {
  const r = await post(cfg, "/v1/plugin/condense", { text: redact(text), kind }, timeoutMs);
  if (!r || typeof r.digest !== "string" || !r.digest.trim()) return void 0;
  return r;
}
async function reportParks(events, cfg = loadConfig(), timeoutMs = 2500) {
  if (!events.length) return 0;
  const r = await post(cfg, "/v1/plugin/events", { events: events.slice(0, 50) }, timeoutMs);
  return r && typeof r.accepted === "number" ? r.accepted : 0;
}
async function getSettings(cfg = loadConfig(), timeoutMs = 4e3) {
  if (!fullMode(cfg)) return void 0;
  const base = (cfg.apiBase || process.env.NYQUEST_API_BASE || DEFAULT_BASE).replace(/\/$/, "");
  try {
    const r = await fetch(`${base}/user/plugin/settings`, { headers: { authorization: `Bearer ${cfg.apiKey}` }, signal: AbortSignal.timeout(timeoutMs) });
    if (!r.ok) return void 0;
    const j = await r.json();
    return { level: typeof j.level === "number" ? j.level : null, updated_at: typeof j.updated_at === "string" ? j.updated_at : null };
  } catch {
    return void 0;
  }
}
async function putSettings(level, cfg = loadConfig(), timeoutMs = 4e3) {
  const base = (cfg.apiBase || process.env.NYQUEST_API_BASE || DEFAULT_BASE).replace(/\/$/, "");
  if (!fullMode(cfg)) return void 0;
  try {
    const r = await fetch(`${base}/user/plugin/settings`, {
      method: "PUT",
      headers: { "content-type": "application/json", authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({ level }),
      signal: AbortSignal.timeout(timeoutMs)
    });
    if (!r.ok) return void 0;
    return await r.json();
  } catch {
    return void 0;
  }
}

// src/sync.ts
async function syncLevel(cfg = loadConfig()) {
  if (!fullMode(cfg)) return { action: "skipped", level: cfg.level };
  const remote = await getSettings(cfg);
  if (!remote) return { action: "skipped", level: cfg.level };
  const localAt = cfg.levelUpdatedAt ? Date.parse(cfg.levelUpdatedAt) : 0;
  const remoteAt = remote.updated_at ? Date.parse(remote.updated_at) : 0;
  if (remote.level === null) {
    const r2 = await putSettings(cfg.level, cfg);
    return { action: r2 ? "pushed" : "skipped", level: cfg.level };
  }
  if (Math.abs(remote.level - cfg.level) < 5e-3) return { action: "same", level: cfg.level };
  if (remoteAt >= localAt) {
    cfg.level = clamp01(remote.level);
    cfg.levelUpdatedAt = remote.updated_at || (/* @__PURE__ */ new Date()).toISOString();
    saveConfig(cfg);
    return { action: "pulled", level: cfg.level };
  }
  const r = await putSettings(cfg.level, cfg);
  return { action: r ? "pushed" : "skipped", level: cfg.level };
}

// src/hook.ts
var TARGETED_READ = /^\s*(?:grep|rg|sed\s+-n|head|tail|awk|Select-String)\b|\|\s*(?:head|tail|Select-String|Select-Object\s+-(?:First|Last))\b|\bGet-Content\b[^|]*-(?:Head|Tail|TotalCount)\b/i;
var TARGETED_READ_MAX_CHARS = 8e3;
var NOTE_TOKENS = 85;
function log(line) {
  try {
    fs5.mkdirSync(nyquestHome(), { recursive: true });
    fs5.appendFileSync(path5.join(nyquestHome(), "hook.log"), `${(/* @__PURE__ */ new Date()).toISOString()} ${line}
`);
  } catch {
  }
}
function learnShape(tool, resp) {
  try {
    const shape = resp === null ? "null" : Array.isArray(resp) ? `array[${resp.length}]<${resp[0] && typeof resp[0] === "object" ? Object.keys(resp[0]).join(",") : typeof resp[0]}>` : typeof resp === "object" ? "{" + Object.keys(resp).map((k) => `${k}:${typeof resp[k]}`).join(",") + "}" : typeof resp;
    const f = path5.join(nyquestHome(), "shapes.json");
    let known = {};
    try {
      known = JSON.parse(fs5.readFileSync(f, "utf8"));
    } catch {
    }
    const arr = known[tool] || (known[tool] = []);
    if (!arr.includes(shape)) {
      arr.push(shape);
      fs5.mkdirSync(nyquestHome(), { recursive: true });
      fs5.writeFileSync(f, JSON.stringify(known, null, 1));
    }
  } catch {
  }
}
function extract(resp) {
  if (typeof resp === "string") return { text: resp, rebuild: (d) => d };
  if (Array.isArray(resp)) {
    const texts = resp.filter((b) => b && typeof b === "object" && b.type === "text" && typeof b.text === "string");
    if (texts.length && texts.length === resp.length) {
      return { text: texts.map((b) => b.text).join("\n"), rebuild: (d) => [{ type: "text", text: d }] };
    }
    return void 0;
  }
  if (resp && typeof resp === "object") {
    const o = resp;
    if (typeof o.stdout === "string") {
      const stderr = typeof o.stderr === "string" ? o.stderr : "";
      const text = stderr ? `${o.stdout}
[stderr]
${stderr}` : o.stdout;
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
  return void 0;
}
function commandOf(tool, input) {
  if (!input) return void 0;
  for (const k of ["command", "url", "prompt", "query", "pattern", "description"]) {
    if (typeof input[k] === "string") return String(input[k]).slice(0, 200);
  }
  return void 0;
}
async function handlePostToolUse(input, cfg) {
  const tool = input.tool_name || "";
  const session = input.session_id || "unknown";
  if (!cfg.enabled || !toolEligible(tool, cfg)) return void 0;
  learnShape(tool, input.tool_response);
  const ex = extract(input.tool_response);
  if (!ex) {
    recordSkip(session, "unknown-shape:" + tool);
    return void 0;
  }
  const threshold = thresholdFor(cfg.level);
  if (ex.text.length < threshold) return void 0;
  const resp = input.tool_response;
  const persisted = !!(resp && typeof resp === "object" && (resp.persistedOutputPath || resp.persistedOutputSize));
  if (persisted || ex.text.includes("<persisted-output>") || tool === "Bash" && ex.text.length >= bashPersistLimit(input.cwd)) {
    recordSkip(session, "already-persisted-by-claude-code");
    return void 0;
  }
  const command = commandOf(tool, input.tool_input);
  const bare = command ? command.replace(/^\s*cd\s+[^&;|]+(?:&&|;)\s*/, "") : void 0;
  if (bare && TARGETED_READ.test(bare) && ex.text.length < TARGETED_READ_MAX_CHARS) {
    recordSkip(session, "targeted-read");
    return void 0;
  }
  let { cls, digest, lines } = makeDigest(ex.text, tool, command);
  if (cls === "code" && !codeParkingEnabled(cfg.level)) {
    recordSkip(session, "code-untouched");
    return void 0;
  }
  if (cls === "prose" && ex.text.length < proseThresholdFor(cfg.level)) {
    recordSkip(session, "prose-below-threshold");
    return void 0;
  }
  let method = "local";
  if (cls === "prose" && fullMode(cfg)) {
    if (!remoteEligible(tool, cfg)) {
      recordSkip(session, "remote-not-eligible");
    } else {
      const r = await condense(ex.text, cls, cfg);
      if (r && r.smaller && r.digest.length < digest.length) {
        digest = `[nyquest digest: prose, condensed by Nyquest (${r.model}); ~${fmt(r.original_tokens)} \u2192 ~${fmt(r.condensed_tokens)} tokens. Model-written summary; recall for exact text]
` + r.digest;
        method = "condense";
      } else {
        recordSkip(session, r ? "condense-not-smaller" : "condense-unavailable");
      }
    }
  }
  const footerChars = footer("nyq:000000", lines, ex.text.length, cls, method).length;
  const originalTokens = estimateTokens(ex.text.length);
  const replacementTokens = estimateTokens(digest.length + footerChars);
  const netSaved = originalTokens - replacementTokens - (cfg.showSavings ? NOTE_TOKENS : 0);
  if (netSaved < cfg.minSavingTokens || replacementTokens > originalTokens * 0.7) {
    recordSkip(session, "saving-too-small");
    return void 0;
  }
  const entry = park(session, ex.text, { tool, command, cls, digestChars: digest.length });
  const body = digest + "\n" + footer(entry.id, lines, ex.text.length, cls, method);
  recordPark(session, { id: entry.id, tool, cls, chars: ex.text.length, digestChars: body.length });
  if (fullMode(cfg)) {
    const n = await reportParks([{ tool, kind: cls, method, chars_in: ex.text.length, chars_out: body.length, tokens_in: estimateTokens(ex.text.length), tokens_out: estimateTokens(body.length) }], cfg);
    log(`report ${entry.id} accepted=${n}${n ? "" : ` error=${lastError || "unknown"}`}`);
  }
  const saved = estimateTokens(ex.text.length) - estimateTokens(body.length);
  const out = {
    hookSpecificOutput: { hookEventName: "PostToolUse", updatedToolOutput: ex.rebuild(body) }
  };
  if (cfg.showSavings) {
    const askHint = fullMode(cfg) && remoteEligible(tool, cfg) ? ` (recall(id="${entry.id}", ask="...") returns just an answer)` : "";
    out.hookSpecificOutput.additionalContext = `Nyquest parked this ${cls} output as ${entry.id}: ~${fmt(estimateTokens(ex.text.length))} \u2192 ~${fmt(estimateTokens(body.length))} tokens (est., ${fmt(saved)} kept out of context on every later turn). ${guarantee(cls, method)}; recall only if a detail you need is absent${askHint}.`;
    out.systemMessage = `Nyquest: parked ${cls} output ${entry.id}, ~${fmt(estimateTokens(ex.text.length))} \u2192 ~${fmt(estimateTokens(body.length))} tokens (est.), ${fmt(saved)} kept out of context on every later turn.`;
  }
  log(`park ${entry.id} tool=${tool} cls=${cls} method=${method} chars=${ex.text.length} digest=${body.length} session=${session}`);
  return out;
}
async function sessionStart(input, cfg) {
  const removed = purgeOld(cfg.retentionDays);
  const size = storeSize();
  const mode = fullMode(cfg) ? "full" : "local";
  let synced = "";
  try {
    const s2 = await syncLevel(cfg);
    if (s2.action === "pulled") {
      cfg.level = s2.level;
      synced = ` Level ${s2.level} pulled from your Nyquest account settings.`;
    } else if (s2.action === "pushed") synced = " Level published to your Nyquest account settings.";
  } catch {
  }
  const l = loadLedger(input.session_id || "unknown");
  const s = summarize(l);
  const prior = s.parks ? ` This session so far: ${s.parks} parked, ${s.recalls} recalls.` : "";
  if (!cfg.enabled) return `Nyquest context manager: OFF (NYQUEST_COMPRESS=off or disabled in ~/.nyquest/config.json). Say "turn Nyquest on" to re-enable.`;
  const hint = mode === "local" ? " Full mode (free, adds platform condensation and recall(ask=...)): /nyquest:setup." : "";
  return `Nyquest context manager: ${mode} mode, level ${cfg.level} (/nyquest:level to change), results over ~${fmt(estimateTokens(thresholdFor(cfg.level)))} tokens are parked with a digest; use the nyquest recall tool for exact text. Store: ${size.sessions} sessions, ${fmt(Math.round(size.bytes / 1024))} KB${removed ? `, purged ${removed} old` : ""}.${prior}${synced}${hint}`;
}
async function main() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  const raw = Buffer.concat(chunks).toString("utf8");
  let input = {};
  try {
    input = raw.trim() ? JSON.parse(raw) : {};
  } catch {
    input = {};
  }
  const cfg = loadConfig();
  if (process.argv.includes("--session-start") || input.hook_event_name === "SessionStart") {
    const line = await sessionStart(input, cfg);
    process.stdout.write(JSON.stringify({
      systemMessage: line,
      hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: line }
    }));
    return;
  }
  if (input.hook_event_name !== "PostToolUse") return;
  const out = await handlePostToolUse(input, cfg);
  if (out) process.stdout.write(JSON.stringify(out));
}
if (require.main === module) {
  main().catch((e) => {
    log("error " + (e && e.stack ? e.stack : String(e)));
    process.exitCode = 0;
  });
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  DEFAULTS,
  DEFAULT_PERSIST_LIMIT,
  ERR_RE,
  NEVER_PARK,
  REMOTE_OK,
  bashPersistLimit,
  classify,
  codeParkingEnabled,
  digestCode,
  digestData,
  digestFor,
  digestLog,
  digestProse,
  errKey,
  estimateTokens,
  extract,
  footer,
  fullMode,
  guarantee,
  handlePostToolUse,
  listSession,
  loadConfig,
  loadLedger,
  locate,
  makeDigest,
  park,
  persistLimit,
  purgeOld,
  readParked,
  redact,
  remoteEligible,
  storeSize,
  summarize,
  thresholdFor,
  toolEligible
});
