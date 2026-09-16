// Park quality: the net-saving gate, targeted reads, fenced markdown from the web, and
// the persist limit read from Claude Code settings.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawnSync } = require("node:child_process");

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "nyquest-quality-"));
process.env.NYQUEST_HOME = TMP;
const lib = require("../dist/lib.js");
const HOOK = path.join(__dirname, "..", "dist", "hook.js");

function run(input, env = {}) {
  const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify(input), env: { ...process.env, NYQUEST_HOME: TMP, CLAUDE_CONFIG_DIR: TMP, NYQUEST_LEVEL: "0.8", ...env }, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout ? JSON.parse(r.stdout) : undefined;
}

function bash(session, command, stdout) {
  return { session_id: session, hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: { command }, tool_response: { stdout, stderr: "", interrupted: false, isImage: false } };
}

function codeListing(lines, defEvery) {
  return Array.from({ length: lines }, (_, i) => (i % defEvery === 0 ? `export function handler${i}(request, response) {` : `  const value${i} = compute(${i}, request.body);`)).join("\n");
}

function logLines(n) {
  return Array.from({ length: n }, (_, i) => `2026-09-15T10:00:${String(i % 60).padStart(2, "0")}Z INFO step ${i + 1} ok (${i * 37} ms)`).join("\n");
}

test("net-saving gate: a short code listing whose digest barely shrinks is left alone", () => {
  const text = codeListing(70, 2); // ~3,200 chars, over the level-0.8 threshold; half the lines are definitions
  assert.ok(text.length > 3000 && text.length < 4000, String(text.length));
  const out = run(bash("q-gate", "cat src/handlers.ts", text));
  assert.equal(out, undefined, "must not park");
  assert.ok(lib.loadLedger("q-gate").skipped["saving-too-small"] >= 1);
});

test("net-saving gate: a long listing with few definitions is parked", () => {
  const text = codeListing(400, 25);
  const out = run(bash("q-gate-2", "cat src/big.ts", text));
  assert.ok(out, "parked");
  assert.ok(out.hookSpecificOutput.updatedToolOutput.stdout.includes("[nyquest digest: code listing"));
});

test("minSavingTokens is configurable", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "nyquest-minsave-"));
  fs.writeFileSync(path.join(home, "config.json"), JSON.stringify({ minSavingTokens: 5000 }));
  const out = run(bash("q-min", "npm test", logLines(400)), { NYQUEST_HOME: home });
  assert.equal(out, undefined, "a 400-line log saves well under 5,000 tokens");
  const def = run(bash("q-min-2", "npm test", logLines(400)));
  assert.ok(def, "default 300 lets the same log park");
});

test("targeted reads are never parked, even at a high level", () => {
  const text = codeListing(70, 3); // ~3,600 chars
  for (const cmd of ["sed -n 1,80p src/main.rs", "grep -n TODO src/", "cd /repo && grep -rn handler src", "tail -n 100 app.log", "cat big.log | head -50", "Select-String -Path app.log -Pattern error", "Get-Content app.log -Tail 50"]) {
    assert.equal(run(bash("q-targeted", cmd, text)), undefined, cmd);
  }
  assert.ok(lib.loadLedger("q-targeted").skipped["targeted-read"] >= 7);
  // The same excerpt without a targeted command is parked.
  assert.ok(run(bash("q-targeted-2", "cat src/main.rs", codeListing(400, 25))), "cat is parked");
  // A large search result is still parked: 8 KB is the cap for the exemption.
  const big = Array.from({ length: 300 }, (_, i) => `src/file${i}.ts:${i}: const handler${i} = () => compute(${i});`).join("\n");
  assert.ok(big.length > 8000);
  assert.ok(run(bash("q-targeted-3", "grep -rn handler src", big)), "large grep output is parked");
});

test("classify: a fetched README with a few fences is prose, a mostly fenced page is code", () => {
  const para = "This section explains how the service is configured, what each option does, and how the team decided on the defaults after reviewing the trade-offs.";
  const readme = ["# Project", "", para, "", "## Install", "", "```", "npm install thing", "```", "", para, "", "## Usage", "", para, "", "```js", "thing.run();", "```", "", para, "", para, "", para, "", para, "", "## Notes", "", para, "", para].join("\n");
  assert.equal(lib.classify(readme, "WebFetch"), "prose");
  assert.equal(lib.classify(readme, "Bash", "cat README.md"), "prose");
  const fencedPage = ["# Snippet", "```ts", ...Array.from({ length: 40 }, (_, i) => `const v${i} = ${i};`), "```"].join("\n");
  assert.equal(lib.classify(fencedPage, "WebFetch"), "code");
});

test("persistLimit follows bashOutputMaxChars, project settings win, junk is ignored", () => {
  assert.equal(lib.persistLimit(undefined), 30000);
  assert.equal(lib.persistLimit({ bashOutputMaxChars: 60000 }), 60000);
  assert.equal(lib.persistLimit({ bashOutputMaxChars: 60000 }, { bashOutputMaxChars: 90000 }), 90000);
  assert.equal(lib.persistLimit({ bashOutputMaxChars: 60000 }, undefined), 60000);
  assert.equal(lib.persistLimit({ bashOutputMaxChars: "big" }), 30000);
  assert.equal(lib.persistLimit({ bashOutputMaxChars: 10 }), 30000);
  assert.equal(lib.DEFAULT_PERSIST_LIMIT, 30000);
});

test("hook honours a raised bashOutputMaxChars from Claude Code settings", () => {
  const cfgDir = fs.mkdtempSync(path.join(os.tmpdir(), "nyquest-ccsettings-"));
  fs.writeFileSync(path.join(cfgDir, "settings.json"), JSON.stringify({ bashOutputMaxChars: 60000 }));
  const text = logLines(700); // ~34,000 chars: above the default 30 KB hand-off, below 60 KB
  assert.ok(text.length > 30000 && text.length < 60000, String(text.length));
  assert.equal(run(bash("q-persist", "npm test", text)), undefined, "default limit: left to Claude Code");
  const out = run(bash("q-persist-2", "npm test", text), { CLAUDE_CONFIG_DIR: cfgDir });
  assert.ok(out, "raised limit: parked by the plugin");
});
