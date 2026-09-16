// Full-mode behaviour against a fake platform: what may leave the machine, and how
// condensed digests are labelled. Nothing here touches the network or ~/.nyquest.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const http = require("node:http");
const { spawn } = require("node:child_process");

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "nyquest-remote-"));
process.env.NYQUEST_HOME = TMP;
const lib = require("../dist/lib.js");

const HOOK = path.join(__dirname, "..", "dist", "hook.js");
const MCP = path.join(__dirname, "..", "dist", "mcp.js");
const KEY = "nq-v1-test-key-0000000000000000000000";

/** Stand-in for api.nyquest.ai that records every request it receives. */
function fakePlatform() {
  const hits = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      hits.push({ method: req.method, url: req.url, body });
      res.setHeader("content-type", "application/json");
      if (req.url === "/v1/plugin/condense") {
        res.end(JSON.stringify({ digest: "- The document covers restarts and escalation.\n- It lists a timeout and an on-call rule.", original_tokens: 2500, condensed_tokens: 25, smaller: true, method: "llm", model: "fake/model", ms: 3 }));
      } else if (req.url === "/v1/plugin/ask") {
        res.end(JSON.stringify({ answer: "forty-two", original_tokens: 2500, answer_tokens: 2, model: "fake/model", ms: 2 }));
      } else if (req.url === "/v1/plugin/events") {
        res.end(JSON.stringify({ accepted: 1 }));
      } else if (req.url.startsWith("/user/plugin/settings")) {
        res.end(JSON.stringify({ level: null, updated_at: null }));
      } else {
        res.statusCode = 404;
        res.end("{}");
      }
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({ hits, port: server.address().port, close: () => new Promise((r) => server.close(r)) }));
  });
}

// Asynchronous on purpose: a spawnSync would block this process's event loop, and the
// fake platform server lives in this process, so the hook's requests would time out.
function runHook(input, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [HOOK], { env: { ...process.env, NYQUEST_HOME: TMP, ...env }, stdio: ["pipe", "pipe", "pipe"] });
    let out = "", err = "";
    child.stdout.on("data", (c) => (out += c));
    child.stderr.on("data", (c) => (err += c));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(`hook exited ${code}: ${err}`));
      resolve(out ? JSON.parse(out) : undefined);
    });
    child.stdin.end(JSON.stringify(input));
  });
}

function fullEnv(port, extra = {}) {
  return { NYQUEST_API_KEY: KEY, NYQUEST_API_BASE: `http://127.0.0.1:${port}`, NYQUEST_LEVEL: "0.8", ...extra };
}

/** A markdown runbook: headings plus paragraphs. Classifies as prose from any tool. */
function runbook(paragraphs = 60) {
  const out = ["# Service runbook", "", "## Restart procedure", ""];
  for (let i = 0; i < paragraphs; i++) {
    out.push(`Paragraph ${i}: to restart the service run the deploy command and wait for the readiness probe, which times out after forty-five seconds; this section explains the reasoning, the trade-offs the team considered, and what to watch for when the behaviour changes.`);
    out.push("");
    if (i === 30) out.push("## Escalation", "");
  }
  out.push("Page the on-call rotation when the queue depth exceeds the limit for more than ten minutes, and record the incident.");
  return out.join("\n");
}

/** Line-oriented records with key=value fields, the shape that used to be mistaken for prose. */
function records(n = 200, prefix = "row") {
  return Array.from({ length: n }, (_, i) => `${prefix} ${i + 1}: alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima value=${((i + 1) * 7919) % 10007} status=OK`).join("\n");
}

test("remoteEligible: web and agent tools yes, shell and MCP no, overrides win", () => {
  const cfg = { ...lib.DEFAULTS, tools: {}, remoteTools: {} };
  for (const t of ["WebFetch", "WebSearch", "Agent", "Task", "digest_url"]) assert.equal(lib.remoteEligible(t, cfg), true, t);
  for (const t of ["Bash", "PowerShell", "digest_file", "mcp__foo__bar"]) assert.equal(lib.remoteEligible(t, cfg), false, t);
  assert.equal(lib.remoteEligible("Bash", { ...cfg, remoteTools: { Bash: true } }), true);
  assert.equal(lib.remoteEligible("WebFetch", { ...cfg, remoteTools: { WebFetch: false } }), false);
});

test("full mode: prose from Bash stays local and never reaches the platform", async () => {
  const p = await fakePlatform();
  try {
    const text = runbook();
    assert.ok(text.length > 6000 && text.length < 30000);
    const out = await runHook({ session_id: "remote-1", hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: { command: "cat docs/runbook.md" }, tool_response: { stdout: text, stderr: "" } }, fullEnv(p.port));
    assert.ok(out, "parked");
    const upd = out.hookSpecificOutput.updatedToolOutput.stdout;
    assert.ok(upd.includes("[nyquest digest: prose"), upd.slice(0, 200));
    assert.ok(!upd.includes("condensed by Nyquest"));
    assert.ok(!p.hits.some((h) => h.url === "/v1/plugin/condense"), "condense must not be called for Bash");
    assert.ok(p.hits.some((h) => h.url === "/v1/plugin/events"), "the counts-only report still happens");
    assert.ok(!out.hookSpecificOutput.additionalContext.includes("ask="), "ask is not advertised for Bash");
    assert.equal(lib.loadLedger("remote-1").skipped["remote-not-eligible"], 1);
  } finally {
    await p.close();
  }
});

test("full mode: prose from WebFetch is condensed and labelled as a summary", async () => {
  const p = await fakePlatform();
  try {
    const out = await runHook({ session_id: "remote-2", hook_event_name: "PostToolUse", tool_name: "WebFetch", tool_input: { url: "https://example.com/runbook" }, tool_response: runbook() }, fullEnv(p.port));
    assert.ok(out, "parked");
    const upd = out.hookSpecificOutput.updatedToolOutput;
    assert.ok(upd.includes("condensed by Nyquest (fake/model)"), upd.slice(0, 200));
    assert.ok(upd.includes("model-written summary"));
    const note = out.hookSpecificOutput.additionalContext;
    assert.ok(note.includes("summary"), note);
    assert.ok(!note.includes("preserves all"), note);
    assert.ok(note.includes("ask="), "ask is advertised for web results");
    const condense = p.hits.filter((h) => h.url === "/v1/plugin/condense");
    assert.equal(condense.length, 1);
    assert.equal(JSON.parse(condense[0].body).kind, "prose");
  } finally {
    await p.close();
  }
});

test("full mode: remoteTools opt-in lets Bash prose be condensed", async () => {
  const p = await fakePlatform();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "nyquest-optin-"));
  fs.writeFileSync(path.join(home, "config.json"), JSON.stringify({ remoteTools: { Bash: true } }));
  try {
    const out = await runHook({ session_id: "remote-3", hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: { command: "cat docs/runbook.md" }, tool_response: { stdout: runbook(), stderr: "" } }, fullEnv(p.port, { NYQUEST_HOME: home }));
    assert.ok(out.hookSpecificOutput.updatedToolOutput.stdout.includes("condensed by Nyquest"));
    assert.equal(p.hits.filter((h) => h.url === "/v1/plugin/condense").length, 1);
  } finally {
    await p.close();
  }
});

test("full mode: line-oriented records are data, digested locally with head and tail", async () => {
  const p = await fakePlatform();
  try {
    for (const [tool, prefix] of [["Bash", "row"], ["PowerShell", "psrow"]]) {
      const out = await runHook({ session_id: "remote-4", hook_event_name: "PostToolUse", tool_name: tool, tool_input: { command: "emit rows" }, tool_response: { stdout: records(200, prefix), stderr: "" } }, fullEnv(p.port));
      assert.ok(out, tool + " parked");
      const upd = out.hookSpecificOutput.updatedToolOutput.stdout;
      assert.ok(upd.includes("[nyquest digest: listing"), upd.slice(0, 120));
      assert.ok(upd.includes(`${prefix} 1:`) && upd.includes(`${prefix} 200:`), "head and tail verbatim");
      assert.ok(!upd.includes("condensed by Nyquest"));
    }
    assert.equal(p.hits.filter((h) => h.url === "/v1/plugin/condense").length, 0);
  } finally {
    await p.close();
  }
});

/** Minimal JSON-RPC client for the stdio MCP server; resolves with the tools/call response. */
function mcpCall(env, name, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [MCP], { env: { ...process.env, ...env }, stdio: ["pipe", "pipe", "pipe"] });
    let buf = "";
    const timer = setTimeout(() => { child.kill(); reject(new Error("mcp timeout; stdout so far: " + buf.slice(0, 500))); }, 15000);
    child.stdout.on("data", (c) => {
      buf += c;
      for (const line of buf.split("\n")) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.id === 2) { clearTimeout(timer); child.kill(); resolve(msg); return; }
        } catch { /* partial line, wait for more */ }
      }
    });
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "0" } } }) + "\n");
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name, arguments: args } }) + "\n");
  });
}

test("recall(ask=) refuses Bash-parked text and answers for web-parked text", async () => {
  const p = await fakePlatform();
  try {
    const session = "ask-session";
    const bash = lib.park(session, records(200), { tool: "Bash", command: "emit rows", cls: "data", digestChars: 0 });
    const web = lib.park(session, runbook(), { tool: "WebFetch", command: "https://example.com/runbook", cls: "prose", digestChars: 0 });
    const env = { NYQUEST_HOME: TMP, CLAUDE_SESSION_ID: session, ...fullEnv(p.port) };
    const r1 = await mcpCall(env, "recall", { id: bash.id, ask: "what is the value on row 97?" });
    const t1 = r1.result.content[0].text;
    assert.ok(t1.includes("not available for output parked from Bash"), t1);
    assert.equal(p.hits.filter((h) => h.url === "/v1/plugin/ask").length, 0, "no ask call for Bash text");
    const r2 = await mcpCall(env, "recall", { id: web.id, ask: "what is the answer?" });
    const t2 = r2.result.content[0].text;
    assert.ok(t2.includes("forty-two"), t2);
    assert.equal(p.hits.filter((h) => h.url === "/v1/plugin/ask").length, 1);
  } finally {
    await p.close();
  }
});
