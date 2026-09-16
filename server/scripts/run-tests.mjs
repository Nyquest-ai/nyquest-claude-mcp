// Runs every test/*.test.js through `node --test` with explicit file paths. The glob
// form (`node --test "test/**/*.test.js"`) only works on Node 21 and newer; the plugin
// supports Node 18+, and CI runs Node 20 on Windows, where the shell never expands
// globs either. Exit status is the test runner's.
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "test");
const files = readdirSync(dir).filter((f) => f.endsWith(".test.js")).sort().map((f) => path.join(dir, f));
if (!files.length) {
  console.error(`no test files found under ${dir}`);
  process.exit(1);
}
const r = spawnSync(process.execPath, ["--test", ...files], { stdio: "inherit" });
process.exit(r.status ?? 1);
