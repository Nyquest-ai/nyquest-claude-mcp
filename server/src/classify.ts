// Content classification for tool results: code | data | log | prose.
// Deterministic and cheap; runs on the hook hot path.

export type ContentClass = "code" | "data" | "log" | "prose";

// Markdown (.md) is deliberately absent: docs printed with cat are prose, not source.
const CODE_CMD = /\b(sed\s+-n|cat\s+(-n\s+)?[^|;]*\.(rs|js|jsx|ts|tsx|py|go|java|rb|php|c|cc|cpp|h|hpp|cs|swift|kt|html|css|scss|toml|json|ya?ml|sh|sql)\b|git\s+(diff|show)\b|grep\s+-[a-zA-Z]*n)/;
const CODE_LINE = /^\s*(import\s|export\s|from\s+\S+\s+import|#include|use\s+\S+;|package\s|(pub\s+)?(async\s+)?fn\s|def\s|class\s|function\s|const\s|let\s|var\s|return\b|if\s*\(|for\s*\(|while\s*\(|\}\s*else|#\[|@\w+|<\/?[a-zA-Z][^>]*>)/;
const LOG_LINE = /(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}|\b(INFO|WARN|WARNING|ERROR|DEBUG|TRACE|FATAL)\b|^\s*(npm|yarn|pnpm|pip|cargo|go|make|gcc|rustc|tsc|jest|pytest|PASS|FAIL|ok|\[\d+\/\d+\])\b|^\s*(===|---|>>>|\$ |# ))/;

export function classify(text: string, tool: string, command?: string): ContentClass {
  const t = text.trim();
  if (!t) return "log";

  // Structured payloads first: JSON / arrays.
  if ((t.startsWith("{") && t.endsWith("}")) || (t.startsWith("[") && t.endsWith("]"))) {
    try {
      JSON.parse(t);
      return "data";
    } catch {
      /* fall through */
    }
  }

  const lines = t.split("\n");
  const nonEmpty = lines.filter((l) => l.trim() !== "");
  const n = Math.max(1, nonEmpty.length);
  const sample = nonEmpty.slice(0, 400);

  // Command hint: viewing source through Bash.
  if (command && CODE_CMD.test(command)) return "code";
  if (t.includes("```")) return "code";

  let codeLines = 0, logLines = 0, sepLines = 0, longProse = 0, headings = 0, sentences = 0, totalLen = 0;
  const lens: number[] = [];
  for (const l of sample) {
    totalLen += l.length;
    lens.push(l.length);
    if (CODE_LINE.test(l)) codeLines++;
    if (LOG_LINE.test(l)) logLines++;
    // Structural separators: tabs, pipes, a short key followed by : or =, CSV-like runs,
    // or two or more key=value tokens anywhere in the line (records, env dumps).
    // Commas inside sentences are not structure.
    if (
      /\t|\|/.test(l) ||
      /^\s*[\w.-]{1,40}\s*[:=]\s*\S/.test(l) ||
      /^[^,\s]{1,40}(,[^,]{0,60}){3,}$/.test(l) ||
      (l.match(/(?:^|\s)[\w.-]{1,40}=\S/g) || []).length >= 2
    ) sepLines++;
    if (l.length > 90 && (l.match(/[a-zA-Z]{3,}\s+[a-zA-Z]{3,}/g) || []).length >= 6) longProse++;
    if (/^\s*#{1,6}\s+\S/.test(l)) headings++;
    if (/[.!?]["')\]]?\s*$/.test(l)) sentences++;
  }
  const s = sample.length || 1;
  const avgLen = totalLen / s;
  // Regularity: the share of lines whose length sits within 15% of the median line.
  // Records and listings are regular; paragraphs are not.
  const sorted = [...lens].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] || 0;
  const regular = median ? lens.filter((x) => Math.abs(x - median) <= median * 0.15).length / s : 0;
  const blanks = (lines.length - nonEmpty.length) / Math.max(1, lines.length);

  if (codeLines / s >= 0.25) return "code";
  if (tool === "WebFetch" || tool === "WebSearch" || tool === "Agent" || tool === "Task") {
    return longProse / s >= 0.15 || avgLen > 60 ? "prose" : "log";
  }
  // Markdown documents and paragraph-heavy text are prose even when printed via cat.
  if (headings >= 2 && longProse / s >= 0.2) return "prose";
  if (logLines / s >= 0.3) return "log";
  // Tabular / key-value payloads (CSV, config dumps, listings).
  if (sepLines / s >= 0.8 && n >= 8) return "data";
  // Repetitive, equal-shape lines are records or a listing, never paragraphs. Calling
  // them prose would send them to a model for a summary that drops the values.
  if (regular >= 0.7 && n >= 8) return "data";
  // Prose from a shell needs paragraph evidence: sentence endings or blank-line breaks.
  // Anything else falls to the log digest, which keeps exact lines and stays local.
  if (longProse / s >= 0.3 && (sentences / s >= 0.4 || blanks >= 0.05)) return "prose";
  return "log";
}
