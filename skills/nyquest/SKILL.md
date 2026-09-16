---
name: nyquest
description: How to work with tool results that Nyquest has parked (ids like nyq:7f3a9c). Use when a tool result contains "[nyquest digest" or "parked as nyq:", when you need exact lines from earlier command output, or when reading a large file you will not edit.
user-invocable: false
---

Nyquest keeps large tool results out of your context. When a result was parked you see a
digest (head, every error/warning line, counts, tail) and a footer naming the parked id.

Rules:

1. A log digest keeps every error and warning line, every summary line (test counts, timings),
   and the first and last lines verbatim; data and code digests keep the head, the tail and
   the shape (columns, definitions). If such a digest answers the question, answer from it
   directly; do not recall just to double-check. A digest marked "condensed by Nyquest" is a
   model-written summary: values, counts and exact wording may be missing, so recall before
   quoting a specific number, name or path from it.
2. When a specific detail you need is absent, call the `recall` tool instead of re-running:
   - `recall(id="nyq:7f3a9c", grep="TypeError|failed", context=3)` to find something
   - `recall(id="nyq:7f3a9c", lines="120-180")` for an exact range
   Recall is cheaper than re-running and it works even after context compaction.
3. Never edit a file from a digest. Read the file with the Read tool before Edit.
4. For a large file you only need to understand, not change, prefer
   `digest_file(path)` over Read. It returns a digest and parks the full text.
5. `list_parked` shows everything parked in this session. `savings` shows what has been
   kept out of the context. `configure(level=...)` moves the 0..1 slider.
6. Make the savings visible. Some clients (the Claude desktop app) do not show hook messages
   to the user, so when one or more results were parked during your turn, end your reply
   with a single short line, for example:
   `Nyquest: kept ~4,100 tokens out of context this turn (2 results parked).`
   Sum the "kept out of context" figures from the parking notes you received. Skip the line
   when nothing was parked, and never add more than one line per reply.
