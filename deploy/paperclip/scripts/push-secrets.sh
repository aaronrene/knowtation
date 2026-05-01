#!/usr/bin/env bash
######################################################################
# push-secrets.sh
#
# Interactive prompt for each Paperclip secret. Pushes to AWS SSM
# Parameter Store at /knowtation/paperclip/<NAME>. The Paperclip
# systemd service auto-rereads from SSM every 60 seconds.
#
# Run AS the paperclip user (or root) on the AWS box:
#   sudo -u paperclip /opt/paperclip/scripts/push-secrets.sh
#
# What this asks for:
#   - DEEPINFRA_API_KEY                  (required)
#   - HEYGEN_API_KEY                     (required for video render)
#   - HEYGEN_AVATAR_ID                   (required: your Custom Digital Twin)
#   - HEYGEN_VOICE_ID                    (required: ElevenLabs-paired voice in HeyGen)
#   - ELEVENLABS_API_KEY                 (required for audio + voice clone)
#   - ELEVENLABS_VOICE_ID                (required: your Pro Voice Clone)
#   - DESCRIPT_API_KEY                   (required for auto-edit)
#   - DESCRIPT_BORNFREE_PROJECT_ID       (required)
#   - DESCRIPT_STOREFREE_PROJECT_ID      (required)
#   - DESCRIPT_KNOWTATION_PROJECT_ID     (required)
#   - KNOWTATION_HUB_URL                 (required: your hosted Hub URL)
#   - KNOWTATION_HUB_JWT                 (required: short-lived; rotate every 24h)
#   - KNOWTATION_VAULT_ID                (default 'default')
#
# Idempotent: re-running this script overwrites previous values.
# Skipping (empty input) leaves previous value untouched.
######################################################################

set -euo pipefail

NAMESPACE="/knowtation/paperclip"
REGION=$(curl -fsSL -H "X-aws-ec2-metadata-token: $(curl -fsSL -X PUT 'http://169.254.169.254/latest/api/token' -H 'X-aws-ec2-metadata-token-ttl-seconds: 60')" 'http://169.254.169.254/latest/meta-data/placement/region' 2>/dev/null || echo 'us-west-2')

echo "===================================================================="
echo "  Paperclip secrets push to AWS SSM ($NAMESPACE) in region $REGION"
echo "===================================================================="
echo ""
echo "  - Each prompt accepts your secret OR a blank line (skip = keep current)."
echo "  - Values stored as SecureString (encrypted at rest with the default KMS key)."
echo "  - Paperclip re-reads SSM every 60 seconds. No restart needed."
echo ""

REQUIRED=(
  "DEEPINFRA_API_KEY|DeepInfra API key (https://deepinfra.com/dash/api_keys)"
  "HEYGEN_API_KEY|HeyGen API key (Settings → API)"
  "HEYGEN_AVATAR_ID|HeyGen Avatar ID (your Custom Digital Twin)"
  "HEYGEN_VOICE_ID|HeyGen Voice ID (your ElevenLabs-paired voice)"
  "ELEVENLABS_API_KEY|ElevenLabs API key (Profile → API Keys)"
  "ELEVENLABS_VOICE_ID|ElevenLabs Voice ID (your Pro Voice Clone)"
  "DESCRIPT_API_KEY|Descript API key (Account → API & Integrations)"
  "DESCRIPT_BORNFREE_PROJECT_ID|Descript bornfree-factory Project ID"
  "DESCRIPT_STOREFREE_PROJECT_ID|Descript storefree-factory Project ID"
  "DESCRIPT_KNOWTATION_PROJECT_ID|Descript knowtation-factory Project ID"
  "KNOWTATION_HUB_URL|Knowtation Hub URL (https://hub.knowtation.dev or custom)"
  "KNOWTATION_HUB_JWT|Knowtation Hub JWT (Settings → Integrations → Hub API; rotates every 24h)"
  "KNOWTATION_VAULT_ID|Vault ID (default: 'default')"
)

for entry in "${REQUIRED[@]}"; do
  NAME="${entry%%|*}"
  PROMPT="${entry#*|}"

  read -rsp "  $NAME ($PROMPT): " VALUE
  echo ""

  if [[ -z "$VALUE" ]]; then
    echo "    skipped (kept current SSM value if any)"
    continue
  fi

  TYPE="SecureString"
  # KNOWTATION_VAULT_ID and KNOWTATION_HUB_URL are not secret; mark as String for visibility.
  if [[ "$NAME" == "KNOWTATION_VAULT_ID" || "$NAME" == "KNOWTATION_HUB_URL" ]]; then
    TYPE="String"
  fi

  aws ssm put-parameter \
    --region "$REGION" \
    --name "$NAMESPACE/$NAME" \
    --value "$VALUE" \
    --type "$TYPE" \
    --overwrite \
    --output text > /dev/null

  echo "    pushed to $NAMESPACE/$NAME"
done

echo ""
echo "===================================================================="
echo "  All secrets pushed. Triggering immediate sync to /etc/paperclip/env"
echo "===================================================================="

if systemctl is-active --quiet paperclip-secrets-sync.service 2>/dev/null; then
  sudo systemctl start paperclip-secrets-sync.service
fi

echo "  Done. Verify with:"
echo "    sudo cat /etc/paperclip/env | grep -v '_KEY\\|_JWT' | head"
echo "    sudo systemctl status paperclip.service"
