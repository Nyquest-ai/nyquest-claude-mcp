// Build: plain `tsc` emit into dist/, one .js file per source file, comments kept.
//
// Until 0.5.0 this bundled src/{hook,mcp,lib}.ts into three files with esbuild. The Claude
// plugin directory holds code its security scan cannot read ("commit readable source instead
// of compiled, packed, or minified code"), and a bundle reads as packed. tsc only strips the
// type annotations, so each file in dist/ is its source file, line for line, and a reviewer
// can read either. The version is no longer injected: src/version.ts reads package.json.
import { rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const require = createRequire(import.meta.url);

// Start empty, so a file whose source was deleted or renamed cannot survive in dist/.
rmSync(new URL("./dist", import.meta.url), { recursive: true, force: true });
execFileSync(process.execPath, [require.resolve("typescript/bin/tsc"), "-p", "tsconfig.json"], { cwd: here, stdio: "inherit" });
