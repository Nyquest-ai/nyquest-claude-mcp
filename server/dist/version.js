"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.VERSION = void 0;
// The plugin version, read at runtime from server/package.json, which sits one directory above
// both src/ and dist/. `npm run check-version` (also run by `prebuild` and CI) keeps package.json
// equal to .claude-plugin/plugin.json, so every user-agent and serverInfo string agrees with the
// manifest. Falls back to "dev" when the file cannot be read.
const fs = require("node:fs");
const path = require("node:path");
function readVersion() {
    try {
        const v = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8")).version;
        return typeof v === "string" && v ? v : "dev";
    }
    catch {
        return "dev";
    }
}
exports.VERSION = readVersion();
