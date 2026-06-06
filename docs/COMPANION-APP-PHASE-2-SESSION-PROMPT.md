# Companion App — Phase 2 Session Prompt (Loopback Endpoint Security Core)

**Use this to seed a fresh chat session.** Start that session on a **thinking model (Opus)** — Phase 2
is a full 🧠 phase (adversarial security reasoning), not Hybrid.

---

## 0. Copy-paste prompt (paste this into the new session)

```text
You are continuing the Knowtation Companion App build on the Muse branch feat/companion-app.
This is PHASE 2 — Loopback Endpoint Security Core. It is a 🧠 Thinking phase: DNS-rebinding and
cross-origin abuse are adversarial; the defense must be argued against an attacker model, not
pattern-matched. Stay on a thinking model for the whole phase.

FIRST, read these in full (do not skip):
  - docs/COMPANION-APP-DESIGN-AND-AUTHORIZATION-GATE.md  (esp. §4 the 8 loopback controls;
    §13 Phase 0 Decision Record D1–D3; §12 phase table; the "DOES NOT approve (no code)" list)
  - docs/COMPANION-APP-MODEL-ROUTING-AND-ENRICHMENT-ARCHITECTURE.md  (§3 client-side constraint,
    §5 OAuth, §8.1 localhost security, §8.3 prompt injection)
  - docs/COMPANION-APP-PHASE-1-ADAPTER-SEAM.md  (the seam this phase plugs into)
  - lib/model-runtime-lane.mjs  (Phase 1 output: selectLane/isManagedLane/enforceConsentPolicy)
  - hub/bridge/server.mjs  (the service the companion evolves from — auth/token/CORS patterns)
  - hub/gateway/gateway-cors-middleware.mjs and test/gateway-cors-middleware.test.mjs (existing
    Origin/CORS handling to stay consistent with)

RESOLVE THIS SCOPE QUESTION BEFORE WRITING ANY SOCKET CODE (ask me):
  The gate's "DOES NOT approve" list forbids "opening any new local HTTP listener / loopback model
  endpoint in any repo." Phase 0 is now accepted, which unblocks companion implementation per the
  gate's own logic — but the actual listening socket is the single most security-critical surface.
  Proposed scope (mirrors how Phase 1 shipped pure, testable logic with no I/O):
    Phase 2 builds the REQUEST-GUARD as pure, fully-tested functions (token verify, Host allowlist,
    Origin/Sec-Fetch-Site check, rate-limit decision, ambient-authority boundary) WITHOUT binding a
    real socket. The actual listener bind is deferred to Phase 5 (companion shell) or a separate
    explicit gate. Confirm this scope, or get my approval to open a real loopback listener now.

THEN produce, in order:
  1. A short adversarial THREAT MODEL section (attacker capabilities: malicious web page in the
     user's browser, DNS-rebinding to make a remote origin appear same-origin, a local non-browser
     process, a prompt-injection payload in a note body). For each, the exact control that stops it.
  2. lib/companion-loopback-guard.mjs — pure functions, no I/O, no env reads:
       verifyLoopbackRequest({ method, headers, token, expectedToken, allowedHosts, now, rateState })
         → { allow: boolean, status: 200|401|403|429, reason: string }
     enforcing gate §4 items 1,2,3,5,6,8 at the request-decision level. Fail-closed on anything
     ambiguous or missing. Constant-time token comparison (no early-exit string compare). Never
     include the token/JWT/note body in the returned reason or any thrown error.
  3. The 7-tier test suite test/companion-loopback-guard-*.test.mjs. The SECURITY tier is the
     centerpiece and must cover, at minimum: missing token (401), wrong token (401, constant-time),
     bad Host header → DNS-rebinding rejection (403), cross-site Origin/Sec-Fetch-Site rejection
     (403), no-wildcard-CORS, rate-limit trip (429), no ambient authority (guard exposes only the
     inference decision — never vault/canister/JWT), note-body-as-data (an injection string in the
     body cannot alter headers, host, or the decision), and NO secret in any output/log/error.
  4. docs/COMPANION-APP-PHASE-2-LOOPBACK-SECURITY.md — the accepted design + the guard contract +
     the threat-model→control mapping + what Phase 5 must do to bind the socket safely.

CONSTRAINTS:
  - Muse-canonical (knowtation). Commit on feat/companion-app via `muse code add` + `muse commit`.
    Do NOT open a docs-only PR to main (owner policy). Do NOT use git/gh for knowtation work.
  - Aaron's standards: 7 test tiers + strong docstrings; no temporary fixes; no assumptions stated
    as fact (verify against source); fail-closed on ambiguous permissions; security first.
  - Honor gate §4: "A future implementation that omits any of items 1–3, 5, or 6 fails this gate."
  - Verify the full suite is green before committing. Give a plain-language + technical summary and
    a clear recommendation when done (Rule #7).

When Phase 2 is complete and committed, recommend whether Phase 3 (OAuth native/public client,
PKCE + loopback redirect, JWT in OS keychain) is the next 🧠 session or whether to batch it.
```

---

## 1. Where we are (state at end of this session)

**Branch:** `feat/companion-app` (Muse-canonical, knowtation). Two prior commits on it:
- Phase 0 Decision Record (gate §13, D1–D3) — `444d712`.
- Phase 1 seam + 7-tier tests — `06bcc48`; revised by `d2354ec` (D1.3(2) gate + org-privacy ordering).

**Scooling cross-repo:** `feat/phase3e5-authorization-checklist` commit `3282480` added
`lane_policy_denied` to `ModelResponse` and updated the mock adapter. (Scooling uses git, not Muse.)

**Phase 0 (accepted decisions):**
- **D1** — tenancy + owner-vs-member billing/consent. Owner is billing principal for ops on the
  owner partition; delegate managed-lane spend is default-OFF (`delegatedManagedAllowed`); delegated
  companion/openrouter enrichment is default-OFF (`delegatedEnrichmentAllowed`, D1.3(2), ratified).
  Prerequisite: a separate tenancy implementation gate (auto-owner provisioning, role store, invites,
  effective/owner billing identity) before any companion phase writes to a delegated partition.
- **D2** — lane matrix + default-lane logic + client-side-inference hard constraint, mapped to
  Scooling `runtimeLaneSchema`.
- **D3** — derived-artifact storage per tier (Convenience = cloud; Privacy-max = local-only or
  client-encrypted, never host-readable nor under a server-held key).

**Phase 1 (built, tested, committed):** `lib/model-runtime-lane.mjs` — `selectLane`, `isManagedLane`,
`enforceConsentPolicy`. Pure functions, 120 tests across 7 tiers, all green. This is the seam Phase 2
plugs into: **Phase 2's guard sets `companionAvailable = true` in the Phase 1 `LaneCapabilities` only
after the loopback request passes the token + Host/Origin checks.**

## 2. What Phase 2 is (gate §12, row 2 — 🧠 Thinking)

> **Loopback endpoint security core** — per-session bearer token, `Host`/`Origin` allowlist,
> DNS-rebinding defense, non-predictable port, loopback bind, no ambient authority, untrusted-input
> handling (§4 items 1–8). Depends on Phase 1. This phase, and its security tests in Phase 9, are the
> highest-leverage place for a thinking model.

## 3. The 8 mandatory controls (gate §4 — verbatim intent)

1. **Bearer token on every request** — high-entropy, per-session, OS keychain; `401` without the
   exact token, before any model work. **(hard-fail if omitted)**
2. **Strict `Host` header allowlist** — accept only `127.0.0.1:<port>` / `localhost:<port>`; else
   `403`. Primary DNS-rebinding defense. **(hard-fail)**
3. **Strict `Origin`/`Sec-Fetch-Site`** — reject cross-site origins; no wildcard CORS; no reflecting
   arbitrary `Origin`. **(hard-fail)**
4. **Non-predictable ephemeral port** — defense-in-depth, never the sole control.
5. **Loopback bind only** — `127.0.0.1`, never `0.0.0.0`. **(hard-fail)**
6. **No ambient authority** — exposes only model inference; never vault read/write, the canister
   client, or the stored JWT. **(hard-fail)**
7. **Untrusted-input handling** — note bodies are passed to the model strictly as data, never as
   instructions or as a source of headers/URLs (prompt-injection threat model, brief §8.3).
8. **Rate limiting + minimal logging** — bound request rate; never log token, JWT, or note bodies.

## 4. Threat model to reason against (do not pattern-match — argue each)

- **Malicious web page in the user's browser** issuing `fetch` to `http://127.0.0.1:<port>`. Stopped
  by: bearer token (1) it cannot know + Origin/Sec-Fetch-Site (3).
- **DNS-rebinding** — attacker rebinds a domain to `127.0.0.1` so the browser treats it as
  same-origin; the request arrives with the attacker's `Host`. Stopped by: strict `Host` allowlist (2).
- **Local non-browser process** probing the port. Stopped by: token (1) + non-predictable port (4).
- **Prompt injection in a note body** trying to set headers / change the URL / issue instructions.
  Stopped by: untrusted-input handling (7) — body is data only.
- **Secret exfiltration via logs/errors.** Stopped by: minimal logging (8) + never echoing
  token/JWT/body in any output.

## 5. Proposed deliverables (confirm scope first — see §0 scope question)

- `lib/companion-loopback-guard.mjs` — pure `verifyLoopbackRequest(...)` returning an allow/deny +
  HTTP status + reason; constant-time token compare; fail-closed. **No socket binding in Phase 2.**
- `test/companion-loopback-guard-*.test.mjs` — 7 tiers; security tier is the centerpiece.
- `docs/COMPANION-APP-PHASE-2-LOOPBACK-SECURITY.md` — accepted design + guard contract + threat→control
  map + the safe-bind checklist Phase 5 must satisfy when it opens the real listener.

## 6. Definition of done

- Scope question resolved with the owner before any socket code.
- Guard enforces §4 items 1,2,3,5(as a documented bind-time obligation),6,7,8 at the decision level.
- 7-tier suite green; security tier covers every threat in §4 above.
- Constant-time token comparison; no secret in any return value, log, or error.
- Committed on `feat/companion-app` via Muse; no docs-only PR to `main`.
- Plain + technical summary with a recommendation (Rule #7), and a Phase 3 go/batch recommendation.

## 7. Open questions to settle at session start

1. **Scope:** pure guard now, socket bind deferred to Phase 5 (recommended) — or approve a real
   loopback listener in Phase 2?
2. **Rate-limit shape:** token-bucket vs fixed-window; per-session vs per-port. (Pick one, justify.)
3. **Host allowlist source:** does the guard receive the bound port from the caller (recommended,
   keeps it pure) or read it itself? (Recommended: caller passes `allowedHosts`.)
