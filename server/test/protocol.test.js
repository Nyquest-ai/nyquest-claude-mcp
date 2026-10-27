// The MCP stdio protocol, against the real server process. These used to be the SDK's
// problem; the SDK bundled to 785 KiB, which the plugin directory holds for review, so the
// transport is ours now (src/stdio.ts) and so is the duty to prove it speaks MCP.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawn } = require("node:child_process");

const MCP = path.join(__dirname, "..", "dist", "mcp.js");
const { VERSION } = require("../dist/lib.js");

/** Pipe frames in, collect every stdout line, and require that each one is JSON. */
function talk(frames, env = {}, preload) {
  return new Promise((resolve, reject) => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "nyquest-proto-"));
    const child = spawn(process.execPath, preload ? ["-r", preload, MCP] : [MCP], {
      env: { ...process.env, NYQUEST_HOME: home, CLAUDE_PLUGIN_OPTION_API_KEY: "", CLAUDE_SESSION_ID: "protocol-test", ...env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let out = "", err = "";
    child.stdout.on("data", (c) => (out += c));
    child.stderr.on("data", (c) => (err += c));
    child.on("error", reject);
    child.on("close", (code) => {
      const lines = out.split("\n").filter((l) => l.trim());
      const messages = lines.map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          throw new Error(`stdout carried a line that is not an MCP message: ${l.slice(0, 120)}`);
        }
      });
      resolve({ messages, stderr: err, code });
    });
    // A string frame is written verbatim, so a test can send something that is not JSON.
    child.stdin.end(frames.map((f) => (typeof f === "string" ? f : JSON.stringify(f))).join("\n") + "\n");
  });
}
const byId = (messages, id) => messages.find((m) => m.id === id);

test("handshake, tool list, and a call that returns text", async () => {
  const { messages } = await talk([
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } } },
    { jsonrpc: "2.0", method: "notifications/initialized" },
    { jsonrpc: "2.0", id: 2, method: "tools/list" },
    { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "list_parked", arguments: {} } },
  ]);

  const init = byId(messages, 1);
  assert.equal(init.result.protocolVersion, "2025-06-18", "the client's revision is echoed");
  assert.deepEqual(init.result.serverInfo, { name: "nyquest", version: VERSION });
  assert.ok(init.result.capabilities.tools, "tools capability is declared");

  const names = byId(messages, 2).result.tools.map((t) => t.name);
  assert.deepEqual(names, ["recall", "list_parked", "digest_file", "digest_url", "savings", "configure"]);
  for (const t of byId(messages, 2).result.tools) {
    assert.ok(t.description && t.description.length > 20, `${t.name} describes itself`);
    assert.equal(t.inputSchema.type, "object", `${t.name} has an object schema`);
  }
  const recall = byId(messages, 2).result.tools.find((t) => t.name === "recall");
  assert.deepEqual(recall.inputSchema.required, ["id"]);
  assert.equal(recall.inputSchema.properties.context.maximum, 20, "bounds survive into the schema");

  const call = byId(messages, 3);
  assert.equal(call.result.content[0].type, "text");
  assert.match(call.result.content[0].text, /Nothing parked/);
  assert.equal(messages.length, 3, "a notification gets no reply");
});

test("a revision the server does not speak is answered with one it does, never echoed", async () => {
  // Claude Code 2.1.295 asks for a revision newer than 2025-11-25. Echoing it would claim a
  // protocol era this server does not implement; the spec requires answering with a
  // supported one, which is also what the SDK server did with that client.
  const { messages } = await talk([
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2099-01-01" } },
    { jsonrpc: "2.0", id: 2, method: "initialize", params: { protocolVersion: "2025-03-26" } },
    { jsonrpc: "2.0", id: 3, method: "initialize", params: {} },
  ]);
  assert.equal(byId(messages, 1).result.protocolVersion, "2025-11-25", "an unknown future revision gets the newest supported one");
  assert.equal(byId(messages, 2).result.protocolVersion, "2025-03-26", "a supported older revision is echoed");
  assert.equal(byId(messages, 3).result.protocolVersion, "2025-11-25", "no revision asked for, newest supported answered");
});

test("bad arguments answer as tool output, protocol faults answer as errors, and the server survives both", async () => {
  const { messages } = await talk([
    { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "recall", arguments: {} } },
    { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "recall", arguments: { id: "nyq:abc123", context: 99 } } },
    { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "digest_url", arguments: { url: "ftp://nope" } } },
    { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "no_such_tool", arguments: {} } },
    { jsonrpc: "2.0", id: 5, method: "resources/list" },
    { jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: 1 } },
    { jsonrpc: "2.0", id: 6, method: "ping" },
  ]);

  // The model can read tool output, so its own mistakes come back that way.
  assert.equal(byId(messages, 1).result.isError, true);
  assert.match(byId(messages, 1).result.content[0].text, /required argument "id"/);
  assert.equal(byId(messages, 2).result.isError, true);
  assert.match(byId(messages, 2).result.content[0].text, /at most 20/);
  assert.equal(byId(messages, 3).result.isError, true);
  assert.match(byId(messages, 3).result.content[0].text, /url/);

  // Protocol faults are the client's problem and go in the error channel.
  assert.equal(byId(messages, 4).error.code, -32602);
  assert.equal(byId(messages, 5).error.code, -32601);

  assert.deepEqual(byId(messages, 6).result, {}, "still answering after all of that");
  assert.equal(messages.length, 6, "the cancelled notification got no reply");
});

test("a malformed line is reported as a parse error without taking the server down", async () => {
  const { messages } = await talk([
    { jsonrpc: "2.0", id: 1, method: "ping" },
    "{ this is not json",
    { jsonrpc: "2.0", id: 2, method: "ping" },
  ]);
  const parseError = messages.find((m) => m.error && m.error.code === -32700);
  assert.ok(parseError, `expected a parse error, got ${JSON.stringify(messages)}`);
  assert.equal(parseError.id, null, "a line with no readable id reports id null");
  assert.deepEqual(byId(messages, 1).result, {});
  assert.deepEqual(byId(messages, 2).result, {}, "the frame after the bad line is still served");
  assert.equal(messages.length, 3);
});

test("the last reply is not lost when the client closes stdin immediately", async () => {
  // The documented smoke test pipes initialize plus tools/list and closes. Exiting on end
  // of input would cut off a handler still running, so the server drains first.
  const { messages } = await talk([
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } },
    { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "savings", arguments: {} } },
  ]);
  assert.equal(messages.length, 2, "both replies arrived");
  assert.match(byId(messages, 2).result.content[0].text, /Nyquest context manager/);
});

test("after a full-mode network call the server ends by draining, never by process.exit()", async () => {
  // Regression, 2026-10-14. The server used to end itself with process.exit() once stdin
  // closed and the last handler settled. On Windows that aborts the process with a libuv
  // assertion ("!(handle->flags & UV_HANDLE_CLOSING)", src/win/async.c) whenever fetch is still
  // tearing down a TLS socket, which is the state right after a full-mode `savings` call to the
  // live platform: 6 of 6 runs crashed. The reply had already gone out, so every assertion about
  // replies passed and the crash showed only in the exit code.
  //
  // That symptom needs a real HTTPS peer, which a test cannot have without committing a private
  // key. So this checks the rule behind it instead, deterministically and on every OS: a preload
  // records any process.exit() call, and on the normal path there must be none. It also proves
  // the event loop really does empty on its own after a network call; if a socket kept it alive,
  // the last-resort timer would fire process.exit() and the spy would catch that too.
  const http = require("node:http");
  const server = http.createServer((req, res) => {
    if (req.url.startsWith("/user/plugin/savings")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ parks: 3, park_tokens_kept_out: 1200, condense_calls: 1, ask_calls: 0, tokens_kept_out: 400, total_tokens_kept_out: 1600, daily_cap: 400 }));
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try {
    // Assembled at runtime so no credential-shaped literal sits in the repository.
    const key = ["nq", "v1", "protocol", "test", "0".repeat(24)].join("-");
    const { messages, stderr, code } = await talk(
      [{ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "savings", arguments: {} } }],
      { CLAUDE_PLUGIN_OPTION_API_KEY: key, NYQUEST_API_BASE: `http://127.0.0.1:${server.address().port}` },
      path.join(__dirname, "fixtures", "exit-spy.js"),
    );
    assert.match(byId(messages, 1).result.content[0].text, /Nyquest account \(30 days/, "the network path really ran");
    assert.doesNotMatch(stderr, /\[exit-spy\]/, "the server must not end itself with process.exit()");
    assert.doesNotMatch(stderr, /Assertion failed/, stderr);
    assert.equal(code, 0, `exit code ${code}; stderr: ${stderr.slice(0, 200)}`);
  } finally {
    server.closeAllConnections?.();
    await new Promise((r) => server.close(r));
  }
});
