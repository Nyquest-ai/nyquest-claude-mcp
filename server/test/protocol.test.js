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
function talk(frames) {
  return new Promise((resolve, reject) => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "nyquest-proto-"));
    const child = spawn(process.execPath, [MCP], {
      env: { ...process.env, NYQUEST_HOME: home, NYQUEST_API_KEY: "", CLAUDE_SESSION_ID: "protocol-test" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let out = "", err = "";
    child.stdout.on("data", (c) => (out += c));
    child.stderr.on("data", (c) => (err += c));
    child.on("error", reject);
    child.on("close", () => {
      const lines = out.split("\n").filter((l) => l.trim());
      const messages = lines.map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          throw new Error(`stdout carried a line that is not an MCP message: ${l.slice(0, 120)}`);
        }
      });
      resolve({ messages, stderr: err });
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
