// Local-mode digest for prose (web pages, agent reports, docs): head + tail,
// verbatim. Full mode (Phase 2) replaces this with Nyquest semantic condensation.

export function digestProse(text: string, opts: { head?: number; tail?: number } = {}): string {
  const head = opts.head ?? 25, tail = opts.tail ?? 10;
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const n = lines.length;
  if (n <= head + tail + 5) {
    // Few but long lines (paragraph-per-line web text): fall back to a character window
    // so a large prose result still parks instead of passing through untouched.
    if (text.length > 4000) {
      const h = text.slice(0, 1500), t = text.slice(-600);
      return `[nyquest digest: prose, ${n} lines / ${text.length} chars; first 1,500 and last 600 chars verbatim]\n${h}\n... [${text.length - 2100} chars omitted] ...\n${t}`;
    }
    return lines.join("\n");
  }
  // Headings are cheap structure: keep them all (capped) so Claude can target a recall.
  const headings: string[] = [];
  for (let i = head; i < n - tail && headings.length < 40; i++) {
    if (/^\s*#{1,4}\s+\S/.test(lines[i])) headings.push(`${i + 1}: ${lines[i].trim().slice(0, 100)}`);
  }
  const out = [
    `[nyquest digest: prose, ${n} lines; first ${head} and last ${tail} lines verbatim${headings.length ? `, ${headings.length} headings indexed` : ""}]`,
    ...lines.slice(0, head),
    `... [${n - head - tail} lines omitted: ${head + 1}-${n - tail}] ...`,
  ];
  if (headings.length) out.push("headings:", ...headings);
  out.push(...lines.slice(n - tail));
  return out.join("\n");
}
