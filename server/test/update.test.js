// Update nudge: version comparison, the on-disk marketplace catalog, and the platform's
// latest_version, surfaced in the session-start line. No real network anywhere.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const http = require("node:http");
const { spawn } = require("node:child_process");

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "nyquest-update-"));
process.env.NYQUEST_HOME = TMP;
const lib = require("../dist/lib.js");
const HOOK = path.join(__dirname, "..", "dist", "hook.js");
const KEY = "nq-v1-test-key-0000000000000000000000";

/** A fake CLAUDE_CONFIG_DIR with this plugin installed from a marketplace whose catalog says `catalogVersion`. */
function fakeConfigDir(catalogVersion, opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nyquest-ccfg-"));
  const mpDir = path.join(dir, "plugins", "marketplaces", "nyquest");
  fs.mkdirSync(path.join(mpDir, ".claude-plugin"), { recursive: true });
  fs.writeFileSync(path.join(dir, "plugins", "installed_plugins.json"), JSON.stringify({ version: 2, plugins: { "nyquest@nyquest": [{ scope: "user", version: lib.VERSION }] } }));
  fs.writeFileSync(path.join(dir, "plugins", "known_marketplaces.json"), JSON.stringify({ nyquest: { source: { source: "github", repo: "Nyquest-ai/nyquest-claude-marketplace" }, installLocation: mpDir } }));
  const entry = { name: "nyquest", version: catalogVersion, source: { source: "url", url: opts.url || "https://github.com/Nyquest-ai/nyquest-claude-mcp.git" } };
  fs.writeFileSync(path.join(mpDir, ".claude-plugin", "marketplace.json"), JSON.stringify({ name: "nyquest", plugins: [entry] }));
  return dir;
}

function runSessionStart(env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [HOOK, "--session-start"], { env: { ...process.env, NYQUEST_HOME: TMP, ...env }, stdio: ["pipe", "pipe", "pipe"] });
    let out = "", err = "";
    child.stdout.on("data", (c) => (out += c));
    child.stderr.on("data", (c) => (err += c));
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve(JSON.parse(out)) : reject(new Error(`hook exited ${code}: ${err}`))));
    child.stdin.end(JSON.stringify({ session_id: "update-session", hook_event_name: "SessionStart" }));
  });
}

test("compareVersions orders numerically and ignores pre-release tags", () => {
  assert.equal(lib.compareVersions("0.4.0", "0.3.0"), 1);
  assert.equal(lib.compareVersions("0.3.0", "0.4.0"), -1);
  assert.equal(lib.compareVersions("0.4.0", "0.4.0"), 0);
  assert.equal(lib.compareVersions("0.10.0", "0.9.9"), 1);
  assert.equal(lib.compareVersions("1.0.0", "0.99.99"), 1);
  assert.equal(lib.compareVersions("v0.4.1", "0.4.0"), 1);
  assert.equal(lib.compareVersions("0.4.0-rc.1", "0.4.0"), 0);
  assert.equal(lib.compareVersions("0.4", "0.4.0"), 0);
});

test("updateAvailable reads the on-disk catalog and ignores unrelated plugins of the same name", () => {
  const u = lib.updateAvailable({ configDir: fakeConfigDir("9.9.9") });
  assert.ok(u, "newer catalog entry found");
  assert.equal(u.latest, "9.9.9");
  assert.equal(u.installed, lib.VERSION);
  assert.equal(u.marketplace, "nyquest");
  assert.equal(u.command, "/plugin update nyquest@nyquest");
  assert.equal(lib.updateAvailable({ configDir: fakeConfigDir(lib.VERSION) }), undefined, "same version: nothing to say");
  assert.equal(lib.updateAvailable({ configDir: fakeConfigDir("0.0.1") }), undefined, "older catalog: nothing to say");
  assert.equal(lib.updateAvailable({ configDir: fakeConfigDir("9.9.9", { url: "https://github.com/someone-else/nyquest-thing.git" }) }), undefined, "different plugin called nyquest is ignored");
  assert.equal(lib.updateAvailable({ configDir: fs.mkdtempSync(path.join(os.tmpdir(), "nyquest-empty-")) }), undefined, "not installed from a marketplace: nothing to say");
});

test("updateAvailable prefers a newer version the platform reports and says to refresh the catalog first", () => {
  const r = lib.updateAvailable({ configDir: fakeConfigDir(lib.VERSION), remoteLatest: "9.9.10" });
  assert.ok(r);
  assert.equal(r.latest, "9.9.10");
  assert.equal(r.command, "/plugin marketplace update nyquest, then /plugin update nyquest@nyquest");
  const c = lib.updateAvailable({ configDir: fakeConfigDir("9.9.11"), remoteLatest: "9.9.10" });
  assert.equal(c.latest, "9.9.11", "the newest known version wins");
  assert.equal(lib.updateAvailable({ configDir: fakeConfigDir(lib.VERSION), remoteLatest: lib.VERSION }), undefined);
  assert.equal(lib.updateAvailable({ configDir: fakeConfigDir(lib.VERSION), remoteLatest: null }), undefined);
});

test("session start mentions a newer version from the on-disk catalog, with no network", async () => {
  const out = await runSessionStart({ CLAUDE_CONFIG_DIR: fakeConfigDir("9.9.9") });
  assert.ok(out.systemMessage.includes(`Nyquest 9.9.9 is available (this session runs ${lib.VERSION})`), out.systemMessage);
  assert.ok(out.systemMessage.includes("/plugin update nyquest@nyquest, then /reload-plugins"), out.systemMessage);
  assert.equal(out.hookSpecificOutput.additionalContext, out.systemMessage);
  const same = await runSessionStart({ CLAUDE_CONFIG_DIR: fakeConfigDir(lib.VERSION) });
  assert.ok(!same.systemMessage.includes("is available"), same.systemMessage);
});

test("full mode: the platform's latest_version reaches the session line", async () => {
  const hits = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      hits.push({ method: req.method, url: req.url });
      res.setHeader("content-type", "application/json");
      if (req.url.startsWith("/user/plugin/settings") && req.method === "GET") res.end(JSON.stringify({ level: null, updated_at: null, latest_version: "9.9.10" }));
      else if (req.url.startsWith("/user/plugin/settings")) res.end(JSON.stringify({ level: 0.5, updated_at: new Date().toISOString() }));
      else { res.statusCode = 404; res.end("{}"); }
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try {
    const out = await runSessionStart({ CLAUDE_CONFIG_DIR: fakeConfigDir(lib.VERSION), NYQUEST_API_KEY: KEY, NYQUEST_API_BASE: `http://127.0.0.1:${server.address().port}` });
    assert.ok(out.systemMessage.startsWith("Nyquest context manager: full mode"), out.systemMessage);
    assert.ok(out.systemMessage.includes("Nyquest 9.9.10 is available"), out.systemMessage);
    assert.ok(out.systemMessage.includes("/plugin marketplace update nyquest"), out.systemMessage);
    assert.ok(hits.some((h) => h.method === "GET" && h.url.startsWith("/user/plugin/settings")));
  } finally {
    await new Promise((r) => server.close(r));
  }
});
