#!/usr/bin/env bash
# Authenticated smoke for the plugin endpoints. Needs a Nyquest API key:
#   NYQUEST_API_KEY=nq-v1-... bash nyquest-claude-mcp/deploy/phase2-smoke.sh
# Costs a fraction of a cent on the platform key (two small optimizer-model calls).
set -euo pipefail
: "${NYQUEST_API_KEY:?set NYQUEST_API_KEY=nq-v1-...}"
BASE="${NYQUEST_API_BASE:-https://api.nyquest.ai}"
H=(-H "authorization: Bearer $NYQUEST_API_KEY" -H "content-type: application/json")

TEXT=$(cat <<'EOF'
Release notes for Widget 4.2 (published 2026-09-10). This release focuses on stability and a handful of long-requested features. First, the export pipeline now retries transient S3 failures up to three times with exponential backoff starting at 200 ms. Second, the CLI gained a --dry-run flag for the migrate command, which prints the SQL it would execute without touching the database. Third, we fixed a regression from 4.1.3 where the scheduler could double-fire a job if the host clock jumped backwards by more than one second. Known issues: on Windows, paths containing non-ASCII characters still fail in the archive step (tracked as WID-1187). Upgrade notes: run `widget migrate --dry-run` before `widget migrate`; the new config key `export.retries` defaults to 3. Thanks to the 14 community contributors who reported issues this cycle.
EOF
)

echo "== condense"
curl -s -m 60 "${H[@]}" -X POST "$BASE/v1/plugin/condense" \
  -d "$(node -e 'process.stdout.write(JSON.stringify({text:process.argv[1],kind:"prose"}))' "$TEXT")" | node -e '
let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d);console.log(JSON.stringify({original_tokens:j.original_tokens,condensed_tokens:j.condensed_tokens,smaller:j.smaller,model:j.model,ms:j.ms,error:j.error}));console.log("--- digest ---");console.log(j.digest||"(none)");});'

echo; echo "== ask"
curl -s -m 60 "${H[@]}" -X POST "$BASE/v1/plugin/ask" \
  -d "$(node -e 'process.stdout.write(JSON.stringify({text:process.argv[1],question:"What is the default value of export.retries and which ticket tracks the Windows path bug?"}))' "$TEXT")" | node -e '
let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d);console.log(JSON.stringify({original_tokens:j.original_tokens,answer_tokens:j.answer_tokens,model:j.model,ms:j.ms,error:j.error}));console.log("--- answer ---");console.log(j.answer||"(none)");});'

echo; echo "== account savings"
curl -s -m 20 -H "authorization: Bearer $NYQUEST_API_KEY" "$BASE/user/plugin/savings?days=1"; echo
