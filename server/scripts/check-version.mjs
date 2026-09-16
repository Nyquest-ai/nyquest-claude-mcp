// Fails when server/package.json and .claude-plugin/plugin.json disagree on the version.
// Runs before every build (npm prebuild) and in CI, so the bundle's injected version,
// the MCP serverInfo, the user-agent strings and the manifest can never drift apart.
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const plugin = JSON.parse(readFileSync(new URL("../../.claude-plugin/plugin.json", import.meta.url), "utf8"));

if (pkg.version !== plugin.version) {
  console.error(`version mismatch: server/package.json is ${pkg.version}, .claude-plugin/plugin.json is ${plugin.version}`);
  process.exit(1);
}
console.log(`version ${pkg.version}: package.json and plugin.json agree`);
