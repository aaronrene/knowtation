#!/usr/bin/env bash
######################################################################
# hello-world-test.sh
#
# Verifies Paperclip can:
#   1. Read DEEPINFRA_API_KEY from /etc/paperclip/env
#   2. Make an outbound HTTPS call to DeepInfra
#   3. Return a parseable response
#
# Run AS the paperclip user:
#   sudo -u paperclip /opt/paperclip/scripts/hello-world-test.sh
#
# Pass condition: prints a one-line model response, exits 0.
# Fail condition: missing key, network error, or bad response. Exits 1.
######################################################################

set -euo pipefail

ENV_FILE=/etc/paperclip/env
if [[ ! -r "$ENV_FILE" ]]; then
  echo "FAIL: $ENV_FILE not readable. Did push-secrets.sh run?"
  exit 1
fi

# shellcheck disable=SC1090
set -a
source "$ENV_FILE"
set +a

if [[ -z "${DEEPINFRA_API_KEY:-}" ]]; then
  echo "FAIL: DEEPINFRA_API_KEY missing in $ENV_FILE"
  echo "Run: sudo -u paperclip /opt/paperclip/scripts/push-secrets.sh"
  exit 1
fi

MODEL="${DEEPINFRA_CHAT_MODEL:-Qwen/Qwen2.5-72B-Instruct}"

echo "[hello-world] Calling DeepInfra ($MODEL)..."

RESPONSE=$(curl -fsS \
  -X POST "https://api.deepinfra.com/v1/openai/chat/completions" \
  -H "Authorization: Bearer $DEEPINFRA_API_KEY" \
  -H "Content-Type: application/json" \
  --max-time 30 \
  -d "$(cat <<EOF
{
  "model": "$MODEL",
  "messages": [
    {"role": "system", "content": "You are a one-word smoke test. Reply with exactly: OK"},
    {"role": "user", "content": "smoke test"}
  ],
  "max_tokens": 4,
  "temperature": 0
}
EOF
)" 2>&1) || {
  echo "FAIL: HTTP request failed:"
  echo "$RESPONSE"
  exit 1
}

CONTENT=$(echo "$RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['choices'][0]['message']['content'])" 2>/dev/null || echo "")

if [[ -z "$CONTENT" ]]; then
  echo "FAIL: Could not parse DeepInfra response. Raw:"
  echo "$RESPONSE"
  exit 1
fi

echo "[hello-world] DeepInfra responded: '$CONTENT'"
echo "[hello-world] PASS — Paperclip is wired to DeepInfra."
exit 0
