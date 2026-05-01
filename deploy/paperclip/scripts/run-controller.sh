#!/usr/bin/env bash
######################################################################
# run-controller.sh
#
# Triggers the Paperclip controller agent to produce ONE long-form video
# package (script + MP4 + 5 shorts + blog + newsletter + 5 social captions
# + thumbnail) PER PROJECT. All three projects run in parallel.
#
# Usage:
#   sudo -u paperclip /opt/paperclip/scripts/run-controller.sh \
#     --bornfree-topic "Why faraday-bag chair safer protects newborns" \
#     --storefree-topic "How Store Free turns receipts into AI proof" \
#     --knowtation-topic "Why Markdown beats Notion for agent-readable notes"
#
# Output: drafts appear in vault/projects/<project>/drafts/<TODAY>-<kind>-*.md
# with frontmatter status='pending' for human review.
######################################################################

set -euo pipefail

BORNFREE_TOPIC=""
STOREFREE_TOPIC=""
KNOWTATION_TOPIC=""
DRY_RUN=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --bornfree-topic) BORNFREE_TOPIC="$2"; shift 2 ;;
    --storefree-topic) STOREFREE_TOPIC="$2"; shift 2 ;;
    --knowtation-topic) KNOWTATION_TOPIC="$2"; shift 2 ;;
    --dry-run) DRY_RUN="--dry-run"; shift ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
done

if [[ -z "$BORNFREE_TOPIC" || -z "$STOREFREE_TOPIC" || -z "$KNOWTATION_TOPIC" ]]; then
  echo "Missing required args. Example:"
  echo "  $0 \\"
  echo "    --bornfree-topic \"Why faraday-bag chair safer protects newborns\" \\"
  echo "    --storefree-topic \"How Store Free turns receipts into AI proof\" \\"
  echo "    --knowtation-topic \"Why Markdown beats Notion\""
  exit 1
fi

ENV_FILE=/etc/paperclip/env
# shellcheck disable=SC1090
set -a; source "$ENV_FILE"; set +a

PAPERCLIP_BASE="${PAPERCLIP_BASE:-http://127.0.0.1:3000}"

trigger() {
  local project="$1"
  local topic="$2"
  echo "[run-controller] $project → $topic"
  curl -fsS -X POST "$PAPERCLIP_BASE/api/v1/agents/controller/run" \
    -H "Content-Type: application/json" \
    -d "$(cat <<EOF
{
  "project": "$project",
  "topic": $(echo "$topic" | python3 -c 'import sys,json; print(json.dumps(sys.stdin.read().strip()))'),
  "dry_run": $([[ -n "$DRY_RUN" ]] && echo true || echo false),
  "kinds": ["script", "social", "thumbnail", "clip", "blog", "newsletter"]
}
EOF
)" --max-time 60 | python3 -m json.tool || {
    echo "[run-controller] $project FAILED"
    return 1
  }
  echo ""
}

trigger born-free  "$BORNFREE_TOPIC"  &
PID_BF=$!
trigger store-free "$STOREFREE_TOPIC" &
PID_SF=$!
trigger knowtation "$KNOWTATION_TOPIC" &
PID_KW=$!

ANY_FAIL=0
wait $PID_BF || ANY_FAIL=1
wait $PID_SF || ANY_FAIL=1
wait $PID_KW || ANY_FAIL=1

if [[ "$ANY_FAIL" -ne 0 ]]; then
  echo ""
  echo "[run-controller] One or more projects failed. Check Paperclip logs:"
  echo "  journalctl -u paperclip.service -n 100"
  exit 1
fi

echo ""
echo "[run-controller] All three projects triggered."
echo "  Drafts will appear in vault/projects/<project>/drafts/ within ~30 minutes."
echo "  Open the Hub UI to review and approve."
exit 0
