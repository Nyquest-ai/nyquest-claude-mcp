// The API key: where it comes from, which source wins, and where it may be written.
//
// Since 0.6.0 the key is the plugin's sensitive `api_key` option, which Claude Code keeps in
// the OS credential store and hands to hooks (and, through .mcp.json, to the MCP server) as
// CLAUDE_PLUGIN_OPTION_API_KEY. A key saved in ~/.nyquest/config.json by configure(apiKey=...)
// still works when the option is empty. NYQUEST_API_KEY is no longer read at all.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const http = require("node:http");
const { spawn } = require("node:child_process");

const lib = require("../dist/lib.js");
const HOOK = path.join(__dirname, "..", "dist", "hook.js");
const MCP = path.join(__dirname, "..", "dist", "mcp.js");

// Assembled at runtime so no credential-shaped literal sits in the repository.
const fakeKey = (tag) => ["nq", "v1", tag, "0".repeat(24)].join("-");
const OPTION_KEY = fakeKey("option");
const FILE_KEY = fakeKey("file");

function setEnv(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

/** A fresh NYQUEST_HOME, optionally with a saved key, plus the given option and ambient env key. */
function withKeys({ file, option, ambient }, body) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "nyquest-key-"));
  if (file !== undefined) fs.writeFileSync(path.join(home, "config.json"), JSON.stringify({ level: 0.5, apiKey: file }));
  const saved = [process.env.NYQUEST_HOME, process.env.CLAUDE_PLUGIN_OPTION_API_KEY, process.env.NYQUEST_API_KEY];
  setEnv("NYQUEST_HOME", home);
  setEnv("CLAUDE_PLUGIN_OPTION_API_KEY", option);
  setEnv("NYQUEST_API_KEY", ambient);
  try {
    return body(home);
  } finally {
    setEnv("NYQUEST_HOME", saved[0]);
    setEnv("CLAUDE_PLUGIN_OPTION_API_KEY", saved[1]);
    setEnv("NYQUEST_API_KEY", saved[2]);
  }
}
const configFile = (home) => fs.readFileSync(path.join(home, "config.json"), "utf8");

/** A fake platform that records the bearer token of every request and serves `settings`. */
async function fakePlatform(settings) {
  const seen = [];
  const server = http.createServer((req, res) => {
    seen.push({ method: req.method, url: req.url, auth: req.headers.authorization });
    req.resume();
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      if (req.url.startsWith("/user/plugin/settings") && req.method === "GET") res.end(JSON.stringify(settings));
      else res.end("{}");
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { seen, base: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }) };
}

function run(file, args, input, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [file, ...args], { env: { ...process.env, NYQUEST_API_KEY: "", ...env }, stdio: ["pipe", "pipe", "pipe"] });
    let out = "", err = "";
    child.stdout.on("data", (c) => (out += c));
    child.stderr.on("data", (c) => (err += c));
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve(out) : reject(new Error(`exited ${code}: ${err}`))));
    child.stdin.end(input);
  });
}

test("the plugin option wins over a saved key", () => {
  withKeys({ file: FILE_KEY, option: OPTION_KEY }, () => {
    const cfg = lib.loadConfig();
    assert.equal(cfg.apiKey, OPTION_KEY);
    assert.equal(cfg.apiKeySource, "plugin");
    assert.equal(cfg.fileApiKey, FILE_KEY);
    assert.ok(lib.fullMode(cfg));
    assert.equal(lib.keySource(cfg), "key from the plugin configuration");
  });
});

test("an empty or unsubstituted option falls back to the saved key", () => {
  // An option left empty arrives as "". A client too old to substitute ${user_config.api_key}
  // in .mcp.json passes the placeholder through verbatim.
  for (const option of [undefined, "", "   ", "${user_config.api_key}"]) {
    withKeys({ file: FILE_KEY, option }, () => {
      const cfg = lib.loadConfig();
      assert.equal(cfg.apiKey, FILE_KEY, `option ${JSON.stringify(option)}`);
      assert.equal(cfg.apiKeySource, "file");
      assert.equal(lib.keySource(cfg), "key from ~/.nyquest/config.json");
    });
  }
});

test("NYQUEST_API_KEY in the environment is not read", () => {
  // The plugin directory holds a plugin that takes a credential already in the user's
  // environment and sends it to a server; the key is asked for through userConfig instead.
  withKeys({ ambient: fakeKey("ambient") }, () => {
    const cfg = lib.loadConfig();
    assert.equal(cfg.apiKey, undefined);
    assert.equal(lib.fullMode(cfg), false);
    assert.equal(lib.keySource(cfg), "no API key");
  });
});

test("saving the config writes back only the saved key, never the option's", () => {
  withKeys({ file: FILE_KEY, option: OPTION_KEY }, (home) => {
    const cfg = lib.loadConfig();
    cfg.level = 0.8;
    lib.saveConfig(cfg);
    const saved = JSON.parse(configFile(home));
    assert.equal(saved.level, 0.8);
    assert.equal(saved.apiKey, FILE_KEY);
    assert.ok(!configFile(home).includes(OPTION_KEY), "the option's key reached config.json");
    assert.ok(!("apiKeySource" in saved) && !("fileApiKey" in saved), "runtime-only fields were written");
  });
  withKeys({ option: OPTION_KEY }, (home) => {
    const cfg = lib.loadConfig();
    cfg.level = 0.3;
    lib.saveConfig(cfg);
    assert.ok(!("apiKey" in JSON.parse(configFile(home))), "nothing was saved, so nothing is written");
  });
});

test("the website winning a level sync does not copy the option's key into config.json", async () => {
  // The real leak path before 0.6.0: session start pulls a newer level from the website and
  // saves the config, which wrote whatever key was in effect, NYQUEST_API_KEY included.
  const platform = await fakePlatform({ level: 0.9, updated_at: new Date().toISOString() });
  try {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "nyquest-key-"));
    const out = JSON.parse(await run(HOOK, ["--session-start"], JSON.stringify({ session_id: "key-sync", hook_event_name: "SessionStart" }), {
      NYQUEST_HOME: home,
      CLAUDE_CONFIG_DIR: fs.mkdtempSync(path.join(os.tmpdir(), "nyquest-ccfg-")),
      CLAUDE_PLUGIN_OPTION_API_KEY: OPTION_KEY,
      NYQUEST_API_BASE: platform.base,
    }));
    assert.match(out.systemMessage, /full mode, level 0\.9/, out.systemMessage);
    assert.ok(platform.seen.some((h) => h.auth === `Bearer ${OPTION_KEY}`), "the hook authenticated with the plugin option");
    assert.equal(JSON.parse(configFile(home)).level, 0.9, "the pulled level was saved");
    assert.ok(!configFile(home).includes(OPTION_KEY), "the option's key reached config.json");
  } finally {
    await platform.close();
  }
});

test("a key that is not a Nyquest key is named at session start, never printed", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "nyquest-key-"));
  const out = JSON.parse(await run(HOOK, ["--session-start"], JSON.stringify({ session_id: "key-bad", hook_event_name: "SessionStart" }), {
    NYQUEST_HOME: home,
    CLAUDE_CONFIG_DIR: fs.mkdtempSync(path.join(os.tmpdir(), "nyquest-ccfg-")),
    CLAUDE_PLUGIN_OPTION_API_KEY: "sk-not-a-nyquest-key-1234",
  }));
  assert.match(out.systemMessage, /local mode/);
  assert.ok(out.systemMessage.includes("Full mode is off: the API key in the plugin configuration does not start with nq-v1-"), out.systemMessage);
  assert.ok(!out.systemMessage.includes("sk-not-a-nyquest-key"), "the key itself was printed");
});

test("configure changes only the saved key, and says when the option overrides it", async () => {
  const platform = await fakePlatform({ level: null, updated_at: null });
  try {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "nyquest-key-"));
    fs.writeFileSync(path.join(home, "config.json"), JSON.stringify({ level: 0.5, apiKey: FILE_KEY }));
    const NEW_FILE_KEY = fakeKey("newfile");
    const frames = [
      { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "configure", arguments: { level: 0.6 } } },
      { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "configure", arguments: { apiKey: NEW_FILE_KEY } } },
      { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "savings", arguments: {} } },
    ];
    const out = await run(MCP, [], frames.map((f) => JSON.stringify(f)).join("\n") + "\n", {
      NYQUEST_HOME: home,
      CLAUDE_SESSION_ID: "key-configure",
      CLAUDE_PLUGIN_OPTION_API_KEY: OPTION_KEY,
      NYQUEST_API_BASE: platform.base,
    });
    const reply = (id) => JSON.parse(out.split("\n").find((l) => l.includes(`"id":${id}`))).result.content[0].text;

    assert.match(reply(1), /mode=full \(key from the plugin configuration\)/, reply(1));
    assert.doesNotMatch(reply(1), /takes precedence/, "nothing to say when the key was not touched");
    assert.match(reply(2), /takes precedence over the saved one; change or clear it with \/plugin configure nyquest/, reply(2));
    assert.match(reply(3), /full mode \(key from the plugin configuration\)/, reply(3));
    for (const id of [1, 2, 3]) assert.ok(!reply(id).includes(OPTION_KEY) && !reply(id).includes(NEW_FILE_KEY), `reply ${id} printed a key`);

    const saved = JSON.parse(configFile(home));
    assert.equal(saved.level, 0.6);
    assert.equal(saved.apiKey, NEW_FILE_KEY, "configure(apiKey) replaced the saved key");
    assert.ok(!configFile(home).includes(OPTION_KEY), "the option's key reached config.json");
    assert.ok(platform.seen.some((h) => h.method === "PUT" && h.auth === `Bearer ${OPTION_KEY}`), "the level sync used the option's key");
  } finally {
    await platform.close();
  }
});
