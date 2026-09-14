const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawnSync } = require("node:child_process");

// Isolate the store/config for tests.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "nyquest-test-"));
process.env.NYQUEST_HOME = TMP;

const lib = require("../dist/lib.js");

function logLines(n, errsAt = []) {
  const out = [];
  for (let i = 1; i <= n; i++) {
    out.push(errsAt.includes(i) ? `2026-09-12T10:00:${String(i % 60).padStart(2, "0")}Z ERROR worker-${i}: connection refused to 10.0.0.${i}` : `2026-09-12T10:00:00Z INFO step ${i} ok (${i * 37} ms)`);
  }
  return out.join("\n");
}

test("log digest keeps every error line, head and tail", () => {
  const text = logLines(400, [57, 213, 388]);
  const d = lib.digestLog(text);
  assert.ok(d.length < text.length * 0.3, `digest too large: ${d.length}/${text.length}`);
  for (const i of [57, 213, 388]) assert.ok(d.includes(`worker-${i}: connection refused`), `missing error ${i}`);
  assert.ok(d.includes("INFO step 1 ok"), "missing head");
  assert.ok(d.includes("INFO step 400 ok"), "missing tail");
  assert.ok(/3 error-like/.test(d), "count line");
});

test("log digest strips ANSI and CRLF", () => {
  const text = Array.from({ length: 100 }, (_, i) => `\x1b[32mINFO\x1b[0m line ${i}\r`).join("\n") + "\n\x1b[31mERROR\x1b[0m boom";
  const d = lib.digestLog(text);
  assert.ok(!d.includes("\x1b["));
  assert.ok(d.includes("ERROR boom"));
});

test("short output is returned unchanged", () => {
  const text = logLines(20);
  assert.equal(lib.digestLog(text), text);
});

test("data digest summarises a JSON array", () => {
  const arr = Array.from({ length: 500 }, (_, i) => ({ id: i, name: `item-${i}`, price: i * 1.5 }));
  const d = lib.digestData(JSON.stringify(arr, null, 2));
  assert.ok(d.includes("JSON array of 500 items"));
  assert.ok(d.includes("id:number"));
  assert.ok(d.includes('"item-0"'));
});

test("code digest indexes definitions with line numbers", () => {
  const lines = [];
  for (let i = 0; i < 300; i++) lines.push(i % 25 === 0 ? `export function handler${i}(req) {` : `  const x${i} = ${i};`);
  const d = lib.digestCode(lines.join("\n"));
  assert.ok(d.includes("definitions:"));
  assert.ok(d.includes("26: export function handler25"));
});

test("classify picks log / data / code / prose", () => {
  assert.equal(lib.classify(logLines(50), "Bash"), "log");
  assert.equal(lib.classify(JSON.stringify({ a: [1, 2, 3], b: "x" }), "Bash"), "data");
  const code = Array.from({ length: 60 }, (_, i) => (i % 3 ? `  return x${i};` : `function f${i}(a) {`)).join("\n");
  assert.equal(lib.classify(code, "Bash"), "code");
  assert.equal(lib.classify(code, "Bash", "sed -n 1,80p src/main.rs"), "code");
  const prose = Array.from({ length: 40 }, () => "The quick brown fox jumps over the lazy dog while the committee reviews the proposal in detail and considers every option carefully before deciding.").join("\n");
  assert.equal(lib.classify(prose, "WebFetch"), "prose");
});

test("thresholds follow the slider", () => {
  assert.equal(lib.thresholdFor(0), Infinity);
  assert.equal(lib.thresholdFor(0.3), 16000);
  assert.equal(lib.thresholdFor(0.5), 6000);
  assert.equal(lib.thresholdFor(0.8), 3000);
  assert.equal(lib.thresholdFor(1), 2000);
  assert.equal(lib.codeParkingEnabled(0.5), false);
  assert.equal(lib.codeParkingEnabled(0.8), true);
});

test("extract handles Bash, string, content blocks, unknown", () => {
  const b = lib.extract({ stdout: "out", stderr: "err", interrupted: false, isImage: false });
  assert.equal(b.text, "out\n[stderr]\nerr");
  assert.deepEqual(b.rebuild("D"), { stdout: "D", stderr: "", interrupted: false, isImage: false });
  assert.equal(lib.extract("plain").text, "plain");
  const blocks = lib.extract([{ type: "text", text: "a" }, { type: "text", text: "b" }]);
  assert.equal(blocks.text, "a\nb");
  assert.deepEqual(blocks.rebuild("D"), [{ type: "text", text: "D" }]);
  assert.equal(lib.extract({ weird: 1 }), undefined);
  assert.equal(lib.extract(42), undefined);
});

test("hook end-to-end: parks a large Bash result and recall finds it", () => {
  // 400 lines ≈ 24 KB: inside the window between the park threshold and the
  // ~30 KB point where Claude Code persists Bash output itself.
  const text = logLines(400, [244]);
  const input = { session_id: "test-session", hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: { command: "npm test" }, tool_response: { stdout: text, stderr: "", interrupted: false, isImage: false } };
  const r = spawnSync(process.execPath, [path.join(__dirname, "..", "dist", "hook.js")], { input: JSON.stringify(input), env: { ...process.env, NYQUEST_HOME: TMP }, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  const upd = out.hookSpecificOutput.updatedToolOutput;
  assert.equal(typeof upd.stdout, "string");
  assert.ok(upd.stdout.length < text.length * 0.3);
  assert.ok(upd.stdout.includes("worker-244: connection refused"));
  const id = upd.stdout.match(/parked as (nyq:[0-9a-f]{6})/)[1];
  assert.ok(out.hookSpecificOutput.additionalContext.includes(id));
  assert.ok(out.systemMessage && out.systemMessage.includes(id) && /tokens/.test(out.systemMessage), "user-visible savings line");
  const loc = lib.locate(id, "test-session");
  assert.ok(loc, "parked file located");
  assert.equal(lib.readParked(loc), text);
  const s = lib.summarize(lib.loadLedger("test-session"));
  assert.equal(s.parks, 1);
});

test("hook passes small results, Read, and disabled state through", () => {
  const run = (input, env = {}) => spawnSync(process.execPath, [path.join(__dirname, "..", "dist", "hook.js")], { input: JSON.stringify(input), env: { ...process.env, NYQUEST_HOME: TMP, ...env }, encoding: "utf8" });
  const small = run({ session_id: "s", hook_event_name: "PostToolUse", tool_name: "Bash", tool_response: { stdout: "hi", stderr: "" } });
  assert.equal(small.stdout, "");
  const read = run({ session_id: "s", hook_event_name: "PostToolUse", tool_name: "Read", tool_response: logLines(2000) });
  assert.equal(read.stdout, "");
  const off = run({ session_id: "s", hook_event_name: "PostToolUse", tool_name: "Bash", tool_response: { stdout: logLines(2000), stderr: "" } }, { NYQUEST_COMPRESS: "off" });
  assert.equal(off.stdout, "");
  const garbage = run("not json at all");
  assert.equal(garbage.status, 0);
  assert.equal(garbage.stdout, "");
});

test("redact strips secrets before text leaves the machine", () => {
  const s = "key sk-ant-abcdefghijklmnopqrstuvwxyz0123 and ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ1234 and password: hunter2hunter2 and nq-v1-ABCDEFGHIJKLMNOPQRSTUVWXYZ_abc plus AKIAABCDEFGHIJKLMNOP end";
  const r = lib.redact(s);
  assert.ok(!r.includes("sk-ant-abc"));
  assert.ok(!r.includes("ghp_ABC"));
  assert.ok(!r.includes("hunter2"));
  assert.ok(!r.includes("nq-v1-ABC"));
  assert.ok(!r.includes("AKIAABCDEFGHIJKLMNOP"));
  assert.ok(r.includes("[REDACTED]"));
  assert.equal(lib.redact("plain text with numbers 12345 and /a/path.txt"), "plain text with numbers 12345 and /a/path.txt");
});

test("full mode is off without an nq-v1 key", () => {
  assert.equal(lib.fullMode({ apiKey: undefined }), false);
  assert.equal(lib.fullMode({ apiKey: "garbage" }), false);
  assert.equal(lib.fullMode({ apiKey: "nq-v1-abcdef" }), true);
});

test("hook leaves outputs Claude Code already persisted alone", () => {
  const run = (input) => spawnSync(process.execPath, [path.join(__dirname, "..", "dist", "hook.js")], { input: JSON.stringify(input), env: { ...process.env, NYQUEST_HOME: TMP }, encoding: "utf8" });
  const big = logLines(1200); // > 30,000 chars: Claude Code truncates and persists this itself
  assert.ok(big.length >= 30000);
  const r = run({ session_id: "s3", hook_event_name: "PostToolUse", tool_name: "Bash", tool_response: { stdout: big.slice(0, 30000), stderr: "" } });
  assert.equal(r.stdout, "");
  const p = run({ session_id: "s3", hook_event_name: "PostToolUse", tool_name: "Bash", tool_response: { stdout: "<persisted-output>\nOutput too large (79KB). Full output saved to: x\n" + logLines(300), stderr: "" } });
  assert.equal(p.stdout, "");
});

test("classify treats markdown docs printed with cat as prose", () => {
  const md = "# Runbook\n\n## Restart\n\n" + Array.from({ length: 6 }, (_, i) => `To restart the service run the command and wait for readiness, which times out after 45 seconds; this paragraph ${i} explains the reasoning, the trade-offs the team considered, and what to watch for when it changes.`).join("\n\n") + "\n\n## Escalation\n\nPage the on-call rotation when the queue depth exceeds the limit for more than ten minutes, and record the incident.";
  assert.equal(lib.classify(md, "Bash", "cat docs/runbook.md"), "prose");
});

test("session start prints a status line", () => {
  const r = spawnSync(process.execPath, [path.join(__dirname, "..", "dist", "hook.js"), "--session-start"], { input: JSON.stringify({ session_id: "s2", hook_event_name: "SessionStart" }), env: { ...process.env, NYQUEST_HOME: TMP }, encoding: "utf8" });
  const out = JSON.parse(r.stdout);
  assert.ok(out.systemMessage.startsWith("Nyquest context manager: local mode, level 0.5"), r.stdout);
  assert.equal(out.hookSpecificOutput.hookEventName, "SessionStart");
  assert.equal(out.hookSpecificOutput.additionalContext, out.systemMessage);
  assert.ok(out.systemMessage.includes("/nyquest:setup"), "local mode hint");
});
