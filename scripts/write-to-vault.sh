#!/usr/bin/env bash
# Write content from stdin into the Knowtation vault with frontmatter.
# Use from agent orchestration (e.g. AgentCeption) to write phase summaries,
# plans, or decisions into the vault so they are searchable later.
#
# Usage:
#   echo "Phase 1 summary: ..." | ./scripts/write-to-vault.sh vault/projects/myapp/decisions/phase-1.md --source agentception --project myapp
#   cat plan-summary.md | ./scripts/write-to-vault.sh vault/projects/myapp/plans/2026-03-13.md --source agentception --project myapp --date 2026-03-13
#
# Requires: KNOWTATION_VAULT_PATH set (or config); knowtation CLI on PATH.

set -e

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <vault-relative-path> [--source SOURCE] [--project PROJECT] [--date DATE] [--tag TAGS]" >&2
  echo "  Reads body from stdin. Pass optional frontmatter as --key value." >&2
  exit 1
fi

PATH_ARG="$1"
shift

FRONTMATTER=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --source)   FRONTMATTER+=(--frontmatter "source=$2"); shift 2 ;;
    --project)  FRONTMATTER+=(--frontmatter "project=$2"); shift 2 ;;
    --date)     FRONTMATTER+=(--frontmatter "date=$2"); DATE_SET=1; shift 2 ;;
    --tag)      FRONTMATTER+=(--frontmatter "tags=$2"); shift 2 ;;
    *)          echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

# Ensure date if not provided (ISO date today)
if [[ -z "${DATE_SET:-}" ]]; then
  FRONTMATTER+=(--frontmatter "date=$(date -u +%Y-%m-%d)")
fi

if ! command -v knowtation &>/dev/null; then
  echo "Error: knowtation CLI not on PATH. Set KNOWTATION_VAULT_PATH and ensure knowtation is installed." >&2
  exit 2
fi

knowtation write "$PATH_ARG" --stdin "${FRONTMATTER[@]}"
