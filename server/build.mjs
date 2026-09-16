import { build } from "esbuild";
import { readFileSync } from "node:fs";

// One version source: server/package.json (kept equal to .claude-plugin/plugin.json by
// scripts/check-version.mjs). Injected as __NYQUEST_VERSION__, read by src/version.ts.
const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

const common = {
  bundle: true,
  platform: "node",
  target: "node18",
  format: "cjs",
  sourcemap: false,
  logLevel: "info",
  define: { __NYQUEST_VERSION__: JSON.stringify(pkg.version) },
};

await Promise.all([
  build({ ...common, entryPoints: ["src/hook.ts"], outfile: "dist/hook.js" }),
  build({ ...common, entryPoints: ["src/mcp.ts"], outfile: "dist/mcp.js" }),
  build({ ...common, entryPoints: ["src/lib.ts"], outfile: "dist/lib.js" }),
]);
