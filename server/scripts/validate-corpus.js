// Validate digests against a corpus of real tool results (JSONL: {kind, tool, cmd, chars, text}).
// Reports per-class digest ratio and whether every error/warn line survived.
// Usage: node scripts/validate-corpus.js corpus.jsonl [level]
const fs = require("node:fs");
const path = require("node:path");
const lib = require(path.join(__dirname, "..", "dist", "lib.js"));

const file = process.argv[2];
const level = Number(process.argv[3] || 0.5);
if (!file) { console.error("usage: validate-corpus.js corpus.jsonl [level]"); process.exit(1); }
const corpus = fs.readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l));
const threshold = lib.thresholdFor(level);
// Compare error lines by identity (timestamps/pids stripped): a repeated line shown once with a count still counts as kept.
const norm = (s) => lib.errKey(s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, ""));

const groups = {};
let eligibleChars = 0, digestChars = 0, totalChars = 0;
for (const s of corpus) {
  totalChars += s.chars;
  const tool = s.tool || s.kind || "Bash";
  if (s.text.length < threshold) continue;
  const { cls, digest } = lib.makeDigest(s.text, tool, s.cmd);
  const parked = !(cls === "code" && !lib.codeParkingEnabled(level)) && digest.length < s.text.length * 0.85;
  const errLines = s.text.split("\n").filter((l) => lib.ERR_RE.test(l) && l.trim().length < 400);
  const dn = norm(digest);
  const lostErr = parked ? errLines.filter((l) => !dn.includes(norm(l))).length : 0;
  const g = groups[cls] || (groups[cls] = { n: 0, parked: 0, chars: 0, digest: 0, errLines: 0, lostErr: 0, ratios: [] });
  g.n++; g.chars += s.text.length; g.errLines += errLines.length;
  if (parked) { g.parked++; g.digest += digest.length; g.ratios.push(digest.length / s.text.length); g.lostErr += lostErr; eligibleChars += s.text.length; digestChars += digest.length; }
}
const med = (a) => { const b = [...a].sort((x, y) => x - y); return b.length ? b[Math.floor(b.length / 2)] : 0; };
console.log(`corpus: ${corpus.length} results, ${totalChars} chars; level ${level} (threshold ${threshold} chars)`);
console.log("class   n  parked   chars->digest   median ratio   err-lines lost/total");
for (const [cls, g] of Object.entries(groups)) {
  console.log(`${cls.padEnd(6)} ${String(g.n).padStart(3)} ${String(g.parked).padStart(6)}   ${String(g.chars).padStart(8)}->${String(g.digest).padEnd(8)} ${(med(g.ratios) * 100).toFixed(1).padStart(8)}%        ${g.lostErr}/${g.errLines}`);
}
console.log(`eligible bytes parked: ${eligibleChars} -> ${digestChars} (${(100 * (1 - digestChars / Math.max(1, eligibleChars))).toFixed(1)}% smaller); share of all tool bytes parked: ${(100 * eligibleChars / totalChars).toFixed(1)}%`);
// Error-line retention below 100% (other than capped >60/sample) is a bug: list offenders.
for (const s of corpus) {
  if (s.text.length < threshold) continue;
  const { cls, digest } = lib.makeDigest(s.text, s.tool || s.kind || "Bash", s.cmd);
  if (cls === "code" && !lib.codeParkingEnabled(level)) continue;
  if (cls !== "log") continue;
  const errLines = s.text.split("\n").filter((l) => lib.ERR_RE.test(l) && l.trim().length < 400);
  const dn = norm(digest);
  const lost = errLines.filter((l) => !dn.includes(norm(l)));
  if (lost.length && errLines.length <= 60) console.log("LOST in", (s.cmd || "").slice(0, 60), "->", lost.slice(0, 2).map((l) => l.slice(0, 100)));
}
