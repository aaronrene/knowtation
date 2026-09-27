# Knowtation macOS 0.1.0 (100) release record

**State:** UNRELEASED — source implementation only  
**W4 status:** BLOCKED — no signed/notarized artifact or installed-caller evidence has been delivered  
**Sealed evidence:** W4/C17 is unchanged; this operational record is outside sealed W4 evidence

## Fixed release identity

- Product: Knowtation
- Version/build: `0.1.0` / `100`
- Target: macOS 14+, arm64
- App: `store.knowtation.companion`
- Custody helper: `store.knowtation.companion.custody`
- CLI: `store.knowtation.cli`
- MCP: `store.knowtation.mcp`
- Installer: `store.knowtation.pkg`, package version `0.1.0.100`
- Hosted native OAuth issuer: `https://mcp.knowtation.store/api/v1/auth/native`

## Source identity — pending integration

- Muse revision: `<PENDING_APPROVED_MUSE_MAIN_REVISION>`
- GitHub revision: `<PENDING_MERGED_MIRROR_REVISION>`
- Branch used for implementation: `feat/companion-phase-7-distribution`
- Source tree clean: `<PENDING>`

## Public signing identity — pending release action

- Developer ID Application common name: `<PENDING_PUBLIC_IDENTITY>`
- Developer ID Installer common name: `<PENDING_PUBLIC_IDENTITY>`
- Apple Team ID: `<PENDING_PUBLIC_TEAM_ID>`
- Custody provisioning profile UUID/expiry: `<PENDING_PUBLIC_METADATA>`
- Notary app submission ID/status: `<PENDING>`
- Notary package submission ID/status: `<PENDING>`
- Update key ID and public key: `<PENDING_PUBLIC_METADATA>`

## Exact deliverables — all pending

| File | SHA-256 | Bytes | Status |
| --- | --- | --- | --- |
| `Knowtation-0.1.0-100-macos-arm64.zip` | `<PENDING>` | `<PENDING>` | missing |
| `Knowtation-0.1.0-100-macos-arm64.pkg` | `<PENDING>` | `<PENDING>` | missing |
| `release-manifest.json` | `<PENDING>` | `<PENDING>` | missing |
| `release-manifest.sig` | `<PENDING>` | `<PENDING>` | missing |
| `SHA256SUMS` | `<PENDING>` | `<PENDING>` | missing |
| `sbom.spdx.json` | `<PENDING>` | `<PENDING>` | missing |
| `LICENSE` | `<PENDING>` | `<PENDING>` | missing |
| `THIRD-PARTY-NOTICES.txt` | `<PENDING>` | `<PENDING>` | missing |

## Verification evidence — pending

- Source-to-build runtime manifest and release lock
- Complete SBOM and license closure
- Application/helper/CLI/MCP/runtime signature details and entitlements
- Installer signature and payload list
- App and installer notarization submissions, logs, and stapler validation
- Gatekeeper assessments, ZIP test, artifact checksums, architecture closure, secret-file scan
- Full tracked test log and bundled-runtime npm audit
- Installed lifecycle and helper registration log
- Signed CLI and MCP authenticated session evidence
- Unsigned caller, tamper/substitution, and rollback rejection evidence
- Second higher-build signed update-chain evidence

No field in this record may be changed from pending until it is supported by the exact delivered
artifact or captured public evidence. Completion of this record alone does not qualify W4.
