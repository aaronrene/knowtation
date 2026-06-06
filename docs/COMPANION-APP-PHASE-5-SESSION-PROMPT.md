# Phase 5 Implementation — Next-Session Prompt

**Use a fresh session.** **Model: Claude Sonnet (latest) / Cursor Auto** (⚡ — implementation against
an already-ratified contract). Escalate to a thinking model ONLY if a security-tier test reveals a
genuine ambiguity in the Phase 5 contract — stop and ask rather than guessing.

---

You are implementing **Phase 5 — the Companion App shell** on Muse branch `feat/companion-app`.

This is the ⚡ implementation phase against an **already-ratified design**. The bind gate
`docs/COMPANION-APP-PHASE-5-BIND-GATE.md` (D5.1–D5.8) was **owner-approved 2026-06-06**. Do **not**
re-litigate the design — implement it exactly. If you find a real gap in the contract, **stop and ask**;
do not silently deviate (Aaron's Rule #1/#2).

## Read first (in full)

- `docs/COMPANION-APP-PHASE-5-BIND-GATE.md` — the ratified contract you are implementing (D5.1–D5.8,
  threat model P-a…P-k, §11 test obligations, §0 scope boundary).
- The four pure cores you are wiring (do not modify their security invariants):
  - `lib/companion-loopback-guard.mjs` (Phase 2 — `verifyLoopbackRequest`)
  - `lib/companion-oauth-pkce.mjs` + `lib/companion-token-custody.mjs` (Phase 3)
  - `lib/companion-runtime-manager.mjs` (Phase 4 — lifecycle/admission/integrity/resources)
  - `lib/model-runtime-lane.mjs` (Phase 1 — `selectLane`, `companionAvailable` seam)
- `hub/gateway/native-oauth-provider.mjs` (the server you authenticate against — `/api/v1/auth/native`,
  emits `iss`, loopback variable-port, scope ceiling). ✅ already implemented.
- `lib/daemon-llm.mjs` + `lib/llm-complete.mjs` (the OpenAI-compatible call path the runtime speaks —
  reuse with `base_url = http://127.0.0.1:<port>` or the UDS).
- `test/helpers/companion-keychain-fake.mjs` (the in-memory keychain fake already on the branch — use
  it in tests; the real adapters are what you build).

## What to build (run-from-source; NOT packaging — that's Phase 7, §0)

Real I/O adapters + the orchestration/shell that wires the pure cores. Suggested module layout
(adjust names if a better fit, but keep one concern per file):

1. **Keychain adapter (D5.3)** — `lib/companion-keychain-adapter.mjs` (+ per-OS backends):
   `{ get, set, delete }` on the four `KEYCHAIN_ACCOUNTS` only; reject unknown accounts; macOS
   Keychain `…WhenUnlockedThisDeviceOnly` (no iCloud sync), Windows per-user DPAPI, Linux libsecret;
   **no plaintext fallback** (fail-closed when locked/unavailable). Pick the OS backend at runtime;
   shell out to `security`/`secret-tool` or use a vetted native binding — document the choice.
2. **Inference listener + Phase 2 guard front-door (D5.1)** — `lib/companion-inference-listener.mjs`:
   `listen(0,'127.0.0.1')` (or `[::1]`), build `allowedHosts` from the bound port, call
   `verifyLoopbackRequest` before any model work, never emit permissive CORS, no `SO_REUSEPORT`,
   hard-abort if loopback bind fails.
3. **OAuth redirect listener + flow driver (D5.2)** — `lib/companion-oauth-flow.mjs`:
   separate one-shot ephemeral loopback listener, open the **system browser** with
   `buildAuthorizationUrl`, validate the callback with `validateAuthorizationResponse({..., expectedIssuer})`,
   POST the token request over TLS (full cert verification), store via custody.
4. **Spawn adapter (D5.4)** — `lib/companion-spawn-adapter.mjs`: `spawn`/`kill`/`healthCheck`; absolute
   binary path, `shell:false`, argv array, **scrubbed child env** (no `SESSION_SECRET`/`*_API_KEY`/JWT/
   tokens/keychain refs), process-group, loopback/UDS-`0600` bind flag; detect-and-reclaim a stale
   runtime on start.
5. **Download adapter (D5.5)** — `lib/companion-download-adapter.mjs`: dumb HTTPS-only streaming byte
   pump (`download(url, onChunk)`), full TLS verification, no integrity decision in the adapter. The
   **orchestrator** owns `createIntegrityAccumulator` + `finalize()`, atomic temp→verified move, and
   the first-party out-of-band manifest fetch (trust anchor — NOT from the model host).
6. **Resource probe (D5.6)** — `lib/companion-resource-probe.mjs`: runtime-PID-scoped RAM/CPU; VRAM
   aggregate-only, never enumerate other GPU processes; no privilege escalation; ≤500ms cache.
7. **Orchestrator / shell (D5.7, D5.8)** — `lib/companion-shell.mjs`: wires everything; computes
   `companionAvailable` (true only when integrity-verified ∧ lifecycle `ready` ∧ recent health
   round-trip, recency-bounded; false on any doubt); enforces **object-capability segregation** —
   the runtime group (spawn/download/health/stat) is constructed with **no** reference to the
   authority group (keychain/JWT/canister).

## Hard constraints

- **Muse-canonical**, stay on `feat/companion-app`. No git/gh for this tree.
- **Fail-closed** at every bind/custody/spawn/download/probe point.
- **No secret** in any log, error, adapter interface, or redirect (loopback token, JWT, refresh token,
  code, `code_verifier`, `SESSION_SECRET`, digest, model path).
- Do **not** change the pure cores' security invariants or the server-side OAuth provider.
- Do **not** do packaging/signing/notarization/auto-update (Phase 7), new storage paths (Phase 6), or
  new server routes (none needed).

## Tests (Aaron's Rule #0 — all 7 tiers before any merge to `main`)

Per `PHASE-5-BIND-GATE.md` §11. Centerpiece security tier MUST include: loopback-only bind (reject
`0.0.0.0`/`::`/routable); DNS-rebinding + cross-origin still 403 at the front-door; runtime back-end
carries no authority + no CORS; keychain surface minimal + device-local; **child-env contains no
secret**; **architecture/import test: runtime group imports no authority module** (build-blocking);
manifest trust-anchor out-of-band from the model host; resource probe never enumerates other GPU
processes; `companionAvailable` fail-closed; no secret in any output.

## Suggested order

1. Keychain adapter (+ 7 tiers) — everything else depends on custody.
2. Inference listener + guard front-door (+ 7 tiers).
3. Spawn + download + resource adapters (+ 7 tiers each).
4. OAuth flow driver (+ 7 tiers; stub the browser-open in tests).
5. Orchestrator/shell (+ integration/e2e: sign in → manifest → download → verify → spawn → health →
   `companionAvailable=true` → enrich locally; plus the architecture/env-scrub security tests).
6. Run the full suite once, fix all failures, re-run only the failed files, then full suite as the
   final gate. Commit on `feat/companion-app` via Muse.
