// Summarise real-use data from ~/.nyquest: parks, recalls, skips, learned response
// shapes, and per-tool volumes. Counts only; never prints parked content.
// Usage: node scripts/dogfood-report.js [days]
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const home = process.env.NYQUEST_HOME || path.join(os.homedir(), ".nyquest");
const days = Number(process.argv[2] || 30);
const since = Date.now() - days * 86_400_000;
const est = (c) => Math.round(c / 3.9);

function readJson(p, fallback) { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return fallback; } }

const sessDir = path.join(home, "sessions");
const ledgers = fs.existsSync(sessDir) ? fs.readdirSync(sessDir).filter((f) => f.endsWith(".json")).map((f) => readJson(path.join(sessDir, f), null)).filter(Boolean) : [];
const recent = ledgers.filter((l) => new Date(l.started).getTime() >= since);

let parks = 0, recalls = 0, charsParked = 0, charsDigest = 0, charsRecalled = 0;
const byTool = {}, byCls = {}, skipped = {}, recallModes = {}, recallsPerPark = [];
for (const l of recent) {
  const recallCount = {};
  for (const r of l.recalls) { recalls++; charsRecalled += r.chars; recallModes[r.mode] = (recallModes[r.mode] || 0) + 1; recallCount[r.id] = (recallCount[r.id] || 0) + 1; }
  for (const p of l.parks) {
    parks++; charsParked += p.chars; charsDigest += p.digestChars;
    (byTool[p.tool] = byTool[p.tool] || { n: 0, chars: 0 }).n++; byTool[p.tool].chars += p.chars;
    (byCls[p.cls] = byCls[p.cls] || { n: 0, chars: 0, digest: 0 }).n++; byCls[p.cls].chars += p.chars; byCls[p.cls].digest += p.digestChars;
    recallsPerPark.push(recallCount[p.id] || 0);
  }
  for (const [k, v] of Object.entries(l.skipped || {})) skipped[k] = (skipped[k] || 0) + v;
}
const neverRecalled = recallsPerPark.filter((n) => n === 0).length;

console.log(`Nyquest dogfood report — last ${days} days, ${recent.length} sessions with a ledger (of ${ledgers.length})`);
console.log(`Parked: ${parks} results, ~${est(charsParked).toLocaleString()} tokens -> digests ~${est(charsDigest).toLocaleString()} tokens (${parks ? (100 * (1 - charsDigest / charsParked)).toFixed(0) : 0}% smaller)`);
console.log(`Recalls: ${recalls} (~${est(charsRecalled).toLocaleString()} tokens brought back); modes ${JSON.stringify(recallModes)}; parks never recalled: ${neverRecalled}/${parks}`);
console.log("By tool:"); for (const [t, v] of Object.entries(byTool).sort((a, b) => b[1].chars - a[1].chars)) console.log(`  ${t.padEnd(24)} ${String(v.n).padStart(4)} parks  ~${est(v.chars).toLocaleString()} tokens`);
console.log("By class:"); for (const [c, v] of Object.entries(byCls)) console.log(`  ${c.padEnd(8)} ${String(v.n).padStart(4)} parks  ${v.chars} -> ${v.digest} chars (${(100 * v.digest / Math.max(1, v.chars)).toFixed(0)}%)`);
console.log("Skipped:", JSON.stringify(skipped));
console.log("Learned response shapes:", JSON.stringify(readJson(path.join(home, "shapes.json"), {}), null, 1));
const log = path.join(home, "hook.log");
if (fs.existsSync(log)) {
  const lines = fs.readFileSync(log, "utf8").trim().split("\n");
  const errors = lines.filter((l) => / error /.test(l)).length;
  const methods = {};
  for (const l of lines) { const m = l.match(/method=(\w+)/); if (m) methods[m[1]] = (methods[m[1]] || 0) + 1; }
  console.log(`hook.log: ${lines.length} lines, ${errors} errors, methods ${JSON.stringify(methods)}`);
}
