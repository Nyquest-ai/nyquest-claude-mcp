// Deterministic digest for command / log output. Keeps exact lines only:
// head, every error/warning line with one line of context, summary lines, tail.

// Error-like lines: generic words, error class names (TypeError, AssertionError),
// test-runner failure markers (✕ ✗ × FAIL ●) and assertion diff lines.
export const ERR_RE = /\b(error|errors|fail|failed|failure|failures|warn|warning|exception|panic|panicked|denied|fatal|traceback|unhandled|cannot|could not|not found|ENOENT|EACCES|timed? ?out)\b|\b[A-Z][A-Za-z]*Error\b|^\s*(✕|✗|×|●|FAIL\b)|^\s*(Expected|Received|expected|got|actual)\s*:/im;
const SUMMARY_RE = /\b\d+\s+(passed|failed|skipped|errors?|warnings?|tests?|packages?|files?|vulnerabilit(y|ies)|added|removed|changed|insertions?|deletions?)\b|\btest result:|\bTests?:\s|\bSuites?:\s|\bSnapshots?:\s|^\s*(Time|Duration|Elapsed|Total|Ran)\b.*:|\bexit(ed)? (code|status)\b|\bDone in\b|\bFinished\b|\bcompiled\b|\bBuild (succeeded|failed|completed)\b/i;

export interface LogDigestOptions {
  head?: number;
  tail?: number;
  maxErr?: number;
  context?: number;
}

const ANSI = /\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*\x07/g;

export function digestLog(text: string, opts: LogDigestOptions = {}): string {
  // Head 25 (was 15): a listing folded into the same command as a log must survive in the head.
  const head = opts.head ?? 25, tail = opts.tail ?? 15, maxErr = opts.maxErr ?? 80, ctx = opts.context ?? 1;
  const lines = text.replace(/\r\n/g, "\n").replace(ANSI, "").split("\n");
  const n = lines.length;
  if (n <= head + tail + 5) return lines.join("\n");

  const keep = new Set<number>();
  for (let i = 0; i < Math.min(head, n); i++) keep.add(i);
  // Tail: the last `tail` NON-EMPTY lines, so trailing blank padding cannot push
  // the summary ("Tests: 3 failed ...") out of the window.
  let kept = 0;
  for (let i = n - 1; i >= 0 && kept < tail; i--) {
    keep.add(i);
    if (lines[i].trim() !== "") kept++;
  }

  // Repeated error lines (same text once timestamps/pids are stripped) are shown
  // once with a count, so every DISTINCT error survives even in noisy service logs.
  let errCount = 0, warnCount = 0, distinct = 0;
  const firstSeen = new Map<string, number>();
  const repeats = new Map<number, number>();
  const summaries: number[] = [];
  for (let i = 0; i < n; i++) {
    const l = lines[i];
    if (l.trim() === "") continue;
    if (ERR_RE.test(l)) {
      if (/\bwarn/i.test(l)) warnCount++; else errCount++;
      const key = errKey(l);
      const first = firstSeen.get(key);
      if (first === undefined) {
        if (distinct < maxErr) {
          firstSeen.set(key, i);
          distinct++;
          // One line before, two after: test failures put "expected"/"got" and the
          // first stack frame on the lines that follow the marker.
          for (let j = Math.max(0, i - ctx); j <= Math.min(n - 1, i + ctx + 1); j++) keep.add(j);
        }
      } else {
        repeats.set(first, (repeats.get(first) || 1) + 1);
      }
    }
    if (SUMMARY_RE.test(l) && summaries.length < 12) summaries.push(i);
  }
  for (const i of summaries) keep.add(i);

  const totalErr = errCount + warnCount;
  const out: string[] = [];
  out.push(`[nyquest digest: log output, ${n} lines; ${errCount} error-like and ${warnCount} warning-like lines, ${distinct} distinct${distinct >= maxErr && distinct < totalErr ? ` (first ${maxErr} distinct shown)` : " (all shown, repeats counted)"}; head and tail kept verbatim]`);
  let last = -1;
  const sorted = [...keep].sort((a, b) => a - b);
  for (const i of sorted) {
    if (i !== last + 1 && last >= 0) out.push(`... [${i - last - 1} lines omitted: ${last + 2}-${i}] ...`);
    const rep = repeats.get(i);
    out.push(rep ? `${lines[i]}  [x${rep} similar]` : lines[i]);
    last = i;
  }
  return out.join("\n");
}

const TS_RE = /\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?|\b\d{2}:\d{2}:\d{2}(\.\d+)?\b|\[\s*\d+(\.\d+)?\]|\bpid[= ]\d+\b|#\d+\b/gi;

/** Identity of an error line ignoring timestamps, pids, counters and whitespace. */
export function errKey(l: string): string {
  return l.replace(TS_RE, "").replace(/\s+/g, " ").trim().toLowerCase();
}
