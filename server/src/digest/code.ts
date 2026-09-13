// Deterministic digest for source listings fetched through Bash (cat, sed, grep).
// Only used at slider level >= 0.8. Keeps head, a definition index with line
// numbers, and tail. Exact lines come back through recall(lines=...).

const DEF_RE = /^\s*(export\s+)?(default\s+)?(pub(\([^)]*\))?\s+)?(async\s+)?(unsafe\s+)?(function\*?|class|def|fn|impl|struct|enum|trait|interface|type|mod|module|namespace|const|let|var|static|public|private|protected|func|object)\b\s*([A-Za-z_$][\w$]*)?/;
const LINE_NO = /^\s*(\d+)[\t:→| ]/;

export function digestCode(text: string, opts: { head?: number; tail?: number; maxDefs?: number } = {}): string {
  const head = opts.head ?? 10, tail = opts.tail ?? 5, maxDefs = opts.maxDefs ?? 80;
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const n = lines.length;
  if (n <= head + tail + 10) return lines.join("\n");

  const defs: string[] = [];
  for (let i = 0; i < n && defs.length < maxDefs; i++) {
    const l = lines[i];
    // Respect existing line numbers from cat -n / grep -n; otherwise use ours.
    const m = l.match(LINE_NO);
    const body = m ? l.slice(m[0].length) : l;
    const d = body.match(DEF_RE);
    if (d && d[7] && !/^\s*(return|const|let|var)\s*$/.test(body)) {
      const no = m ? m[1] : String(i + 1);
      defs.push(`${no}: ${body.trim().slice(0, 110)}`);
    }
  }
  const out = [
    `[nyquest digest: code listing, ${n} lines; head/tail verbatim, ${defs.length} definitions indexed. Use recall(lines="a-b") for exact text before editing]`,
    ...lines.slice(0, head),
    `... [${n - head - tail} lines omitted: ${head + 1}-${n - tail}] ...`,
  ];
  if (defs.length) out.push("definitions:", ...defs);
  out.push(...lines.slice(n - tail));
  return out.join("\n");
}
