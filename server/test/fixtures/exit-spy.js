// Preloaded with `node -r` by protocol.test.js. Records any call to process.exit() on stderr.
//
// The MCP server must end by letting its event loop empty, never by process.exit(): on Windows,
// process.exit() while fetch is still tearing down a TLS socket aborts the process with a libuv
// assertion. That crash needs a real HTTPS peer to reproduce (6 of 6 runs against the live
// platform, 0 of 18 against local plain-HTTP servers), and a local HTTPS server would need a
// private key committed to the repository. So the test checks the rule instead of the symptom:
// on the normal path, nothing calls process.exit() at all.
const real = process.exit.bind(process);
process.exit = (code) => {
  process.stderr.write(`[exit-spy] process.exit(${code}) called\n`);
  return real(code);
};
