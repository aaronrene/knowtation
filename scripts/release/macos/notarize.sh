#!/bin/bash
set -euo pipefail

kind=""
artifact=""
profile=""
evidence=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --kind) kind="$2"; shift 2 ;;
    --artifact) artifact="$2"; shift 2 ;;
    --keychain-profile) profile="$2"; shift 2 ;;
    --evidence) evidence="$2"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

[[ "$kind" == "app" || "$kind" == "pkg" ]] || { echo "--kind must be app or pkg" >&2; exit 2; }
[[ -e "$artifact" && -n "$evidence" ]] || { echo "--artifact and --evidence are required" >&2; exit 2; }
[[ -n "$profile" && "$profile" != *'<'* ]] || { echo "real notary keychain profile required" >&2; exit 1; }
mkdir -p "$(dirname "$evidence")"

submission="$artifact"
temporary=""
if [[ "$kind" == "app" ]]; then
  temporary="${artifact%/}.notary.zip"
  rm -f "$temporary"
  ditto -c -k --sequesterRsrc --keepParent "$artifact" "$temporary"
  submission="$temporary"
fi
trap 'if [[ -n "$temporary" ]]; then rm -f "$temporary"; fi' EXIT

xcrun notarytool submit "$submission" \
  --keychain-profile "$profile" \
  --wait \
  --output-format json > "$evidence"
NOTARY_EVIDENCE="$evidence" node - <<'NODE'
const fs = require('fs');
const result = JSON.parse(fs.readFileSync(process.env.NOTARY_EVIDENCE, 'utf8'));
if (result.status !== 'Accepted' || typeof result.id !== 'string') {
  throw new Error(`notarization was not accepted: ${result.status ?? 'unknown'}`);
}
NODE
submission_id="$(NOTARY_EVIDENCE="$evidence" node -p \
  "JSON.parse(require('fs').readFileSync(process.env.NOTARY_EVIDENCE, 'utf8')).id")"
xcrun notarytool log "$submission_id" \
  --keychain-profile "$profile" \
  "$evidence.log.json"
xcrun stapler staple "$artifact"
xcrun stapler validate "$artifact"
echo "$evidence"
