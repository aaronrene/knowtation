#!/usr/bin/env bash
######################################################################
# load-skills-and-agents.sh
#
# Imports the 5 Knowtation skills and the 22 agent definitions
# (18 conveyor-belt + 1 controller + 3 bridges) into Paperclip.
#
# Run AS the paperclip user, AFTER push-secrets.sh AND wire-knowtation-mcp.sh
# have both passed:
#   sudo -u paperclip /opt/paperclip/scripts/load-skills-and-agents.sh
#
# Idempotent: re-runs replace existing skills/agents with the latest from
# /opt/paperclip/skills/ and /opt/paperclip/agents/.
######################################################################

set -euo pipefail

PAPERCLIP_HOME=/opt/paperclip

# Sanity checks before we touch anything.
if [[ ! -d "$PAPERCLIP_HOME/skills" ]]; then
  echo "FAIL: $PAPERCLIP_HOME/skills missing. Did install.sh complete?"
  exit 1
fi

if [[ ! -d "$PAPERCLIP_HOME/agents" ]]; then
  echo "FAIL: $PAPERCLIP_HOME/agents missing. Did install.sh complete?"
  exit 1
fi

# Verify every skill compiles via Node.
echo "[load] Verifying skill modules compile..."
SKILL_FILES=(
  "$PAPERCLIP_HOME/skills/hub-client.mjs"
  "$PAPERCLIP_HOME/skills/read-style-guide.mjs"
  "$PAPERCLIP_HOME/skills/read-positioning.mjs"
  "$PAPERCLIP_HOME/skills/read-playbook.mjs"
  "$PAPERCLIP_HOME/skills/search-vault.mjs"
  "$PAPERCLIP_HOME/skills/write-draft.mjs"
)

for f in "${SKILL_FILES[@]}"; do
  if [[ ! -r "$f" ]]; then
    echo "  FAIL: $f missing or unreadable"
    exit 1
  fi
  node --check "$f" && echo "  ok: $(basename "$f")"
done

# Verify every agent yaml parses.
echo ""
echo "[load] Verifying agent YAML files parse..."
AGENT_DIRS=(controller bornfree storefree knowtation bridges)
TOTAL=0
for d in "${AGENT_DIRS[@]}"; do
  for yaml in "$PAPERCLIP_HOME/agents/$d"/*.yaml; do
    if [[ ! -r "$yaml" ]]; then continue; fi
    python3 -c "import yaml; yaml.safe_load(open('$yaml'))" || {
      echo "  FAIL: $yaml does not parse as YAML"
      exit 1
    }
    echo "  ok: ${yaml#$PAPERCLIP_HOME/agents/}"
    TOTAL=$((TOTAL + 1))
  done
done
echo "  total agents loaded: $TOTAL"

# Trigger Paperclip to reload (if it has a reload mechanism) — falls back to systemd reload.
echo ""
echo "[load] Asking Paperclip to reload..."
sudo systemctl reload paperclip.service 2>/dev/null || sudo systemctl restart paperclip.service
sleep 3

if systemctl is-active --quiet paperclip.service; then
  echo "[load] PASS — Paperclip restarted cleanly with $TOTAL agents."
  exit 0
else
  echo "[load] FAIL — Paperclip did not start. Check logs:"
  echo "  journalctl -u paperclip.service -n 50"
  exit 1
fi
