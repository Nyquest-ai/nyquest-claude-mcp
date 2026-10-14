"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
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

// src/stdio.ts
var SUPPORTED_PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
function send(msg) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}
function checkArgs(schema, args) {
  for (const name of schema.required || []) {
    if (args[name] === void 0 || args[name] === null) return `missing required argument "${name}"`;
  }
  for (const [name, spec] of Object.entries(schema.properties || {})) {
    const v = args[name];
    if (v === void 0 || v === null) continue;
    if (spec.type === "string") {
      if (typeof v !== "string") return `"${name}" must be a string`;
      if (spec.enum && !spec.enum.includes(v)) return `"${name}" must be one of: ${spec.enum.join(", ")}`;
      if (spec.pattern && !new RegExp(spec.pattern).test(v)) return `"${name}" does not look like ${spec.description || spec.pattern}`;
    } else if (spec.type === "number" || spec.type === "integer") {
      if (typeof v !== "number" || !Number.isFinite(v)) return `"${name}" must be a number`;
      if (spec.type === "integer" && !Number.isInteger(v)) return `"${name}" must be a whole number`;
      if (spec.minimum !== void 0 && v < spec.minimum) return `"${name}" must be at least ${spec.minimum}`;
      if (spec.maximum !== void 0 && v > spec.maximum) return `"${name}" must be at most ${spec.maximum}`;
    } else if (spec.type === "boolean" && typeof v !== "boolean") {
      return `"${name}" must be true or false`;
    }
  }
  return void 0;
}
function serve(info, tools) {
  const byName = new Map(tools.map((t) => [t.name, t]));
  const listing = tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));
  const reply = (id, result) => send({ jsonrpc: "2.0", id, result });
  const fail = (id, code, message) => send({ jsonrpc: "2.0", id, error: { code, message } });
  let pending = 0;
  let closed = false;
  function exitWhenDrained() {
    if (!closed || pending > 0) return;
    process.exitCode = 0;
    setTimeout(() => process.exit(0), 1e4).unref();
  }
  function handle(line) {
    pending++;
    dispatch(line).catch((e) => process.stderr.write(`nyquest: ${e?.message || String(e)}
`)).finally(() => {
      pending--;
      exitWhenDrained();
    });
  }
  async function dispatch(line) {
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } });
      return;
    }
    const id = msg?.id;
    const isRequest = id !== void 0 && id !== null;
    const method = String(msg?.method ?? "");
    const params = msg?.params ?? {};
    try {
      switch (method) {
        case "initialize": {
          const asked = params.protocolVersion;
          reply(id, {
            protocolVersion: SUPPORTED_PROTOCOL_VERSIONS.includes(asked) ? asked : SUPPORTED_PROTOCOL_VERSIONS[0],
            capabilities: { tools: { listChanged: false } },
            serverInfo: info
          });
          return;
        }
        case "tools/list":
          reply(id, { tools: listing });
          return;
        case "tools/call": {
          const tool = byName.get(String(params.name ?? ""));
          if (!tool) {
            if (isRequest) fail(id, -32602, `unknown tool: ${params.name}`);
            return;
          }
          const args = params.arguments ?? {};
          const bad = checkArgs(tool.inputSchema, args);
          const out = bad ? { content: [{ type: "text", text: `nyquest: ${bad}` }], isError: true } : await tool.handler(args);
          if (isRequest) reply(id, out);
          return;
        }
        case "ping":
          if (isRequest) reply(id, {});
          return;
        default:
          if (isRequest) fail(id, -32601, `method not found: ${method}`);
      }
    } catch (e) {
      const text2 = `nyquest: ${e?.message || String(e)}`;
      if (isRequest) reply(id, { content: [{ type: "text", text: text2 }], isError: true });
      else process.stderr.write(text2 + "\n");
    }
  }
  let buffer = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    buffer += chunk;
    for (; ; ) {
      const nl = buffer.indexOf("\n");
      if (nl < 0) break;
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line) handle(line);
    }
  });
  process.stdin.on("end", () => {
    closed = true;
    exitWhenDrained();
  });
  process.stdin.on("error", () => {
    closed = true;
    exitWhenDrained();
  });
}

// src/mcp.ts
var fs4 = __toESM(require("node:fs"));
var path5 = __toESM(require("node:path"));

// src/config.ts
var fs2 = __toESM(require("node:fs"));
var path2 = __toESM(require("node:path"));
var os = __toESM(require("node:os"));

// src/fsutil.ts
var fs = __toESM(require("node:fs"));
var path = __toESM(require("node:path"));
var TRANSIENT = /* @__PURE__ */ new Set(["EPERM", "EBUSY", "EACCES", "EAGAIN"]);
function pause(ms) {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch {
  }
}
function writeFileAtomic(file2, data) {
  const dir = path.dirname(file2);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(file2)}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`);
  fs.writeFileSync(tmp, data);
  let lastErr;
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      fs.renameSync(tmp, file2);
      return;
    } catch (e) {
      lastErr = e;
      if (!TRANSIENT.has(e.code || "")) break;
      pause(5 + attempt * 10);
    }
  }
  try {
    fs.unlinkSync(tmp);
  } catch {
  }
  throw lastErr;
}
function writeJsonAtomic(file2, value, indent = 1) {
  writeFileAtomic(file2, JSON.stringify(value, null, indent));
}
function readJsonFile(file2) {
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      return JSON.parse(fs.readFileSync(file2, "utf8"));
    } catch (e) {
      const code = e.code;
      if (code === "ENOENT") return void 0;
      if (!TRANSIENT.has(code || "") && !(e instanceof SyntaxError)) return void 0;
      pause(5 + attempt * 10);
    }
  }
  return void 0;
}

// src/config.ts
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
  return process.env.NYQUEST_HOME || path2.join(os.homedir(), ".nyquest");
}
function configPath() {
  return path2.join(nyquestHome(), "config.json");
}
function loadConfig() {
  let cfg = { ...DEFAULTS, tools: {}, remoteTools: {} };
  try {
    const raw = fs2.readFileSync(configPath(), "utf8");
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
  const { apiKey, ...rest } = cfg;
  const out = { ...rest };
  if (apiKey) out.apiKey = apiKey;
  writeJsonAtomic(configPath(), out, 2);
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
var REMOTE_OK = /* @__PURE__ */ new Set(["WebFetch", "WebSearch", "Agent", "Task", "digest_url"]);
function remoteEligible(tool, cfg) {
  const override = cfg.remoteTools[tool];
  if (override === true) return true;
  if (override === false) return false;
  return REMOTE_OK.has(tool);
}

// src/store.ts
var fs3 = __toESM(require("node:fs"));
var path3 = __toESM(require("node:path"));
var crypto = __toESM(require("node:crypto"));
function ctxRoot() {
  return path3.join(nyquestHome(), "ctx");
}
function sessionDir(session) {
  return path3.join(ctxRoot(), safe(session));
}
function safe(s) {
  return String(s || "unknown").replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 80);
}
function makeId(seed) {
  return "nyq:" + crypto.createHash("sha1").update(seed + ":" + Date.now() + ":" + Math.random()).digest("hex").slice(0, 6);
}
function entryFile(dir, id) {
  return path3.join(dir, id.slice(4) + ".json");
}
function readIndex(dir) {
  let names;
  try {
    names = fs3.readdirSync(dir);
  } catch {
    return [];
  }
  const byId = /* @__PURE__ */ new Map();
  if (names.includes("index.json")) {
    const legacy = readJsonFile(path3.join(dir, "index.json"));
    if (Array.isArray(legacy)) {
      for (const e of legacy) if (e && e.id) byId.set(e.id, e);
    }
  }
  for (const f of names) {
    if (f === "index.json" || f.startsWith(".") || !f.endsWith(".json")) continue;
    const e = readJsonFile(path3.join(dir, f));
    if (e && typeof e === "object" && e.id) byId.set(e.id, e);
  }
  return [...byId.values()].sort((a, b) => a.created < b.created ? -1 : a.created > b.created ? 1 : 0);
}
function park(session, text2, meta) {
  const dir = sessionDir(session);
  fs3.mkdirSync(dir, { recursive: true });
  let id = makeId(session + meta.tool);
  while (fs3.existsSync(entryFile(dir, id)) || fs3.existsSync(path3.join(dir, id.slice(4) + ".txt"))) id = makeId(session + meta.tool + id);
  fs3.writeFileSync(path3.join(dir, id.slice(4) + ".txt"), text2);
  const entry = {
    id,
    session: safe(session),
    created: (/* @__PURE__ */ new Date()).toISOString(),
    recalls: 0,
    chars: text2.length,
    lines: text2.split("\n").length,
    ...meta
  };
  writeJsonAtomic(entryFile(dir, id), entry);
  return entry;
}
function locate(id, session) {
  const norm = id.startsWith("nyq:") ? id : "nyq:" + id;
  const dirs = [];
  if (session) dirs.push(sessionDir(session));
  try {
    for (const d of fs3.readdirSync(ctxRoot())) dirs.push(path3.join(ctxRoot(), d));
  } catch {
  }
  for (const dir of dirs) {
    const entry = readIndex(dir).find((e) => e.id === norm);
    if (entry) {
      const file2 = path3.join(dir, norm.slice(4) + ".txt");
      if (fs3.existsSync(file2)) return { entry, file: file2, dir };
    }
  }
  return void 0;
}
function readParked(loc) {
  return fs3.readFileSync(loc.file, "utf8");
}
function bumpRecall(loc) {
  loc.entry.recalls++;
  try {
    writeJsonAtomic(entryFile(loc.dir, loc.entry.id), loc.entry);
  } catch {
  }
}
function listSession(session) {
  return readIndex(sessionDir(session));
}
function latestSession() {
  let best;
  try {
    for (const d of fs3.readdirSync(ctxRoot())) {
      let mtime = 0;
      try {
        mtime = fs3.statSync(path3.join(ctxRoot(), d)).mtimeMs;
      } catch {
        continue;
      }
      if (!best || mtime > best.mtime) best = { name: d, mtime };
    }
  } catch {
  }
  return best?.name;
}
function storeSize() {
  let sessions = 0, bytes = 0;
  try {
    for (const d of fs3.readdirSync(ctxRoot())) {
      sessions++;
      const p = path3.join(ctxRoot(), d);
      for (const f of fs3.readdirSync(p)) {
        try {
          bytes += fs3.statSync(path3.join(p, f)).size;
        } catch {
        }
      }
    }
  } catch {
  }
  return { sessions, bytes };
}

// src/ledger.ts
var path4 = __toESM(require("node:path"));

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

// src/ledger.ts
function file(session) {
  return path4.join(nyquestHome(), "sessions", String(session || "unknown").replace(/[^A-Za-z0-9_.-]/g, "_") + ".json");
}
function loadLedger(session) {
  const l = readJsonFile(file(session));
  if (l && Array.isArray(l.parks) && Array.isArray(l.recalls)) return { ...l, skipped: l.skipped || {} };
  return { session, started: (/* @__PURE__ */ new Date()).toISOString(), parks: [], recalls: [], skipped: {} };
}
function saveLedger(l) {
  writeJsonAtomic(file(l.session), l);
}
function saveQuietly(l) {
  try {
    saveLedger(l);
  } catch {
  }
}
function recordPark(session, r) {
  const l = loadLedger(session);
  l.parks.push({ ...r, at: (/* @__PURE__ */ new Date()).toISOString() });
  saveQuietly(l);
  return l;
}
function recordRecall(session, r) {
  const l = loadLedger(session);
  l.recalls.push({ ...r, at: (/* @__PURE__ */ new Date()).toISOString() });
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

// src/classify.ts
var CODE_CMD = /\b(sed\s+-n|cat\s+(-n\s+)?[^|;]*\.(rs|js|jsx|ts|tsx|py|go|java|rb|php|c|cc|cpp|h|hpp|cs|swift|kt|html|css|scss|toml|json|ya?ml|sh|sql)\b|git\s+(diff|show)\b|grep\s+-[a-zA-Z]*n)/;
var CODE_LINE = /^\s*(import\s|export\s|from\s+\S+\s+import|#include|use\s+\S+;|package\s|(pub\s+)?(async\s+)?fn\s|def\s|class\s|function\s|const\s|let\s|var\s|return\b|if\s*\(|for\s*\(|while\s*\(|\}\s*else|#\[|@\w+|<\/?[a-zA-Z][^>]*>)/;
var LOG_LINE = /(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}|\b(INFO|WARN|WARNING|ERROR|DEBUG|TRACE|FATAL)\b|^\s*(npm|yarn|pnpm|pip|cargo|go|make|gcc|rustc|tsc|jest|pytest|PASS|FAIL|ok|\[\d+\/\d+\])\b|^\s*(===|---|>>>|\$ |# ))/;
function classify(text2, tool, command) {
  const t = text2.trim();
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
function digestLog(text2, opts = {}) {
  const head = opts.head ?? 25, tail = opts.tail ?? 15, maxErr = opts.maxErr ?? 80, ctx = opts.context ?? 1;
  const lines = text2.replace(/\r\n/g, "\n").replace(ANSI, "").split("\n");
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
function digestData(text2, opts = {}) {
  const records = opts.records ?? 3, head = opts.head ?? 25, tail = opts.tail ?? 8;
  const t = text2.trim();
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
function digestCode(text2, opts = {}) {
  const head = opts.head ?? 10, tail = opts.tail ?? 5, maxDefs = opts.maxDefs ?? 80;
  const lines = text2.replace(/\r\n/g, "\n").split("\n");
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
function digestProse(text2, opts = {}) {
  const head = opts.head ?? 25, tail = opts.tail ?? 10;
  const lines = text2.replace(/\r\n/g, "\n").split("\n");
  const n = lines.length;
  if (n <= head + tail + 5) {
    if (text2.length > 4e3) {
      const h = text2.slice(0, 1500), t = text2.slice(-600);
      return `[nyquest digest: prose, ${n} lines / ${text2.length} chars; first 1,500 and last 600 chars verbatim]
${h}
... [${text2.length - 2100} chars omitted] ...
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

// src/digest/index.ts
function digestFor(cls, text2) {
  switch (cls) {
    case "log":
      return digestLog(text2);
    case "data":
      return digestData(text2);
    case "code":
      return digestCode(text2);
    case "prose":
      return digestProse(text2);
  }
}
function makeDigest(text2, tool, command, forced) {
  const cls = forced ?? classify(text2, tool, command);
  const digest = digestFor(cls, text2);
  return { cls, digest, lines: text2.split("\n").length };
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

// src/version.ts
var VERSION = true ? "0.5.0" : "dev";

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
function redact(text2) {
  return text2.replace(RE_SECRET, "[REDACTED]");
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
      headers: { "content-type": "application/json", authorization: `Bearer ${cfg.apiKey}`, "user-agent": `nyquest-claude-mcp/${VERSION}` },
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
async function condense(text2, kind, cfg = loadConfig(), timeoutMs = 15e3) {
  const r = await post(cfg, "/v1/plugin/condense", { text: redact(text2), kind }, timeoutMs);
  if (!r || typeof r.digest !== "string" || !r.digest.trim()) return void 0;
  return r;
}
async function ask(text2, question, cfg = loadConfig(), timeoutMs = 2e4) {
  const r = await post(cfg, "/v1/plugin/ask", { text: redact(text2), question }, timeoutMs);
  if (!r || typeof r.answer !== "string" || !r.answer.trim()) return void 0;
  return r;
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
async function accountSavings(cfg = loadConfig(), days = 30) {
  if (!fullMode(cfg)) return void 0;
  const base = (cfg.apiBase || process.env.NYQUEST_API_BASE || DEFAULT_BASE).replace(/\/$/, "");
  try {
    const r = await fetch(`${base}/user/plugin/savings?days=${days}`, { headers: { authorization: `Bearer ${cfg.apiKey}` }, signal: AbortSignal.timeout(8e3) });
    if (!r.ok) return void 0;
    return await r.json();
  } catch {
    return void 0;
  }
}

// src/mcp.ts
function sessionId() {
  return process.env.CLAUDE_SESSION_ID || process.env.CLAUDE_CODE_SESSION_ID || latestSession() || "mcp";
}
var MAX_RETURN = 6e4;
function text(s) {
  return { content: [{ type: "text", text: s }] };
}
function parseRange(r, n) {
  const m = r.trim().match(/^(\d+)\s*(?:-\s*(\d+))?$/);
  if (!m) return void 0;
  const a = Math.max(1, parseInt(m[1], 10));
  const b = m[2] ? Math.min(n, parseInt(m[2], 10)) : Math.min(n, a + 199);
  return a <= b ? [a, b] : void 0;
}
var TOOLS = [];
function reg(name, cfg, handler) {
  TOOLS.push({ name, description: cfg.description, inputSchema: cfg.inputSchema, handler });
}
reg(
  "recall",
  {
    description: 'Retrieve exact text from a tool result that Nyquest parked (ids look like nyq:7f3a9c). Use lines="a-b" for a line range, grep="pattern" (regex) with optional context, or omit both for the first 200 lines. Prefer this over re-running the command.',
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Parked id, e.g. nyq:7f3a9c" },
        lines: { type: "string", description: 'Line range like "120-180" or a single line "57"' },
        grep: { type: "string", description: "Regular expression to search for (case-insensitive)" },
        context: { type: "integer", minimum: 0, maximum: 20, description: "Context lines around grep matches (default 2)" },
        max_matches: { type: "integer", minimum: 1, maximum: 500, description: "Cap on grep matches (default 100)" },
        ask: { type: "string", description: "Full mode only: a question answered over the whole parked output by a Nyquest-routed model. Sends the parked text (secrets redacted) to the Nyquest platform, so it is allowed for web and agent results only; Bash, PowerShell, file and MCP output stays local unless the user opted the tool in." }
      },
      required: ["id"]
    }
  },
  async ({ id, lines, grep, context, max_matches, ask: ask2 }) => {
    const loc = locate(id, sessionId());
    if (!loc) return text(`No parked output with id ${id}. Use list_parked to see what is available.`);
    const body = readParked(loc);
    const all = body.split("\n");
    bumpRecall(loc);
    let out;
    let mode;
    if (ask2) {
      mode = "ask";
      const cfg = loadConfig();
      if (!fullMode(cfg)) {
        out = `recall(ask=...) needs Nyquest full mode: set an API key with configure(apiKey="nq-v1-...") (free, from app.nyquest.ai). Meanwhile use lines= or grep=. The output has ${all.length} lines.`;
      } else if (!remoteEligible(loc.entry.tool, cfg)) {
        out = `recall(ask=...) is not available for output parked from ${loc.entry.tool}: that text stays on this machine. Use lines= or grep= (the output has ${all.length} lines), or opt the tool in with configure(remoteTool="${loc.entry.tool}", remoteEnabled=true).`;
      } else {
        const r = await ask(body, ask2, cfg);
        out = r ? `${id} (${all.length} lines), answered by Nyquest (${r.model}, ${r.ms} ms; ~${fmt(r.original_tokens)} tokens read, ~${fmt(r.answer_tokens)} returned):
${r.answer}` : `Nyquest ask is unavailable right now (network, cap, or provider). Use recall(id="${id}", grep="...") or lines= instead. The output has ${all.length} lines.`;
      }
    } else if (grep) {
      mode = "grep";
      let re;
      try {
        re = new RegExp(grep, "i");
      } catch {
        return text(`Invalid regex: ${grep}`);
      }
      const ctx = context ?? 2, cap = max_matches ?? 100;
      const keep = /* @__PURE__ */ new Set();
      let matches = 0;
      for (let i = 0; i < all.length && matches < cap; i++) {
        if (re.test(all[i])) {
          matches++;
          for (let j = Math.max(0, i - ctx); j <= Math.min(all.length - 1, i + ctx); j++) keep.add(j);
        }
      }
      if (!matches) out = `No lines match /${grep}/i in ${id} (${all.length} lines).`;
      else {
        const parts = [`${matches} match(es) for /${grep}/i in ${id} (${all.length} lines), ${ctx} lines of context:`];
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
      const range = lines ? parseRange(lines, all.length) : [1, Math.min(all.length, 200)];
      if (!range) return text(`Bad line range "${lines}". The output has ${all.length} lines.`);
      const [a, b] = range;
      out = `${id} lines ${a}-${b} of ${all.length}:
` + all.slice(a - 1, b).map((l, i) => `${a + i}: ${l}`).join("\n");
    }
    if (out.length > MAX_RETURN) out = out.slice(0, MAX_RETURN) + `
... [truncated at ${MAX_RETURN} chars; narrow the range or pattern]`;
    recordRecall(loc.entry.session, { id: loc.entry.id, mode, chars: out.length });
    return text(out);
  }
);
reg(
  "list_parked",
  { description: "List tool results Nyquest has parked in this session (id, tool, class, size, recalls).", inputSchema: { type: "object", properties: {} } },
  async () => {
    const entries = listSession(sessionId());
    if (!entries.length) return text("Nothing parked in this session yet.");
    const rows = entries.map((e) => `${e.id}  ${e.tool.padEnd(12)} ${e.cls.padEnd(5)} ${fmt(e.lines).padStart(7)} lines ~${fmt(estimateTokens(e.chars)).padStart(7)} tok  recalls=${e.recalls}  ${e.command ? e.command.slice(0, 60) : ""}`);
    return text(rows.join("\n"));
  }
);
reg(
  "digest_file",
  {
    description: "Read a large file you do not intend to edit and get a compact digest (log/data/code/prose) with the full text parked for recall. Use the Read tool instead when you will edit the file.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Absolute or cwd-relative file path" },
        kind: { type: "string", enum: ["auto", "log", "data", "code", "prose"], description: "Force a digest style (default auto)" }
      },
      required: ["path"]
    }
  },
  async ({ path: p, kind }) => {
    const abs = path5.resolve(p);
    let body;
    try {
      body = fs4.readFileSync(abs, "utf8");
    } catch (e) {
      return text(`Cannot read ${abs}: ${e.message}`);
    }
    if (body.length > 5e6) return text(`File is ${fmt(body.length)} bytes; too large to digest. Use recall-style tools on a slice instead.`);
    const forced = kind && kind !== "auto" ? kind : void 0;
    const { cls, digest, lines } = makeDigest(body, "digest_file", "cat " + abs, forced);
    if (digest.length >= body.length * 0.85) return text(body);
    const entry = park(sessionId(), body, { tool: "digest_file", command: abs, cls, digestChars: digest.length });
    const out = digest + "\n" + footer(entry.id, lines, body.length, cls);
    recordPark(sessionId(), { id: entry.id, tool: "digest_file", cls, chars: body.length, digestChars: out.length });
    return text(out);
  }
);
function htmlToText(html) {
  return html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr)\b[^>]*>/gi, "\n").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/[ \t]+/g, " ").replace(/\n\s*\n\s*\n+/g, "\n\n").trim();
}
reg(
  "digest_url",
  {
    description: "Fetch a web page and get a compact digest (Nyquest semantic condensation in full mode, head/tail locally) with the full text parked for recall. Optionally ask a question and get only the answer. In full mode the page text (secrets redacted) is sent to the Nyquest platform.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", pattern: "^https?://", description: "an http(s) URL" },
        question: { type: "string", description: "Full mode: answer this question from the page instead of returning a digest" }
      },
      required: ["url"]
    }
  },
  async ({ url, question }) => {
    let raw;
    try {
      const r = await fetch(url, { headers: { "user-agent": `nyquest-claude-mcp/${VERSION}`, accept: "text/html,text/plain,application/json;q=0.9,*/*;q=0.5" }, signal: AbortSignal.timeout(15e3), redirect: "follow" });
      if (!r.ok) return text(`Fetch failed: HTTP ${r.status} for ${url}`);
      const ct = r.headers.get("content-type") || "";
      const bodyText = await r.text();
      raw = /html/i.test(ct) ? htmlToText(bodyText) : bodyText;
    } catch (e) {
      return text(`Fetch failed for ${url}: ${e.message}`);
    }
    if (!raw.trim()) return text(`No text content at ${url}`);
    if (raw.length > 4e5) raw = raw.slice(0, 4e5) + "\n... [truncated at 400,000 chars]";
    const cfg = loadConfig();
    const entry = park(sessionId(), raw, { tool: "digest_url", command: url, cls: "prose", digestChars: 0 });
    if (question && fullMode(cfg)) {
      const r = await ask(raw, question, cfg);
      if (r) {
        recordPark(sessionId(), { id: entry.id, tool: "digest_url", cls: "prose", chars: raw.length, digestChars: r.answer.length });
        return text(`${url} \u2192 parked as ${entry.id} (${fmt(raw.split("\n").length)} lines). Answer (${r.model}):
${r.answer}`);
      }
    }
    let digest;
    let method = "local";
    if (fullMode(cfg)) {
      const r = await condense(raw, "prose", cfg);
      if (r && r.smaller) {
        digest = `[nyquest digest: web page, condensed by Nyquest (${r.model}); ~${fmt(r.original_tokens)} \u2192 ~${fmt(r.condensed_tokens)} tokens. Model-written summary; recall for exact text]
` + r.digest;
        method = "condense";
      }
    }
    if (!digest) digest = makeDigest(raw, "digest_url", url, "prose").digest;
    const out = digest + "\n" + footer(entry.id, raw.split("\n").length, raw.length, "prose", method);
    recordPark(sessionId(), { id: entry.id, tool: "digest_url", cls: "prose", chars: raw.length, digestChars: out.length });
    return text(out);
  }
);
reg(
  "savings",
  { description: "Show what Nyquest has kept out of the context this session: parked results, recalls, estimated tokens saved.", inputSchema: { type: "object", properties: {} } },
  async () => {
    const cfg = loadConfig();
    const s = summarize(loadLedger(sessionId()));
    const size = storeSize();
    const byTool = Object.entries(s.byTool).map(([t, v]) => `  ${t}: ${v.parks} parked, ~${fmt(estimateTokens(v.chars))} tokens`).join("\n");
    const lines = [
      `Nyquest context manager ${VERSION} \u2014 ${fullMode(cfg) ? "full" : "local"} mode, level ${cfg.level}, enabled=${cfg.enabled}`,
      `Parked: ${s.parks} results (~${fmt(estimateTokens(s.charsParked))} tokens) replaced by digests (~${fmt(estimateTokens(s.charsDigest))} tokens).`,
      `Recalls: ${s.recalls} (~${fmt(estimateTokens(s.charsRecalled))} tokens brought back).`,
      `Estimated tokens kept out of the context: ~${fmt(s.tokensSavedOnce)} once, and ~${fmt(s.tokensSavedPerTurn)} avoided on every later turn. Estimates use ${3.9} chars/token; real numbers come from /cost.`,
      byTool ? "By tool:\n" + byTool : "",
      `Store: ${size.sessions} sessions, ${fmt(Math.round(size.bytes / 1024))} KB under ${nyquestHome()}.`
    ];
    if (fullMode(cfg)) {
      const a = await accountSavings(cfg, 30);
      lines.push(a ? `Nyquest account (30 days, all your machines): ${fmt(Number(a.parks || 0))} results parked (~${fmt(Number(a.park_tokens_kept_out || 0))} tokens kept out), ${a.condense_calls} condensations, ${a.ask_calls} asks (~${fmt(Number(a.tokens_kept_out))} tokens kept out); total ~${fmt(Number(a.total_tokens_kept_out ?? a.tokens_kept_out))} tokens. See app.nyquest.ai/savings. Daily platform cap ${a.daily_cap}.` : "Nyquest account savings: unavailable right now.");
    }
    return text(lines.filter(Boolean).join("\n"));
  }
);
reg(
  "configure",
  {
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
        apiKey: { type: "string", description: "Nyquest API key (nq-v1-...) to enable full mode; empty string removes it" }
      }
    }
  },
  async ({ level, enabled, showSavings, tool, toolEnabled, remoteTool, remoteEnabled, apiKey }) => {
    const cfg = loadConfig();
    if (level !== void 0) {
      cfg.level = clamp01(level);
      cfg.levelUpdatedAt = (/* @__PURE__ */ new Date()).toISOString();
    }
    if (enabled !== void 0) cfg.enabled = enabled;
    if (showSavings !== void 0) cfg.showSavings = showSavings;
    if (tool) cfg.tools[tool] = toolEnabled ?? true;
    if (remoteTool) cfg.remoteTools[remoteTool] = remoteEnabled ?? true;
    if (apiKey !== void 0) {
      if (apiKey) cfg.apiKey = apiKey;
      else delete cfg.apiKey;
    }
    saveConfig(cfg);
    let synced = "";
    if (level !== void 0 && fullMode(cfg)) {
      const r = await putSettings(cfg.level, cfg);
      synced = r ? " Level saved to your Nyquest account too." : " (Could not reach Nyquest to sync the level; it will sync at the next session start.)";
    }
    return text(`Nyquest: enabled=${cfg.enabled}, level=${cfg.level} (park results over ~${fmt(estimateTokens(thresholdFor(cfg.level)))} tokens), showSavings=${cfg.showSavings}, mode=${fullMode(cfg) ? "full" : "local"}, tool overrides=${JSON.stringify(cfg.tools)}, remote overrides=${JSON.stringify(cfg.remoteTools)}. Hook changes apply to the next tool call.${synced}`);
  }
);
serve({ name: "nyquest", version: VERSION }, TOOLS);
