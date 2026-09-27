# Knowtation macOS release runbook

This runbook creates the real standalone macOS release. Commands that sign, notarize, install,
launch, publish, or deploy require separate approval. Do not run them merely because this file is
present. Never print or record private credential values.

## Required access and placeholders

The operator needs an Apple Developer Program team with permission to use:

- `Developer ID Application: <LEGAL_ENTITY> (<APPLE_TEAM_ID>)`
- `Developer ID Installer: <LEGAL_ENTITY> (<APPLE_TEAM_ID>)`
- registered App IDs `store.knowtation.companion` and
  `store.knowtation.companion.custody`
- the Keychain Sharing group `<APPLE_TEAM_ID>.store.knowtation.companion.custody`
- a Developer ID provisioning profile for the custody helper containing that group
- App Store Connect notarization permission and a local notarytool profile
- an offline Ed25519 update-signing private key, with its public key and stable key ID

Use placeholders in scripts and records. Supply private material through the macOS Keychain or an
approved secret store, never the repository or shell output.

Create the notary profile once, outside captured logs:

```bash
xcrun notarytool store-credentials "<NOTARY_KEYCHAIN_PROFILE>" \
  --key "<PATH_TO_APP_STORE_CONNECT_API_KEY_P8>" \
  --key-id "<APP_STORE_CONNECT_KEY_ID>" \
  --issuer "<APP_STORE_CONNECT_ISSUER_ID>"
```

Confirm only public identity metadata:

```bash
security find-identity -v -p codesigning
xcrun notarytool history --keychain-profile "<NOTARY_KEYCHAIN_PROFILE>" --output-format json
```

## Source integration before release build

The approved Phase 7 source must first land through Muse and the mandatory GitHub mirror PR. Build
only a clean merged `main`, and record both exact revisions:

```bash
muse checkout main
muse status
muse log -n 1
git status --short
git rev-parse HEAD
```

The release environment uses public identifiers plus paths to protected material:

```bash
export KNOWTATION_SOURCE_MUSE_REVISION="sha256:<64_HEX_MUSE_REVISION>"
export KNOWTATION_SOURCE_GIT_REVISION="<40_HEX_GITHUB_MAIN_REVISION>"
export KNOWTATION_APPLE_TEAM_ID="<APPLE_TEAM_ID>"
export KNOWTATION_APPLICATION_IDENTITY="Developer ID Application: <LEGAL_ENTITY> (<APPLE_TEAM_ID>)"
export KNOWTATION_INSTALLER_IDENTITY="Developer ID Installer: <LEGAL_ENTITY> (<APPLE_TEAM_ID>)"
export KNOWTATION_CUSTODY_PROVISIONING_PROFILE="<PATH_TO_CUSTODY_PROVISIONPROFILE>"
export KNOWTATION_NOTARY_PROFILE="<NOTARY_KEYCHAIN_PROFILE>"
export KNOWTATION_UPDATE_KEY_ID="<UPDATE_ED25519_KEY_ID>"
export KNOWTATION_UPDATE_PRIVATE_KEY_FILE="<PATH_TO_OFFLINE_ED25519_PRIVATE_KEY_PEM>"
export KNOWTATION_UPDATE_PUBLIC_KEY_FILE="<PATH_TO_ED25519_PUBLIC_KEY_PEM>"
export KNOWTATION_UPDATE_PUBLIC_KEY_BASE64="<32_BYTE_RAW_ED25519_PUBLIC_KEY_AS_BASE64>"
export SOURCE_DATE_EPOCH="<INTEGER_RELEASE_SOURCE_EPOCH>"
```

Validate the public/private update-key pair without printing either key:

```bash
node -e 'const c=require("crypto"),f=require("fs"); const a=c.createPrivateKey(f.readFileSync(process.env.KNOWTATION_UPDATE_PRIVATE_KEY_FILE)); const b=c.createPublicKey(f.readFileSync(process.env.KNOWTATION_UPDATE_PUBLIC_KEY_FILE)); if(a.asymmetricKeyType!=="ed25519"||b.asymmetricKeyType!=="ed25519"||!b.equals(c.createPublicKey(a))) process.exit(1)'
```

## Acquire, build, and test unsigned output

These steps are deterministic for the fixed source, inputs, toolchain, architecture, and epoch:

```bash
bash scripts/release/macos/acquire-inputs.sh \
  --lock release/macos/release-lock.json \
  --output build/release-inputs

bash scripts/release/macos/build.sh \
  --inputs build/release-inputs \
  --output build/phase7

mkdir -p build/phase7/logs
bash scripts/release/macos/test.sh \
  --app build/phase7/unsigned/Knowtation.app \
  --full 2>&1 | tee build/phase7/logs/release-tests.log

npm audit --omit=dev --package-lock-only \
  --prefix companion/runtime 2>&1 | tee build/phase7/logs/runtime-audit.log
```

The first release build must also pass the native refresh durability test against the source that
will later be deployed to the gateway:

```bash
node --test test/native-oauth-refresh-durability.test.mjs \
  test/companion-runtime-oauth-session.test.mjs
```

## Sign and notarize

The following commands mutate only build outputs and contact Apple. They must run only after the
specific release action is approved:

```bash
bash scripts/release/macos/sign.sh \
  --app build/phase7/unsigned/Knowtation.app \
  --application-identity "$KNOWTATION_APPLICATION_IDENTITY" \
  --output build/phase7/signed/Knowtation.app

bash scripts/release/macos/notarize.sh \
  --kind app \
  --artifact build/phase7/signed/Knowtation.app \
  --keychain-profile "$KNOWTATION_NOTARY_PROFILE" \
  --evidence build/phase7/evidence/app-notary-submission.json

bash scripts/release/macos/package.sh \
  --app build/phase7/signed/Knowtation.app \
  --installer-identity "$KNOWTATION_INSTALLER_IDENTITY" \
  --output build/phase7/package/Knowtation-0.1.0-100-macos-arm64.pkg

bash scripts/release/macos/notarize.sh \
  --kind pkg \
  --artifact build/phase7/package/Knowtation-0.1.0-100-macos-arm64.pkg \
  --keychain-profile "$KNOWTATION_NOTARY_PROFILE" \
  --evidence build/phase7/evidence/pkg-notary-submission.json
```

## Create and sign release metadata

Build 100 is the initial trust-root release, so its accepted source range is builds 0 through 99.
Use a bounded manifest lifetime chosen by release policy:

```bash
export KNOWTATION_UPDATE_ISSUED_AT="<UNIX_SECONDS>"
export KNOWTATION_UPDATE_EXPIRES_AT="<LATER_UNIX_SECONDS>"
export KNOWTATION_UPDATE_SOURCE_MIN_BUILD="0"
export KNOWTATION_UPDATE_SOURCE_MAX_BUILD="99"

bash scripts/release/macos/assemble-release.sh \
  --app build/phase7/signed/Knowtation.app \
  --package build/phase7/package/Knowtation-0.1.0-100-macos-arm64.pkg \
  --output build/phase7/dist

bash scripts/release/macos/finalize-release.sh \
  --dist build/phase7/dist \
  --key-file "$KNOWTATION_UPDATE_PRIVATE_KEY_FILE" \
  --key-id "$KNOWTATION_UPDATE_KEY_ID"
```

## Verify exact final artifacts

```bash
bash scripts/release/macos/verify.sh \
  --app build/phase7/signed/Knowtation.app \
  --package build/phase7/dist/Knowtation-0.1.0-100-macos-arm64.pkg \
  --manifest build/phase7/dist/release-manifest.json \
  --signature build/phase7/dist/release-manifest.sig \
  --checksums build/phase7/dist/SHA256SUMS \
  --public-key-file "$KNOWTATION_UPDATE_PUBLIC_KEY_FILE" \
  2>&1 | tee build/phase7/logs/release-verification.log
```

Do not publish anything if verification fails.

## Installed signed-caller and lifecycle tests

Run these only on a designated release-test Mac after installation and launch are separately
approved:

```bash
sudo installer \
  -pkg build/phase7/dist/Knowtation-0.1.0-100-macos-arm64.pkg \
  -target /

open -a /Applications/Knowtation.app
/usr/local/bin/knowtation companion sign-in

bash scripts/release/macos/test-signed-lifecycle.sh \
  2>&1 | tee build/phase7/logs/signed-lifecycle.log

bash scripts/release/macos/test-signed-callers.sh \
  /Applications/Knowtation.app \
  2>&1 | tee build/phase7/logs/signed-callers.log
```

The caller test verifies authenticated CLI and MCP sessions, MCP startup, unsigned-caller denial,
and modified-resource rejection without printing tokens. Review logs before evidence capture.

## Capture durable sanitized evidence

Concatenate lifecycle and caller logs, then capture only public/sanitized evidence and release
artifacts:

```bash
cat build/phase7/logs/signed-lifecycle.log \
  build/phase7/logs/signed-callers.log \
  > build/phase7/logs/signed-installed-tests.log

bash scripts/release/macos/capture-evidence.sh \
  --dist build/phase7/dist \
  --build build/phase7 \
  --verification-log build/phase7/logs/release-verification.log \
  --test-log build/phase7/logs/release-tests.log \
  --signed-callers-log build/phase7/logs/signed-installed-tests.log \
  --output "<DURABLE_RELEASE_EVIDENCE_DIRECTORY>/macos/0.1.0-100"
```

Compare the resulting evidence directory to
`docs/operations/releases/macos/0.1.0-100/RELEASE-RECORD.md`. W4 review remains read-only and may
begin only after the exact delivered artifacts and evidence are complete.

## Rollback

Before publication, rollback means withholding or deleting the unpublished build output. After
publication, never roll users back to a lower build. Check out the previous known-good source,
increment the build above every published build, regenerate the manifest with a source range that
includes affected builds, and repeat this entire signing/notarization process. Preserve the failed
release and incident evidence; revoke the update key ID only if that key is suspected compromised.

Uninstalling a test installation is a separate destructive action and is not part of this runbook.
