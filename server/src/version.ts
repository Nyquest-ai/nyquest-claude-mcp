// The plugin version, read at runtime from server/package.json, which sits one directory above
// both src/ and dist/. `npm run check-version` (also run by `prebuild` and CI) keeps package.json
// equal to .claude-plugin/plugin.json, so every user-agent and serverInfo string agrees with the
// manifest. Falls back to "dev" when the file cannot be read.
import * as fs from "node:fs";
import * as path from "node:path";

function readVersion(): string {
  try {
    const v = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8")).version;
    return typeof v === "string" && v ? v : "dev";
  } catch {
    return "dev";
  }
}

export const VERSION: string = readVersion();
