// Minimal MCP server over stdio: newline-delimited JSON-RPC, tools only.
//
// WHY THIS EXISTS
//
// This replaces @modelcontextprotocol/sdk. The SDK is 785 KiB once esbuild bundles it and
// zod into dist/mcp.js, and that single file was the plugin's whole third-party surface.
// The Claude plugin directory holds any non-image file over 256 KiB for a human reviewer,
// holds code the security scan cannot read ("commit readable source instead of compiled,
// packed, or minified code"), and holds every other way of shipping a Node dependency too:
// a committed lockfile install, a package install from a hook script, or bundling the
// package's code in. There is no dependency route that avoids a hold, so the only move that
// removes the problem rather than relocating it is to have no dependencies.
//
// What the protocol actually asks of a tools-only server is small. From the MCP spec's stdio
// transport: messages are JSON-RPC, UTF-8, newline-delimited, must not contain embedded
// newlines, the server must not write anything to stdout that is not a valid MCP message,
// and stderr is free for logging. That is this file.
//
// Nothing here is Nyquest-specific; the tool list and handlers live in mcp.ts.

/** JSON Schema subset this server validates. Anything it does not understand, it ignores. */
export interface Schema {
  type: "object";
  properties?: Record<string, Prop>;
  required?: string[];
}
interface Prop {
  type: "string" | "number" | "integer" | "boolean";
  description?: string;
  enum?: string[];
  minimum?: number;
  maximum?: number;
  pattern?: string;
}

export interface ToolResult {
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: Schema;
  handler: (args: Record<string, any>) => Promise<ToolResult>;
}

/// Revisions this server answers to, newest first. The spec allows echoing the client's
/// revision only when the server supports it; otherwise the server answers with one it does.
/// An earlier draft echoed anything, which is wrong in the case that matters most: Claude Code
/// 2.1.295 (the desktop app's client) asks for a revision newer than 2025-11-25, and echoing it
/// would claim a protocol era this server does not implement. Observed 2026-10-14 in the
/// client's own MCP log: against the SDK server this replaced, that client negotiated
/// "2025-11-25" and connected, labelling it the "legacy" era. Answering the same way keeps the
/// outcome identical to the server that was already working. The tools surface used here
/// (tools/list, tools/call, text content) is the same across all four.
export const SUPPORTED_PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];

/** The one message shape that may reach stdout. */
function send(msg: unknown): void {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

/** Human-readable argument check, so a bad call answers rather than throwing. */
export function checkArgs(schema: Schema, args: Record<string, unknown>): string | undefined {
  for (const name of schema.required || []) {
    if (args[name] === undefined || args[name] === null) return `missing required argument "${name}"`;
  }
  for (const [name, spec] of Object.entries(schema.properties || {})) {
    const v = args[name];
    if (v === undefined || v === null) continue;       // absent optionals are fine
    if (spec.type === "string") {
      if (typeof v !== "string") return `"${name}" must be a string`;
      if (spec.enum && !spec.enum.includes(v)) return `"${name}" must be one of: ${spec.enum.join(", ")}`;
      if (spec.pattern && !new RegExp(spec.pattern).test(v)) return `"${name}" does not look like ${spec.description || spec.pattern}`;
    } else if (spec.type === "number" || spec.type === "integer") {
      if (typeof v !== "number" || !Number.isFinite(v)) return `"${name}" must be a number`;
      if (spec.type === "integer" && !Number.isInteger(v)) return `"${name}" must be a whole number`;
      if (spec.minimum !== undefined && v < spec.minimum) return `"${name}" must be at least ${spec.minimum}`;
      if (spec.maximum !== undefined && v > spec.maximum) return `"${name}" must be at most ${spec.maximum}`;
    } else if (spec.type === "boolean" && typeof v !== "boolean") {
      return `"${name}" must be true or false`;
    }
  }
  return undefined;                                    // unknown arguments are ignored, as before
}

/** Serve `tools` over stdio until stdin closes. */
export function serve(info: { name: string; version: string }, tools: ToolDef[]): void {
  const byName = new Map(tools.map((t) => [t.name, t]));
  const listing = tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));

  const reply = (id: unknown, result: unknown) => send({ jsonrpc: "2.0", id, result });
  const fail = (id: unknown, code: number, message: string) => send({ jsonrpc: "2.0", id, error: { code, message } });

  // A client that closes stdin still wants the reply to its last request, and the documented
  // smoke test pipes a few frames in and closes. So nothing ends the process while a handler
  // is running.
  //
  // And nothing ends it with process.exit() either. On Windows, process.exit() while fetch is
  // still closing its sockets trips a libuv assertion ("!(handle->flags & UV_HANDLE_CLOSING)",
  // src/win/async.c) and the process aborts. Seen 2026-10-14 straight after a full-mode
  // `savings` call, which is a network request, so it would have crashed at the end of most
  // full-mode sessions. Once stdin has ended its handle is closed, so after the last handler
  // settles the event loop empties and Node exits by itself, cleanly. The timer below is the
  // last resort for a handler that never settles; unref'd, so it can never be what keeps the
  // process alive, and by the time it fires nothing should still be closing.
  let pending = 0;
  let closed = false;
  function exitWhenDrained(): void {
    if (!closed || pending > 0) return;
    process.exitCode = 0;
    setTimeout(() => process.exit(0), 10_000).unref();
  }
  function handle(line: string): void {
    pending++;
    dispatch(line)
      .catch((e) => process.stderr.write(`nyquest: ${(e as Error)?.message || String(e)}\n`))
      .finally(() => {
        pending--;
        exitWhenDrained();
      });
  }

  async function dispatch(line: string): Promise<void> {
    let msg: any;
    try {
      msg = JSON.parse(line);
    } catch {
      send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } });
      return;
    }
    const id = msg?.id;
    // A notification carries no id and must never be answered, not even to refuse it.
    const isRequest = id !== undefined && id !== null;
    const method = String(msg?.method ?? "");
    const params = msg?.params ?? {};
    try {
      switch (method) {
        case "initialize": {
          const asked = params.protocolVersion;
          reply(id, {
            protocolVersion: SUPPORTED_PROTOCOL_VERSIONS.includes(asked) ? asked : SUPPORTED_PROTOCOL_VERSIONS[0],
            capabilities: { tools: { listChanged: false } },
            serverInfo: info,
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
          const args = (params.arguments ?? {}) as Record<string, any>;
          const bad = checkArgs(tool.inputSchema, args);
          // A bad argument is the model's mistake to fix, so it comes back as tool output it
          // can read, not as a protocol error it cannot see.
          const out = bad ? { content: [{ type: "text" as const, text: `nyquest: ${bad}` }], isError: true } : await tool.handler(args);
          if (isRequest) reply(id, out);
          return;
        }
        case "ping":
          if (isRequest) reply(id, {});
          return;
        default:
          // Notifications (initialized, cancelled, progress) land here and are dropped.
          if (isRequest) fail(id, -32601, `method not found: ${method}`);
      }
    } catch (e) {
      // One failing call must not take the server down with it.
      const text = `nyquest: ${(e as Error)?.message || String(e)}`;
      if (isRequest) reply(id, { content: [{ type: "text", text }], isError: true });
      else process.stderr.write(text + "\n");
    }
  }

  let buffer = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk: string) => {
    buffer += chunk;
    for (;;) {
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
