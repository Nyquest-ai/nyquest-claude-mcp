---
name: setup
description: Walk the user through turning on Nyquest full mode with a free API key, or show the current mode and level. Use when the user runs /nyquest:setup, asks how to enable full mode, or asks how to set or remove their Nyquest API key.
user-invocable: true
arguments: [key]
---

Goal: get the user into the mode they want with as few steps as possible.

1. Call the Nyquest `savings` tool to learn the current mode (local or full) and level.
2. If the user passed a key as the argument (it starts with `nq-v1-`), call
   `configure(apiKey=<key>)` and confirm the resulting mode in one line. Stop.
3. If the user wants full mode and gave no key, explain in three short lines:
   - Full mode is free. It adds platform condensation for prose results, `recall(ask=...)`
     answers, `digest_url`, and account savings totals. Local mode keeps working without it.
   - Get a key at https://app.nyquest.ai (sign in, create an API key; it starts with `nq-v1-`).
   - Then run `/nyquest:setup nq-v1-...`, or say "set my Nyquest API key to ...". Anyone who
     would rather keep the key out of the chat can set `NYQUEST_API_KEY` in the environment or
     add `"apiKey"` to `~/.nyquest/config.json` instead.
4. If the user wants to leave full mode, call `configure(apiKey="")` and confirm.
5. Never print a stored key back to the user; refer to it as "your key".
