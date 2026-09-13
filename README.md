<div align="center">

<img src="assets/logo.png" alt="Nyquest" width="160" style="border-radius:24px;margin-bottom:1rem;" />

# nyquest<span>.ai</span> for Claude Code

### Context Manager plugin: keep large tool results out of Claude's context

[![Version](https://img.shields.io/badge/version-0.2.4-4fd1c5?style=flat-square&logoColor=0a0b0e)](.claude-plugin/plugin.json)
[![Claude Code](https://img.shields.io/badge/Claude%20Code-plugin-4fd1c5?style=flat-square&logoColor=0a0b0e)](https://code.claude.com/docs/en/plugins)
[![MCP](https://img.shields.io/badge/MCP-server-4fd1c5?style=flat-square&logoColor=0a0b0e)](https://modelcontextprotocol.io)
[![Measured](https://img.shields.io/badge/cost-%E2%88%9257%25%20on%20a%2013--turn%20session-4fd1c5?style=flat-square&logoColor=0a0b0e)](#what-it-does)
[![License](https://img.shields.io/badge/License-MIT-c084fc?style=flat-square)](LICENSE)
[![Site](https://img.shields.io/badge/nyquest.ai-live-4fd1c5?style=flat-square)](https://nyquest.ai)

**Claude keeps working. The context stops growing.**

[**→ nyquest.ai**](https://nyquest.ai) &nbsp;·&nbsp; [**Install**](#install) &nbsp;·&nbsp; [**How it works**](#what-it-does) &nbsp;·&nbsp; [**Docs**](https://docs.nyquest.ai)

<br />

| 📉 −78% cache writes | 🧠 −52% final context | 💵 −57% cost | ✅ identical output | 🔒 local by default |
|:---:|:---:|:---:|:---:|:---:|

</div>

---

Claude Code re-sends the whole conversation on every turn, so a 10,000-token test log is
paid for again on every later turn. This plugin parks results like that on disk, leaves
Claude an exact-line digest (head, every error and warning line, counts, tail), and gives
Claude a `recall` tool to pull back precise slices when it needs them. Nothing is rewritten;
the original is one call away, and it survives context compaction.

Measured, not simulated (Phase 3, 2026-09-13): on a 13-turn session auditing twelve 12–14 KB
logs, the plugin cut cache writes 78%, total context read 40%, final-turn context 52%
(138k → 66k tokens) and cost 57% at list prices, with identical, fully correct output and no
recalls. On five short tasks it saved 35% with 10/10 correctness. The plugin's territory is
tool output between about 6 KB and 30 KB: below that nothing is parked, above it Claude Code
already saves the output to a file itself.

## Install

In Claude Code:

```
/plugin marketplace add Nyquest-ai/nyquest-claude-marketplace
/plugin install nyquest@nyquest
```

Or from a shell: `claude plugin marketplace add Nyquest-ai/nyquest-claude-marketplace` then
`claude plugin install nyquest@nyquest`. Requires Node 18+ on your PATH. No account needed
for local mode; see Modes below for full mode.

Development: `cd server && npm install && npm run build`, then `claude --plugin-dir /path/to/nyquest-claude-mcp`.
The built `server/dist` is committed so installs need no build step; rebuild before committing.

## What it does

| Piece | Behaviour |
|---|---|
| PostToolUse hook | For Bash, PowerShell, WebFetch, WebSearch, Agent and MCP results over the threshold, park the full text under `~/.nyquest/ctx/<session>/` and replace the result with a digest and a footer naming the id. |
| `recall` tool | `recall(id, lines="a-b")`, `recall(id, grep="regex", context=2)`. Exact text, local, no network. |
| `digest_file` tool | Digest a large file you will not edit; full text parked. |
| `list_parked`, `savings`, `configure` | Inspect the session, see estimated savings, move the slider. |
| Session start | One status line: mode, level, store size. |

Never parked: Read, Edit, Write, Grep, Glob. Read stays exact because Edit depends on it.

## The slider

`/nyquest:level 0.5` or `configure(level=0.5)`.

| Level | Parks results over | Notes |
|---|---|---|
| 0 | never | off |
| 0.3 | ~4,000 tokens | deterministic digests only |
| 0.5 | ~1,500 tokens | default; code listings untouched |
| 0.8 | ~750 tokens | code listings parked with a definition index |
| 1.0 | ~500 tokens | everything eligible |

Kill switch without uninstalling: `NYQUEST_COMPRESS=off`.

## Modes

- **Local** (default, no account): all digests are deterministic and everything stays on
  your machine.
- **Full** (Nyquest API key, free): prose results (web pages, agent reports, docs) get
  semantic condensation on the Nyquest platform, `recall(ask="...")` answers a question
  over a parked output so only the answer enters Claude's context, `digest_url` fetches
  and condenses a page, and `savings` shows your account totals. Enable with
  `configure(apiKey="nq-v1-...")` (keys are free at app.nyquest.ai). Text is redacted for
  secrets before it leaves the machine; Nyquest stores counts only, never content. Per-user
  cap of 400 platform calls a day; local mode keeps working when the cap or network is out.

  Endpoints used: `POST /v1/plugin/condense`, `POST /v1/plugin/ask`, `GET /user/plugin/savings`
  on `https://api.nyquest.ai` (override with `apiBase` in `~/.nyquest/config.json` or `NYQUEST_API_BASE`).

## Privacy

Parked text lives under `~/.nyquest/ctx` and is purged after 7 days (`retentionDays` in
`~/.nyquest/config.json`). In local mode no content leaves the machine. `~/.nyquest/shapes.json`
records only the field names of tool responses so unknown shapes can be supported.

## Development

```bash
cd server
npm run build      # esbuild -> dist/hook.js, dist/mcp.js, dist/lib.js
npm test           # node --test
npm run typecheck
node scripts/validate-corpus.js path/to/corpus.jsonl   # digest ratios and error-line retention
```
