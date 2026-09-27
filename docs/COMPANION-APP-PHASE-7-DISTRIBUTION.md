# Companion App — Phase 7 production distribution

**Status:** source implementation prepared; no release has been signed, notarized, installed, or
published. This document does not qualify W4 and does not change the sealed W4/C17 record.

## Release contract

The first production candidate is Knowtation **0.1.0 (build 100)** for **macOS 14 or later on
Apple silicon (`arm64`)**. It is a direct-download Developer ID distribution.

| Component | Identifier | Installed location |
| --- | --- | --- |
| Menu-bar app | `store.knowtation.companion` | `/Applications/Knowtation.app` |
| Custody helper | `store.knowtation.companion.custody` | nested in the app and registered with `SMAppService` |
| CLI | `store.knowtation.cli` | `/usr/local/bin/knowtation` |
| MCP executable | `store.knowtation.mcp` | `/usr/local/bin/knowtation-mcp` |
| Bundled Node runtime | `store.knowtation.runtime.node` | app resources; never taken from the user's `PATH` |
| Installer receipt | `store.knowtation.pkg` | signed product archive version `0.1.0.100` |

The release produces a notarized app ZIP, a notarized installer package, a signed update manifest,
checksums, the Knowtation license, an SPDX SBOM, third-party notices, and sanitized release evidence. Exact names and public
metadata are in `release/macos/release.json`.

## What is bundled

The app contains the native launchers, custody helper, Node **24.21.0**, the exact npm production
closure from `companion/runtime/package-lock.json`, the existing Knowtation CLI and MCP source, the
local inference worker, and the pinned `Xenova/all-MiniLM-L6-v2` ONNX model. Node, npm, model files,
critical inference runtime files, source inclusion, architecture, and excluded packages are fixed by:

- `release/macos/release-lock.json`
- `release/macos/runtime-files.json`
- `companion/runtime/package-lock.json`

`acquire-inputs.sh` verifies downloaded sizes and SHA-256 hashes. `build.sh` rebuilds native npm
modules for arm64, removes foreign prebuilds and package-manager tooling, checks critical W3 hashes,
generates license closure and the SPDX SBOM, and seals every resource by path, size, mode, and hash.
Symbolic links and unexpected files fail verification. The final manifest records exact committed
Muse and Git revisions; final release generation rejects an uncommitted source identity.

Core app, CLI, MCP, custody, OAuth, storage, and inference paths use only the bundle and macOS system
frameworks. Two existing integrations remain explicitly optional: `vault sync` uses a separately
installed `git`, and MCP prime context uses a separately installed `muse`. Their absence produces the
fixed failure behavior recorded in `release.json`; neither is part of the signed dependency closure.

## Authentication and custody

The app uses the existing native OAuth Authorization Code + PKCE loopback flow against the fixed
issuer `https://mcp.knowtation.store/api/v1/auth/native`. Discovery and every endpoint must exactly
match that HTTPS issuer. The app dynamically registers a public client, opens the system browser,
validates state and issuer, and stores access/refresh tokens through the custody helper.

The custody helper validates the real XPC sender audit token and accepts only same-team signed app,
CLI, and MCP identifiers. It stores secrets in the macOS Data Protection Keychain under the custody
helper's restricted keychain access group. The app, CLI, MCP process, model worker, logs, and release
evidence never receive the Keychain entitlement or print token values. A one-use inherited socket
capability gives each accepted signed caller only its allowed custody operations.

Native refresh records now retain `client_id` and scopes in durable server state. Refresh therefore
survives a gateway restart while remaining bound to the original public client. The release source
includes this gateway change; production deployment of that source is a separate approval and must
occur before release acceptance.

The signed CLI and MCP executable load a valid stored session and inject it only into their bundled
child runtime. Caller-provided `KNOWTATION_HUB_URL` and `KNOWTATION_HUB_TOKEN` variables are removed
by the signed launcher. `companion verify-session` returns only an authenticated boolean and scope
names, providing caller evidence without exposing identity or credentials.

## Signing and notarization

Every Mach-O code object is signed from the inside out with hardened runtime and a secure timestamp.
The custody helper also embeds and validates a Developer ID provisioning profile containing the
restricted application identifier and keychain access group. Debugging and disabled library
validation entitlements are forbidden. The outer app and installer are submitted separately to
Apple notarization and each notarization ticket is stapled and validated.

Private signing material is external input. No certificate, `.p12`, API key, provisioning secret,
notary credential, or update private key belongs in the repository or release bundle.

## Update and rollback policy

Release metadata is signed with a separate offline Ed25519 key. The app carries only its public key
and key ID. Verification binds the signature, public trust record, exact package hash and size,
platform, architecture, source-build range, target build, expiry, complete artifact hashes, and
committed source revisions.

Build numbers are strictly increasing. The installer refuses build 100 when an installed app has a
higher build. An operational rollback must rebuild the previous known-good source as a **new higher
build**, then sign, notarize, and publish a new manifest. Reusing or republishing an old lower build
is forbidden. Build 100 establishes the update trust root; a second signed release is still required
to produce real update-chain and rollback-rejection evidence for W4.

The implementation provides a signed manual update package and verifier. It does not silently fetch
or install updates in the background. Publication and installation remain explicit release-operator
actions.

## Required acceptance tests

Before publication, the release operator must capture all of the following against the exact final
artifacts:

1. Swift custody, signature, runtime-manifest, and update-policy tests.
2. Focused JavaScript packaging, OAuth durability, lifecycle, closure, tamper, and rollback tests.
3. The full tracked repository suite and a zero-vulnerability audit of the bundled runtime lock.
4. Clean Gatekeeper, code-signature, package-signature, notarization-ticket, checksum, ZIP, SBOM,
   license, architecture, and secret-file verification.
5. Installed signed app lifecycle: start, helper registration, parent-bound runtime stop, restart.
6. Signed app, CLI, and MCP custody access; unsigned-caller denial; hosted session verification from
   both CLI and MCP; MCP initialization; modified-resource rejection.
7. On a later higher build, accepted forward update plus rejection of substituted, expired,
   wrong-key, wrong-source-range, and lower-build manifests/packages.

The exact operator sequence is in `docs/runbooks/KNOWTATION-MACOS-RELEASE.md`.
