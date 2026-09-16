---
name: level
description: Set the Nyquest context-manager slider (0 = off, 0.5 default, 1 = most aggressive). Use when the user runs /nyquest:level or asks to change how aggressively tool results are parked.
user-invocable: true
arguments: [value]
---

Call the Nyquest `configure` tool with `level` set to the requested value (a number
between 0 and 1). If no value was given, call `configure` with no arguments to show
the current settings and explain the scale:

- 0: off
- 0.3: only huge results (over ~4,000 tokens), deterministic digests
- 0.5 (default): results over ~1,500 tokens; logs, data and prose; code listings untouched
- 0.8: results over ~750 tokens, code listings parked with a definition index
- 1.0: results over ~500 tokens, everything eligible

At every level a park must save at least `minSavingTokens` (default 300) after paying for
the digest and the parking note, and targeted reads (grep, sed -n, head, tail) under 8 KB
are never parked.

Report the resulting setting in one line. If the user asks about the API key or full mode
instead, that is `/nyquest:setup`.
