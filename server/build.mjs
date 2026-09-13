import { build } from "esbuild";

const common = {
  bundle: true,
  platform: "node",
  target: "node18",
  format: "cjs",
  sourcemap: false,
  logLevel: "info",
};

await Promise.all([
  build({ ...common, entryPoints: ["src/hook.ts"], outfile: "dist/hook.js" }),
  build({ ...common, entryPoints: ["src/mcp.ts"], outfile: "dist/mcp.js" }),
  build({ ...common, entryPoints: ["src/lib.ts"], outfile: "dist/lib.js" }),
]);
