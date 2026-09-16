# Reviewer kit

A guided evaluation of the Nyquest Context Manager plugin, written for the Claude plugin
directory review and for anyone deciding whether to install it. Everything below runs in
under fifteen minutes.

## What the plugin does

Claude Code re-sends the whole conversation on every turn. Large tool results (a test log,
a data dump, a fetched page) are paid for again on every later turn. The plugin's
PostToolUse hook parks such results on disk under `~/.nyquest/ctx/<session>/`, replaces
them with a deterministic digest (head, every error and warning line, counts, tail) and a
footer naming the parked id, and gives Claude a `recall` tool that returns exact lines or
grep matches from the parked text. Nothing is rewritten; the original is one call away.

## Setup

```
/plugin marketplace add Nyquest-ai/nyquest-claude-marketplace
/plugin install nyquest@nyquest
```

Requires Node 18+ and Claude Code 2.1.121 or newer. Start a new session; the first line
reads `Nyquest context manager: local mode, level 0.5 ...`.

Local mode needs no account and makes no network calls. For full mode, a test API key
with sample account data accompanies the directory submission; anyone else can create a
free account at https://app.nyquest.ai and run `/nyquest:setup`.

## Example 1: local park and exact recall

In a session with the plugin active, run a command that prints 200 records:

```bash
for i in $(seq 1 200); do echo "row $i: alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima value=$((i*7919 % 10007)) status=OK"; done
```

Expected: the tool result is replaced by a `listing` digest (first 25 and last 8 rows
verbatim, the rest omitted) and a footer with an id such as `nyq:156fa9`. Then ask Claude
for row 97, or call the tool directly:

```
recall(id="nyq:156fa9", lines="97-99")
```

Expected: `row 97: ... value=7611 status=OK`, `row 98: ... value=5523`, `row 99: ...
value=3435`, byte for byte. `recall(id=..., grep="^row 150:")` returns `value=7024`.
Nothing left the machine: `~/.nyquest/hook.log` shows the park with `method=local`.

## Example 2: full mode condensation of a web page

With a key configured, ask Claude to fetch a long documentation page with WebFetch.

Expected: the result is a short digest headed `condensed by Nyquest (<model>)` and labelled
a model-written summary. `recall(id=..., grep="<a phrase>")` returns exact text from the
page; `recall(id=..., ask="what does the page say about X?")` returns only the answer.

Run the same fetch through Bash (`curl -s <url>`) instead: the digest is the local
head-and-tail kind, and `hook.log` shows `method=local`. Shell output never reaches the
platform unless the user opts the tool in with `configure(remoteTool="Bash", remoteEnabled=true)`.

## Example 3: digesting a large file

```
digest_file(path="/var/log/app.log")
```

Expected: a `log output` digest that keeps every error and warning line with one line of
context, all summary lines, and the head and tail; the full file is parked for `recall`.
`list_parked` lists everything parked in the session; `savings` shows the estimated tokens
kept out of the context.

## What leaves the machine

| Mode | Tool result | Sent to Nyquest |
|---|---|---|
| Local | any | nothing |
| Full | WebFetch, WebSearch, Agent prose over the prose threshold | the text, secrets redacted, for condensation |
| Full | `recall(ask=...)` on those results, `digest_url` | the text, secrets redacted, for the answer or digest |
| Full | Bash, PowerShell, `digest_file`, MCP tools | nothing, unless opted in with `remoteTools` |
| Full | every park | counts only: tool name, content class, sizes |

Text sent to the platform is processed by third-party model providers. Nyquest keeps
counts, never content. Policies: https://nyquest.ai/privacy and https://nyquest.ai/terms.

## Verifying the claims yourself

- `cd server && npm ci && npm test` runs 32 tests: digest fidelity, the classifier, the
  hook end to end, full-mode paths against a fake platform server (no network), sixteen
  concurrent parks, redaction of twelve credential formats.
- `~/.nyquest/hook.log` records every park and skip with sizes and method, never content.
- `~/.nyquest/sessions/<session>.json` records skip reasons such as `remote-not-eligible`,
  `saving-too-small` and `targeted-read`.
- `NYQUEST_COMPRESS=off` disables the plugin without uninstalling it.

## Support

Bugs and requests: https://github.com/Nyquest-ai/nyquest-claude-mcp/issues. Anything
private: https://nyquest.ai/support.
