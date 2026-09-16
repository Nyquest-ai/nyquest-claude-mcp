// Store robustness: concurrent hooks parking into one session, atomic writes, legacy
// index.json sessions, and the single version string.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawn } = require("node:child_process");

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "nyquest-store-"));
process.env.NYQUEST_HOME = TMP;
const lib = require("../dist/lib.js");
const HOOK = path.join(__dirname, "..", "dist", "hook.js");

function logLines(worker, n) {
  return Array.from({ length: n }, (_, i) => `2026-09-15T10:00:${String(i % 60).padStart(2, "0")}Z INFO worker-${worker} step ${i + 1} ok (${i * 37} ms)`).join("\n");
}

function runAsync(input) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [HOOK], { env: { ...process.env, NYQUEST_HOME: TMP, CLAUDE_CONFIG_DIR: TMP }, stdio: ["pipe", "pipe", "pipe"] });
    let out = "", err = "";
    child.stdout.on("data", (c) => (out += c));
    child.stderr.on("data", (c) => (err += c));
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve(out) : reject(new Error(`hook exited ${code}: ${err}`))));
    child.stdin.end(JSON.stringify(input));
  });
}

test("16 concurrent parks per round: every park lands, is listed, locatable, and leaves no temp files", async () => {
  for (let round = 0; round < 3; round++) {
    const session = `race-${round}`;
    const outs = await Promise.all(Array.from({ length: 16 }, (_, i) => runAsync({ session_id: session, hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: { command: `tail -n 400 svc${i}.log` }, tool_response: { stdout: logLines(i, 400), stderr: "" } })));
    assert.equal(outs.filter(Boolean).length, 16, `round ${round}: every hook returned a digest`);
    const dir = path.join(TMP, "ctx", session);
    const files = fs.readdirSync(dir);
    assert.equal(files.filter((f) => f.endsWith(".txt")).length, 16, `round ${round}: parked texts`);
    assert.equal(files.filter((f) => f.endsWith(".json")).length, 16, `round ${round}: one metadata file per entry`);
    assert.equal(files.filter((f) => f.endsWith(".tmp")).length, 0, `round ${round}: no temp files left behind`);
    const listed = lib.listSession(session);
    assert.equal(listed.length, 16, `round ${round}: listed entries`);
    assert.equal(new Set(listed.map((e) => e.id)).size, 16, `round ${round}: unique ids`);
    for (const e of listed) assert.ok(lib.locate(e.id, session), `round ${round}: ${e.id} locatable`);
    assert.equal(lib.loadLedger(session).parks.length > 0, true, `round ${round}: ledger recorded parks`);
  }
});

test("legacy sessions with a shared index.json are still readable and migrate on recall", () => {
  const session = "legacy-1";
  const dir = path.join(TMP, "ctx", session);
  fs.mkdirSync(dir, { recursive: true });
  const text = logLines(9, 50);
  const entry = { id: "nyq:abc123", session, tool: "Bash", command: "old", cls: "log", chars: text.length, lines: 50, digestChars: 100, created: "2026-09-01T00:00:00.000Z", recalls: 0 };
  fs.writeFileSync(path.join(dir, "abc123.txt"), text);
  fs.writeFileSync(path.join(dir, "index.json"), JSON.stringify([entry]));
  assert.equal(lib.listSession(session).length, 1);
  const loc = lib.locate("nyq:abc123", session);
  assert.ok(loc, "legacy entry located");
  assert.equal(lib.readParked(loc), text);
  // A recall bump writes the entry's own file; the listing stays at one entry.
  lib.bumpRecall(loc);
  assert.ok(fs.existsSync(path.join(dir, "abc123.json")), "migrated to a per-entry file");
  const after = lib.listSession(session);
  assert.equal(after.length, 1);
  assert.equal(after[0].recalls, 1, "the per-entry file wins over the legacy index");
});

test("writeJsonAtomic replaces the target in place; readJsonFile tolerates missing and junk files", () => {
  const file = path.join(TMP, "atomic", "state.json");
  lib.writeJsonAtomic(file, { n: 1 });
  lib.writeJsonAtomic(file, { n: 2 }, 2);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), { n: 2 });
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ["state.json"]);
  assert.deepEqual(lib.readJsonFile(file), { n: 2 });
  assert.equal(lib.readJsonFile(path.join(TMP, "atomic", "missing.json")), undefined);
  fs.writeFileSync(path.join(TMP, "atomic", "junk.json"), "{not json");
  assert.equal(lib.readJsonFile(path.join(TMP, "atomic", "junk.json")), undefined);
});

test("the bundled version matches package.json and plugin.json", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));
  const plugin = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", ".claude-plugin", "plugin.json"), "utf8"));
  assert.equal(lib.VERSION, pkg.version);
  assert.equal(plugin.version, pkg.version);
  assert.notEqual(lib.VERSION, "dev");
});
