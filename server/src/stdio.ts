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

/// The revision this server was written against. A client's own version is echoed when it
/// sends one, because a tools-only server has nothing version-specific to negotiate.
const PROTOCOL_VERSION = "2025-06-18";

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
  // smoke test pipes a few frames in and closes. So exit when stdin has ended AND no handler
  // is still running, never mid-call.
  let pending = 0;
  let closed = false;
  function exitWhenDrained(): void {
    if (closed && pending === 0) process.exit(0);
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
            protocolVersion: typeof asked === "string" && asked ? asked : PROTOCOL_VERSION,
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
