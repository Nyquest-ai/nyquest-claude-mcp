#!/usr/bin/env bash
# Phase 2 deploy for the Claude Code plugin endpoints on nyquest-prod-1.
# Run from Windows as:  ssh nyquest 'bash -s' < nyquest-claude-mcp/deploy/phase2-deploy-nyquest.sh
#
# What it does (each step is idempotent):
#   1. applies migration 063 (plugin_events table, additive, counts only)
#   2. backs up the RUNNING binary from /proc (cargo already replaced the file on disk)
#   3. restarts app-nyquest and verifies health, readiness, and the three new routes
# Rollback:  cp /root/app-nyquest.rollback-20260912-pre-plugin-api /opt/app-nyquest/target/release/app-nyquest && systemctl restart app-nyquest
set -euo pipefail
cd /opt/app-nyquest

echo "== 1. migrations 063 + 064 (idempotent)"
sudo -u postgres psql -d nyquest_prod -v ON_ERROR_STOP=1 -f migrations/063_plugin_events.sql
sudo -u postgres psql -d nyquest_prod -c "ALTER TABLE plugin_events OWNER TO nyquest;"
sudo -u postgres psql -d nyquest_prod -tAc "SELECT count(*) FROM plugin_events;" | sed 's/^/plugin_events rows: /'
sudo -u postgres psql -d nyquest_prod -v ON_ERROR_STOP=1 -f migrations/064_plugin_settings.sql
sudo -u postgres psql -d nyquest_prod -c "ALTER TABLE plugin_settings OWNER TO nyquest;"
sudo -u postgres psql -d nyquest_prod -tAc "SELECT count(*) FROM plugin_settings;" | sed 's/^/plugin_settings rows: /'

echo "== 2. backup running binary"
PID=$(systemctl show -p MainPID --value app-nyquest)
if [ ! -f /root/app-nyquest.rollback-20260912-pre-plugin-api ]; then
  cp "/proc/$PID/exe" /root/app-nyquest.rollback-20260912-pre-plugin-api
fi
ls -la /root/app-nyquest.rollback-20260912-pre-plugin-api
echo "old (running) sha: $(sha256sum /proc/$PID/exe | cut -c1-16)   new (on disk) sha: $(sha256sum target/release/app-nyquest | cut -c1-16)"

echo "== 3. restart"
systemctl restart app-nyquest
sleep 5
systemctl is-active app-nyquest
NEWPID=$(systemctl show -p MainPID --value app-nyquest)
echo "pid $PID -> $NEWPID, running sha: $(sha256sum /proc/$NEWPID/exe | cut -c1-16)"

echo "== 4. verify"
curl -s -m 8 localhost:8400/health; echo
curl -s -m 8 -o /dev/null -w "ready %{http_code}\n" localhost:8400/health/ready
curl -s -m 8 -o /dev/null -w "condense (no auth, expect 401) %{http_code}\n" -X POST -H "content-type: application/json" -d '{"text":"hello"}' localhost:8400/v1/plugin/condense
curl -s -m 8 -o /dev/null -w "ask      (no auth, expect 401) %{http_code}\n" -X POST -H "content-type: application/json" -d '{"text":"hello","question":"q"}' localhost:8400/v1/plugin/ask
curl -s -m 8 -o /dev/null -w "savings  (no auth, expect 401) %{http_code}\n" localhost:8400/user/plugin/savings
curl -s -m 8 -o /dev/null -w "events   (no auth, expect 401) %{http_code}\n" -X POST -H "content-type: application/json" -d '{"events":[]}' localhost:8400/v1/plugin/events
curl -s -m 8 -o /dev/null -w "settings (no auth, expect 401) %{http_code}\n" localhost:8400/user/plugin/settings
curl -s -m 8 -o /dev/null -w "public condense (expect 401) %{http_code}\n" -X POST -H "content-type: application/json" -d '{"text":"hello"}' https://api.nyquest.ai/v1/plugin/condense
journalctl -u app-nyquest --since "1 min ago" --no-pager | grep -iE "error|panic" | tail -5 || true
echo "== done"
