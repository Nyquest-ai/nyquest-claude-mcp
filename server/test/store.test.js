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

// Retention sweeps the whole store, so each of these tests gets a store of its own and can
// then assert exact counts. nyquestHome() reads NYQUEST_HOME on every call.
function inOwnStore(body) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "nyquest-retention-"));
  process.env.NYQUEST_HOME = home;
  try { body(home); } finally { process.env.NYQUEST_HOME = TMP; }
}

test("retention expires entries inside a session that is still in use, and sweeps payloads whose metadata is gone", () => {
  inOwnStore((home) => {
    const session = "retention-live";
    const dir = path.join(home, "ctx", session);
    fs.mkdirSync(dir, { recursive: true });
    const stale = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const write = (base, created, text) => {
      fs.writeFileSync(path.join(dir, base + ".txt"), text);
      if (created) fs.writeFileSync(path.join(dir, base + ".json"), JSON.stringify({ id: "nyq:" + base, session, tool: "Bash", cls: "log", chars: text.length, lines: 1, digestChars: 10, created, recalls: 0 }));
    };
    write("aaaaaa", stale, logLines(1, 20));                      // expired, metadata intact
    write("bbbbbb", new Date().toISOString(), logLines(2, 20));   // current
    write("cccccc", null, logLines(3, 20));                       // 0.3.0 era: payload, no metadata
    write("dddddd", null, logLines(4, 20));                       // a park whose metadata is still being written
    const aged = (Date.now() - 30 * 86_400_000) / 1000;
    fs.utimesSync(path.join(dir, "cccccc.txt"), aged, aged);
    // The directory itself is fresh, which is all the old implementation ever looked at.
    assert.equal(lib.purgeOld(7), 2, "the stale entry and the stale orphan go");
    assert.deepEqual(fs.readdirSync(dir).sort(), ["bbbbbb.json", "bbbbbb.txt", "dddddd.txt"],
      "current entries survive, and so does an in-flight park");
    assert.equal(lib.listSession(session).length, 1);
    assert.equal(lib.purgeOld(7), 0, "a second sweep finds nothing left to do");
  });
});

test("retention thins a legacy index.json session entry by entry and removes the directory once empty", () => {
  inOwnStore((home) => {
    const session = "retention-legacy";
    const dir = path.join(home, "ctx", session);
    fs.mkdirSync(dir, { recursive: true });
    const entry = (base, created) => ({ id: "nyq:" + base, session, tool: "Bash", cls: "log", chars: 7, lines: 1, digestChars: 7, created, recalls: 0 });
    const stale = new Date(Date.now() - 30 * 86_400_000).toISOString();
    fs.writeFileSync(path.join(dir, "eeeeee.txt"), "old one");
    fs.writeFileSync(path.join(dir, "ffffff.txt"), "new one");
    fs.writeFileSync(path.join(dir, "index.json"), JSON.stringify([entry("eeeeee", stale), entry("ffffff", new Date().toISOString())]));
    assert.equal(lib.purgeOld(7), 1, "only the stale legacy entry goes");
    assert.equal(lib.listSession(session).length, 1, "the surviving legacy entry is still listed");
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, "index.json"), "utf8")).map((e) => e.id), ["nyq:ffffff"],
      "the legacy index no longer advertises a payload that is gone");
    assert.equal(lib.purgeOld(0), 1, "a zero retention expires the rest");
    assert.equal(fs.existsSync(dir), false, "an emptied session directory is removed");
  });
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
