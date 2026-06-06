# Companion App — Design & Authorization Gate

**Status:** design + authorization gate. **No companion runtime code is implemented or approved by this document.**
**Layer:** Knowtation / Muse substrate (Scooling and other ecosystem products consume it via `ModelRuntimeAdapter`).
**Upstream brief:** [`COMPANION-APP-MODEL-ROUTING-AND-ENRICHMENT-ARCHITECTURE.md`](COMPANION-APP-MODEL-ROUTING-AND-ENRICHMENT-ARCHITECTURE.md) (§2 companion, §3 client-side constraint, §5 OAuth, §6 billing, §8.1 localhost security, §8.2 derived-artifact paradox, §10/§12 item 3).
**Related code:** `hub/bridge/server.mjs` (the service the companion evolves from), `lib/llm-complete.mjs` (provider lanes), `lib/daemon-llm.mjs` (OpenAI-compatible local/remote routing).

---

## Simple Summary

The companion app is a small, optional background helper (think menu-bar / system-tray app, like
the Ollama helper) that lets a person run AI **on their own computer** so their private notes never
leave the device. It signs in with the same Knowtation login, downloads a local model, and exposes
that model **only to programs already running on the same machine** (the browser tab or the
companion itself).

A cloud server **cannot** reach a model on your laptop, so the model must be called from your side.
The cloud keeps doing what it already does — store data, check who you are, handle permissions and
billing, and sync — and never touches the local model.

This document does two things:

1. It **specifies** how the companion should be built and, most importantly, **how to secure the
   local model endpoint** so a malicious web page cannot quietly use it (the real risk).
2. It is an **authorization gate**: it records what is accepted as a design and what is **not yet
   approved to build**. No companion runtime ships on the strength of this document.

It also records that one **non-companion, low-risk** piece was implemented alongside it on the same
branch — the **OpenRouter "bring-your-own-key" model lane** in `lib/llm-complete.mjs` — because the
brief (§12 item 2) explicitly green-lit it as a self-contained model-routing addition. It is fully
tested and changes nothing for existing deployments.

## Technical Summary

The companion is an **evolution of the existing `hub/bridge` Node service** plus a **bundled local
inference runtime** (e.g. Ollama / llama.cpp). It authenticates as a **native/public OAuth client**
using **PKCE + loopback redirect** (no client secret on device), stores the resulting JWT in the
**OS keychain**, and acts against the hosted gateway/canister with **identical identity and scopes**
to the web app. The hosted gateway/canister continues to serve data, identity, permissions, billing,
and sync; it **never proxies local inference** (§3 hard constraint — the cloud cannot reach
`localhost`).

The security-critical surface is the **loopback model endpoint**. Binding to `127.0.0.1` is *not*
sufficient: any web page in the user's browser can issue requests to `http://127.0.0.1:<port>`, and
**DNS-rebinding** can make a remote origin appear same-origin. The endpoint must therefore enforce a
**per-session bearer token + strict `Host`/`Origin` allowlisting + non-predictable port + no
permissive CORS**, and treat note bodies as **untrusted data** (prompt-injection threat model, §8.3
of the brief).

This gate **accepts the design and the security model** and **defers implementation** until its
explicit dependencies (hosted tenancy decisions, the §4 model-routing lane matrix and the owner-vs-
member billing/consent rule) are accepted. The future implementation must satisfy the test
obligations in §10 (Aaron's 7-tier standard) before any merge to `main`.

---

## Review Decision (Authorization Gate)

### This gate ACCEPTS (design only)

- The **architecture**: companion = `hub/bridge` evolution + bundled local runtime; cloud serves
  data/identity/permissions/billing/sync and never proxies local inference (§3).
- The **OAuth model**: native/public client, PKCE + loopback redirect, no device-side client secret,
  JWT in OS keychain, same scopes as the web session (§5).
- The **localhost endpoint security model** in [§4](#4-localhost-endpoint-security-model-the-core-of-this-gate)
  as the binding requirement for any future implementation.
- The **derived-artifact storage policy per privacy tier** in [§5](#5-derived-artifact-storage-paradox-resolution).
- The **test obligations** in [§10](#10-test-obligations-7-tier-for-the-future-implementation) as a
  merge precondition for the future implementation.

### This gate DOES NOT approve (no code)

- Shipping any companion binary, tray helper, installer, auto-updater, or bundled runtime.
- Opening any new local HTTP listener / loopback model endpoint in any repo.
- New canister routes, new Hub REST endpoints, new DB tables, or wire-protocol changes for the
  companion.
- Storing derived artifacts (`ai_summary`, embeddings, insight events) under any new storage path
  or encryption scheme.
- Any change to OAuth client registration or scopes.
- Pulling the companion ahead of its dependencies (see next section).

### Hard dependencies (must be accepted BEFORE companion implementation)

1. **Hosted tenancy/teams** (brief §10A): auto-provisioned workspace owner, hosted role store,
   invites — and the **owner-vs-member billing + consent** rule. The companion's "may a member's
   local companion enrich an owner's notes?" question (§8.7) cannot be answered until this lands.
2. **Model-routing lane matrix** (brief §4) confirmed, including the client-side-inference
   constraint and the default-lane selection logic.
3. **Derived-artifact storage decision per privacy tier** (brief §8.2) — see [§5](#5-derived-artifact-storage-paradox-resolution).

---

## 1. Scope and non-goals

**In scope (design):** companion topology, OAuth/PKCE flow, the loopback endpoint security model,
the derived-artifact storage policy, packaging/distribution shape, and the consumption contract for
Scooling via `ModelRuntimeAdapter`.

**Out of scope (this gate):** any runtime code, installers, signing/notarization pipelines, the ZK
tier (tracked separately in the brief §9), and the model-training path (Unsloth) which is explicitly
distinct from inference infra (brief §10 item 2).

## 2. Architecture

```
┌── User's machine ───────────────────────────────────────────┐
│                                                              │
│  Browser tab (web session JWT)        Companion app          │
│        │  in-browser WebGPU                │ (tray helper)    │
│        │  (light private tasks)            │                  │
│        ▼                                   ├── OAuth PKCE ───────► system browser ──► Knowtation OAuth
│   WebGPU model                             ├── JWT in OS keychain                     (Google/GitHub)
│                                            ├── bundled local runtime (Ollama/llama.cpp)
│                                            └── loopback model endpoint 127.0.0.1:<rnd>
│                                                  ▲  token + Host/Origin allowlist           │
│        local model calls (client-side) ──────────┘                                          │
└─────────────────────────────────────────────────────────────┘
             │ data / identity / permissions / billing / sync (JWT)
             ▼
   Hosted gateway / canister  ──  NEVER proxies local inference (§3)
```

- The companion **reuses the bridge's** auth/token handling, role/scope resolution, and canister
  client. It **adds** a bundled runtime and a guarded loopback endpoint.
- **Model calls route client-side; data routes through the hosted gateway/canister** (brief §3 design
  rule).

## 3. OAuth (native/public client, PKCE + loopback)

- Companion opens the **system browser** and runs the standard Knowtation Google/GitHub OAuth flow
  with **PKCE** (RFC 7636) and a **loopback redirect** (`http://127.0.0.1:<ephemeral-port>/callback`,
  RFC 8252). **No client secret** is embedded in the distributed binary.
- On success it receives the **same JWT** the web app gets and stores it in the **OS keychain**
  (Keychain / DPAPI / libsecret). It then acts as the user against the hosted gateway/canister with
  identical scopes.
- The **local model endpoint requires no separate login** — it is a loopback-only service bound to
  the authenticated session (secured per §4). In-browser inference reuses the existing web session
  (no extra auth).

## 4. Localhost endpoint security model (the core of this gate)

Binding to `127.0.0.1` is **necessary but not sufficient**. The endpoint MUST enforce **all** of:

1. **Bearer token on every request.** A high-entropy, per-session token is generated at companion
   start, stored in the OS keychain, and required on every call to the loopback endpoint. Requests
   without the exact token are rejected `401` before any model work.
2. **Strict `Host` header allowlist.** Accept only `127.0.0.1:<port>` / `localhost:<port>` literals.
   Reject any other `Host` value `403` — this is the primary **DNS-rebinding** defense (a rebound
   domain presents an attacker `Host`).
3. **Strict `Origin`/`Sec-Fetch-Site` checks.** Reject cross-site browser origins. **No wildcard
   CORS**, no `Access-Control-Allow-Origin: *`, and no reflecting arbitrary `Origin`.
4. **Non-predictable ephemeral port**, not a fixed well-known port, to raise the cost of blind
   probing (defense-in-depth, never the sole control).
5. **Loopback bind only** (`127.0.0.1`, never `0.0.0.0`).
6. **No ambient authority.** The endpoint exposes only model inference; it never exposes vault
   read/write, the canister client, or the stored JWT.
7. **Untrusted-input handling.** Note bodies are passed to the model strictly as **data**, never as
   instructions or as a source of headers/URLs (prompt-injection threat model, brief §8.3).
8. **Rate limiting + minimal logging.** Bound request rate; never log token, JWT, or note bodies.

A future implementation that omits any of items 1–3, 5, or 6 fails this gate.

## 5. Derived-artifact storage paradox resolution

If inference runs privately on-device but `ai_summary` / embeddings / insight events are written to
the **cloud canister**, the derived content has effectively left the device (brief §8.2). Policy by
tier:

| Privacy tier | Where derived artifacts live | Rationale |
| --- | --- | --- |
| **Convenience** (server holds key) | Cloud canister, as today | No additional privacy claim; full server-side features. |
| **Privacy-max / ZK** (user holds key) | **Local-only, or client-encrypted before upload** | Derived content must not be readable by the host; aligns with the ZK tier (brief §9). |

The ZK encryption hierarchy itself is **out of scope here** (brief §9 owns it). This gate only fixes
the **policy**: privacy-max derived artifacts are never stored as host-readable plaintext.

## 6. Provenance

Derived artifacts produced via the companion record `generated_by`, `model`, `version`, `date`, and
`source_event_id` (brief §8.4). Re-enrichment is triggered on model upgrade. This is a **provenance
flag, not a lifecycle state** — it must not force notes through the proposal pipeline (brief §7.3).

## 7. Packaging / distribution (design intent, not approved to build)

- Shape: a **tray/background helper** that bundles the local runtime; auto-update channel; code
  signing/notarization per OS; least-privilege OS permissions for the runtime.
- Multi-device (brief §8.5): phone (no WebGPU/companion) vs laptop (companion) — compute where
  capable; cached-result location follows the §5 storage policy.
- Offline/fallback (brief §8.6): companion offline or device incapable → graceful fallback
  (in-browser, managed-with-consent, or embeddings-only) and later re-sync of cached enrichment.

## 8. Scooling consumption contract

Scooling consumes the companion lane **only** through `ModelRuntimeAdapter` (no Scooling-specific
inference infra, no separate model billing). A Scooling managed-lane call is a metered event against
the user's **Knowtation** packs; local/in-browser/BYO lanes are **not** metered (brief §6).

## 9. The OpenRouter lane (implemented on this branch — model-routing precursor)

Per brief §12 item 2, the **OpenRouter provider lane** was added to `lib/llm-complete.mjs` as a
self-contained, low-risk addition (OpenAI-compatible wire format, same shape as the existing
DeepInfra path). It is **not** the companion and does not depend on this gate's deferred items.

- **Activation:** `KNOWTATION_CHAT_PROVIDER=openrouter` + `OPENROUTER_API_KEY` (BYO key).
- **Model:** `config.llm.openrouter_chat_model` → `OPENROUTER_CHAT_MODEL` → default
  `openai/gpt-4o-mini`.
- **Optional attribution:** `OPENROUTER_SITE_URL` → `HTTP-Referer`, `OPENROUTER_APP_TITLE` →
  `X-Title` (sent only when set).
- **Privacy/billing rule (enforced + tested):** **no silent fallback** to a managed lane on failure
  — a BYO-key failure surfaces rather than re-routing note text to a metered provider (brief §4/§6).
- **Backward compatibility (enforced + tested):** OpenRouter is **explicit-only**; adding
  `OPENROUTER_API_KEY` alone never changes the provider for an existing deployment.
- **UI:** OpenRouter is already a selectable provider in the Hub **Settings → Consolidation** chat-
  provider dropdown (`web/hub/index.html`, with the `https://openrouter.ai/api/v1` base-URL field via
  `lib/daemon-llm.mjs`). The new lane wires the same provider into the `completeChat` path used by MCP
  summarize and Hub proposal LLM jobs. Env documented in `.env.example`.
- **Tests:** 7 tiers under `test/llm-complete-openrouter-*.test.mjs` (32 cases): unit, integration,
  e2e, stress, data-integrity, performance, security.

> Note: there is **no** existing Hub UI that lets a user pick the `completeChat`/`KNOWTATION_CHAT_PROVIDER`
> provider (DeepInfra/OpenAI/Anthropic/Ollama are env-selected, not UI-selected). The brief's phrasing
> "expose it in the integrations UI alongside the existing DeepInfra/OpenAI/Anthropic/Ollama options"
> describes a UI surface that does not exist for this code path; the truthful exposure is the
> consolidation provider dropdown (already lists OpenRouter) plus `.env.example`. A dedicated
> chat-provider settings UI, if desired, is a separate follow-up.

## 10. Test obligations (7-tier) for the future implementation

When the companion is approved and implemented, each component (loopback endpoint, OAuth/PKCE flow,
runtime manager) must ship with the full 7-tier suite before any merge to `main`:

1. **Unit** — token check, `Host`/`Origin` allowlist, port binding, model adapter.
2. **Integration** — OAuth PKCE loopback round-trip; endpoint + runtime; keychain read/write.
3. **End-to-end** — sign in → download model → enrich a note locally → result handled per §5 policy.
4. **Stress** — concurrent inference requests; runtime backpressure; many auth attempts.
5. **Data-integrity** — derived-artifact provenance fields; no plaintext leak in privacy-max tier.
6. **Performance** — endpoint overhead bounds; runtime cold-start; no event-loop starvation.
7. **Security** — DNS-rebinding rejection, cross-origin rejection, missing/invalid token rejection,
   no ambient authority, prompt-injection (note body as data), no secret in logs/errors.

## 11. Deferred / open questions (carried from the brief)

- Owner-vs-member: whose packs, whose consent, may a member's companion enrich an owner's notes
  (§8.7) — blocked on tenancy.
- Consent & data lifecycle for auto-enrichment, stricter for minors/classrooms; retention/deletion
  of derived artifacts (§8.8).
- Quality/eval loop for cheap/local enrichment (§8.9).
- Abuse/quota on the managed lane (§8.10).
- Distribution/signing/auto-update specifics (§8.11).

## 12. Build phases & model-tier guidance

This section is a **roadmap, not an approval**. The gate's "DOES NOT approve" list still holds: no
companion runtime code starts until **Phase 0** resolves the three hard dependencies (tenancy/consent,
lane matrix, storage decision). Phases are sequenced; later phases assume the earlier seams are
accepted.

### Model-tier legend

- 🧠 **Thinking model** (extended-reasoning, e.g. a high-thinking model) — use wherever a subtle
  mistake becomes a **security hole, privacy breach, cryptographic weakness, or wrong multi-tenant
  policy**. These phases involve adversarial reasoning, protocol/crypto correctness, or consent rules
  where "looks right" is not good enough.
- ⚡ **Sonnet / automatic** — implementation against an **already-accepted design**: plumbing, UI
  wiring, runtime lifecycle, packaging mechanics, routine test tiers. Cursor automatic model mode is
  appropriate here.
- 🔀 **Hybrid** — **design/spec the seam with a thinking model, then implement with Sonnet/auto.**
  Use a thinking model for the interface contract and threat surface, switch to Sonnet/auto for the
  body once the contract is fixed.

### Phase table

| # | Phase | Depends on | Model tier |
| --- | --- | --- | --- |
| 0 | **Decision gates** — resolve the three hard dependencies: hosted tenancy + owner-vs-member billing/consent (§8.7), the §4 lane matrix + default-lane logic, the per-tier derived-artifact storage decision (§5). Output: accepted decisions, not code. | — | 🧠 Thinking |
| 1 | **`ModelRuntimeAdapter` seam + lane matrix** — the abstraction Hub/Scooling consume; lane selection (managed / in-browser / companion / BYO) and metering boundary (§8). | 0 | 🔀 Hybrid |
| 2 | **Loopback endpoint security core** — per-session bearer token, `Host`/`Origin` allowlist, DNS-rebinding defense, non-predictable port, loopback bind, no ambient authority, untrusted-input handling (§4 items 1–8). | 1 | 🧠 Thinking |
| 3 | **OAuth native/public client** — PKCE + loopback redirect (RFC 7636/8252), no device-side secret, JWT in OS keychain (Keychain/DPAPI/libsecret) (§3). | 1 | 🧠 Thinking |
| 4 | **Bundled runtime manager** — Ollama/llama.cpp lifecycle, model download/verify, cold-start, backpressure, resource limits (§7). | 1 | ⚡ Sonnet/auto |
| 5 | **Companion app shell** — tray/background helper integrating phases 2–4; session wiring to the hosted gateway/canister (§2). | 2, 3, 4 | ⚡ Sonnet/auto |
| 6 | **Derived-artifact storage + provenance enforcement** — per-tier policy (§5), `generated_by`/`model`/`version`/`source_event_id` (§6), client-encryption hook for the privacy-max/ZK tier. | 0, 5 | 🔀 Hybrid |
| 7 | **Packaging / distribution** — code signing, notarization, least-privilege OS perms, auto-update channel + update integrity (§7). | 5 | 🔀 Hybrid |
| 8 | **Multi-device & offline fallback** — capability detection, graceful fallback (in-browser / managed-with-consent / embeddings-only), later re-sync of cached enrichment (§7). | 5, 6 | ⚡ Sonnet/auto |
| 9 | **7-tier test suites** — per component (§10). Security-tier design (DNS-rebinding, cross-origin, missing/invalid token, no ambient authority, prompt-injection, no secret in logs) is reasoning-heavy; the other tiers are routine. | per-phase | 🔀 Hybrid (security tier 🧠; unit/integration/e2e/stress/perf ⚡) |
| 10 | **Scooling consumption wiring** — consume the companion lane via `ModelRuntimeAdapter` only; managed-lane metering against Knowtation packs; local/in-browser/BYO unmetered (§8). | 1, 6 | ⚡ Sonnet/auto |

### Why the 🧠 / 🔀 phases need deeper reasoning

- **Phase 0** decides consent and money flow across tenants. A wrong rule here (e.g. a member's
  companion silently enriching an owner's notes) is a privacy/billing defect that propagates into
  every later phase. Reason it through explicitly.
- **Phase 2** is *the* core of this gate. DNS-rebinding and cross-origin abuse are adversarial; the
  defense must be argued against an attacker model, not pattern-matched. This phase, and its security
  tests in Phase 9, are the highest-leverage place for a thinking model.
- **Phase 3** is auth/crypto protocol correctness (PKCE, redirect handling, keychain). Subtle
  deviations create real account-compromise paths.
- **Phases 1, 6, 7** are hybrids: the **contract/threat surface** (adapter interface, ZK encryption
  boundary, update-integrity/supply-chain) warrants a thinking model; the bulk implementation does
  not. Fix the seam first, then drop to Sonnet/auto.
- **Phases 4, 5, 8, 10** are well-specified engineering once the seams exist — Sonnet or automatic
  model mode is appropriate and cheaper.

---

## 13. Phase 0 — Decision Record (the three hard dependencies)

**Status:** DRAFT — awaiting owner approval. **No code.** The gate's
[“DOES NOT approve (no code)”](#this-gate-does-not-approve-no-code) list remains fully in force.
**Branch:** `feat/companion-app` (Muse-canonical; not a docs-only PR to `main`).
**Model tier:** 🧠 Thinking (§12 phase table, row 0) — these are consent/money/privacy rules where a
wrong default propagates into every later phase.
**Purpose:** resolve the three items under
[“Hard dependencies (must be accepted BEFORE companion implementation)”](#hard-dependencies-must-be-accepted-before-companion-implementation).
Output is **accepted decisions**, not implementation.

### 13.0 Grounding (decisions anchored to existing code, not assumptions)

| Decision area | Source of truth in the codebase |
| --- | --- |
| Tenancy / delegation resolution | `hub/lib/hosted-workspace-resolve.mjs` → `resolveEffectiveCanisterUser`, `resolveAllowedVaultIdsForHostedContext`; `HOSTED_VALID_ROLES = {admin, editor, viewer, evaluator}` |
| Hosted owner stub (today) | brief §10A: `/api/v1/workspace` → `owner_user_id: null`; invites “not supported on hosted yet”; roles env-only |
| Billing / packs / metering | `hub/gateway/billing-constants.mjs` (tiers `free·plus·growth·pro`, `PACK_TOKENS`, `COST_CENTS`), `hub/gateway/billing-middleware.mjs` (`runBillingGate` meters on `getUserId(req)`) |
| Platform operator vs workspace owner | `HUB_ADMIN_USER_IDS` (global allowlist) — distinct from any workspace role |
| Scooling lane enum | `scooling/src/adapters/types.ts` → `runtimeLaneSchema = [local, self_hosted, enterprise, openrouter, direct_provider, disabled]` |
| Enrichment artifacts | `mcp/tools/index-enrich.mjs` (`ai_summary`), `lib/tag-suggest.mjs` (embeddings), `lib/memory-consolidate.mjs` (`runDiscoverPass` → connections/contradictions/open_questions/topic_count) |

### Decision index

| ID | Hard dependency | Outcome |
| --- | --- | --- |
| **D1** | Hosted tenancy + owner-vs-member billing/consent (gate item 1; brief §8.7, §10A) | **ACCEPT, with conditions** |
| **D2** | Model-routing lane matrix + default-lane logic + client-side constraint (gate item 2; brief §3, §4) | **CONFIRM** |
| **D3** | Derived-artifact storage per privacy tier (gate item 3; brief §8.2; gate §5) | **CONFIRM, with per-artifact detail** |

---

### D1 — Hosted tenancy + owner-vs-member billing/consent

**Simple summary.** Every person owns their own workspace. Someone you invite (a “member”) can
only touch your notes if you gave them a role that already lets them read those notes. A member
running AI **on their own computer** (their companion) over your notes is **free** and is allowed
**only** if (a) they could already read those notes and (b) you turned on “let my team enrich my
notes.” You are never billed for a member’s on-device work; you are only billed when work uses the
paid cloud lane on **your** workspace — and members can’t trigger that paid lane on your workspace
unless you explicitly allow it. For a Privacy-max (zero-knowledge) workspace, the math itself stops
a member from reading anything you didn’t cryptographically share with them.

**Technical summary.** Tenancy uses the existing owner/delegation primitive
(`resolveEffectiveCanisterUser`): an actor acts on their **own** canister partition unless they
appear in the owner’s hosted role store (`HOSTED_VALID_ROLES`), in which case `delegate = true` and
`effective = owner`. Phase 0 fixes the **policy** layered on that primitive; the tenancy
implementation (auto-owner provisioning, hosted role store, invites) is its **own** design + gate
(brief §10A) and is a prerequisite, not part of this record.

**D1.1 — Workspace ownership.** Each user is auto-provisioned as **owner of exactly one workspace**
on first sign-in. The **platform operator** (`HUB_ADMIN_USER_IDS`) is a separate, global, rare role
and is **never** a workspace role. A user is therefore *owner of their own* and *member of others’*
(via delegation). **Binding security constraint:** auto-owner provisioning must never let actor A
reach actor B’s partition unless B placed A in B’s role store — i.e. the `effective` resolution is
the *only* path to another partition. (Proof obligation belongs to the tenancy gate.)

**D1.2 — Billing principal = the workspace whose partition is written.** Metered operations
(`COST_CENTS`: search/index/note_write/proposal_write/consolidation) and **managed-cloud model
calls** bill against the **owner of the partition the operation executes on** (`effective` user),
**not** the requesting actor when they are a delegate. Rationale: the data, storage, and
provider-cost are the owner’s; the owner controls workspace spend. Solo operations on a user’s own
partition bill to that user (owner == actor). **Implementation note (binding):** `runBillingGate`
currently meters on a single `getUserId(req)`; the tenancy work must supply the **effective/owner**
id as the billing identity for delegated requests. Until that exists, **delegated managed-lane and
metered ops are not enabled** (see D1.4).

**D1.3 — May a member’s companion enrich an owner’s notes? (brief §8.7 — the crux).**
**Yes, but only when ALL of the following hold:**

1. **No new read capability.** The member already has body-read scope on those notes via role +
   `resolveAllowedVaultIdsForHostedContext` / scope map. Local inference grants **zero** additional
   read access — it can only process what the member could already read.
2. **Owner opt-in.** The owner has enabled **“allow delegated companion enrichment”** at the
   workspace level. **Default: OFF.**
3. **ZK is self-enforcing.** For a Privacy-max/ZK owner, the member can only enrich notes whose
   per-note DEK the owner has wrapped to the member’s key (brief §9.4). No new mechanism — the
   cryptography is the gate; an un-shared note is unreadable on the member’s device, full stop.
4. **Provenance, downgrade-safe.** The written artifact records `generated_by = member actor`,
   `source = companion`, `model`, `version`, `date`, `source_event_id` (§6), and is stored under the
   **owner’s** privacy tier per D3 — a member’s companion must **never downgrade** an owner’s tier
   (a ZK owner’s artifact stays client-encrypted even though the member generated it).
5. **Consent-tracked + quota-bounded.** The enrichment event is consent-logged and counts against
   the workspace’s enrichment quota (abuse control, brief §8.10).

**Billing of D1.3:** a member’s companion is the **local lane → not metered** (brief §6 principle 1).
The owner is therefore **not** billed for a member’s on-device enrichment (no provider cost exists to
meter). Only a **managed-lane** path would be billable, and that is governed by D1.2 + D1.4.

**D1.3 clarification (added during Phase 1 implementation review — RATIFIED by owner 2026-06-05).**
The Phase 1 seam (`lib/model-runtime-lane.mjs`, `enforceConsentPolicy`) enforces D1.3(2) as a
**fail-closed** gate (`delegatedEnrichmentAllowed`, default OFF) on a delegate’s enrichment
write-back to the owner’s partition. Two implementation specifics were resolved that D1.3 above did
not spell out:
1. **Scope of the gate by lane.** The opt-in gates the **`local` companion lane** (named in D1.3)
   **and** the **`openrouter` BYO-key lane** — both route the owner’s note text **off the owner’s own
   infrastructure** (local = the *delegate’s* device; openrouter = the *delegate’s* third-party
   contract), so they are treated identically. Org lanes (`self_hosted`, `enterprise`) are **not**
   gated by this individual opt-in — the org controls the endpoint and governs that path by org
   policy. The managed lane (`direct_provider`) remains under **D1.4** (`delegatedManagedAllowed`).
2. **Enrichment vs. ephemeral completion.** The gate applies only when the call **writes a derived
   artifact to the owner’s partition** (`enrichesDelegatedPartition=true`). A read-only/ephemeral
   completion by a delegate who already has read scope (D1.3(1)) is allowed — it produces no
   owner-attributed artifact.

This closes the gate §12 canonical defect (*“a member’s companion silently enriching an owner’s
notes”*), which the original Phase 1 contract left as a silent `allow`. **Owner ratification
(2026-06-05):** item 1 accepted — the openrouter BYO lane is gated identically to the companion,
because a delegate’s BYO key routes the owner’s note text to a third party (higher egress than the
on-device companion), so leaving it ungated would guard the lower-risk path and expose the higher-
risk one. The owner opt-in (`delegatedEnrichmentAllowed`, default OFF) is a one-time flip that covers
a team’s deliberately shared key.

**D1.4 — Consent + quota defaults (anti-surprise-spend).**
- **Members cannot trigger the managed (paid) lane on an owner’s partition by default.** It is
  **OFF** until the owner explicitly enables it, and even then is bounded by an owner-set per-member
  quota. This prevents a careless/malicious delegate from draining the owner’s packs (`PACK_TOKENS`).
- **Members can always read the owner’s already-produced derived artifacts** (subject to scope) —
  reading is free; only *producing* via a paid lane is gated.
- Auto-enrichment of private notes (even local) is consent-tracked; **stricter rules for
  minors/classrooms** are deferred to the consent/data-lifecycle item (gate §11) but the **default-OFF
  posture above is the safe baseline** until that lands.

**D1 adversarial check.** Threat: delegate exfiltrates owner plaintext via local model. → Bounded by
(1): the delegate already had read access; local inference adds no exfil path beyond the role grant,
and for ZK owners the crypto prevents it outright. Threat: delegate drains owner packs. → Bounded by
D1.4 default-OFF + per-member quota. Threat: auto-owner escalation into another partition. → Bounded
by D1.1 (effective-resolution is the only cross-partition path). Threat: member’s companion silently
downgrades an owner’s ZK artifact to host-readable. → Forbidden by D1.3(4) + D3.

**D1 outcome: ACCEPTED as policy.** Hard prerequisite: the **tenancy implementation gate** (brief
§10A) must land auto-owner provisioning, the hosted role store, invites, and **effective/owner
billing identity** before any companion phase that writes to a delegated partition.

---

### D2 — Model-routing lane matrix, default-lane logic, client-side constraint

**Simple summary.** There are a few “lanes” a model call can travel. Cheap cloud is the default for
solo users; a one-click “keep my data on my device” switch sends light tasks to the browser and
heavy private tasks to the companion; privacy-focused orgs default to their own server or their own
key and turn the cloud lane off. The unbreakable rule: **a model on your machine is always called
from your machine** — the cloud never reaches into your laptop to run it.

**Technical summary.** Phase 0 **confirms the brief §4 matrix** as the canonical Knowtation lane set
and the brief §3 client-side-inference constraint, and fixes the mapping to Scooling’s
`runtimeLaneSchema` so Phase 1’s `ModelRuntimeAdapter` uses stable lane identifiers.

**D2.1 — Confirmed lane set (canonical, from brief §4):**

| Lane | Privacy | Billing | Invoked |
| --- | --- | --- | --- |
| Managed cloud — cheap (default for individuals) | Low (text → 3rd party; needs consent for private text) | **Packs (metered)** | Cloud gateway |
| Managed cloud — premium | Low | **Packs (metered)** | Cloud gateway |
| In-browser (WebGPU / WebLLM) | High (runs in tab) | **Free** | **Client-side** |
| Companion (bundled local runtime) | Highest (never leaves device) | **Free** (user compute) | **Client-side** |
| Self-hosted / enterprise endpoint | High (org infra) | Free / org contract | Org endpoint |
| BYO key (OpenRouter / direct provider) | Medium (user’s own contract) | **No packs** (user pays provider) | Provider |

The four lanes the companion design pivots on are **managed / in-browser / companion / BYO-key**; the
self-hosted/enterprise lane is the org-privacy variant. “Managed” has cheap + premium tiers.

**D2.2 — Default-lane selection logic (confirmed, brief §4 “Defaults”):**
- **Individual hosted user →** managed **cheap-model** lane by default; a one-click **“keep my data on
  my device”** toggle routes light tasks to **in-browser**, and **offers the companion** when the task
  is too heavy for the browser.
- **Privacy-focused org →** default **self-hosted / BYO endpoint**; managed lane **OFF** (a selling
  point).
- **Product picks the safe default and shows the trade-off.** Graceful **fallback chain** when a
  device can’t run a client-side lane:
  **in-browser → companion → managed-with-explicit-consent → embeddings-only.**
- Private text never goes to a managed lane without explicit per-action consent.

**D2.3 — Client-side-inference HARD CONSTRAINT (confirmed, brief §3):** the cloud
gateway/canister **never proxies local/private inference**. In-browser and companion lanes are
invoked **only** by something on the user’s machine (the tab or the companion). The cloud continues
to serve **data, identity, permissions, billing, sync** and nothing else for these lanes. **Any
future design that routes `localhost`/on-device inference through the cloud fails this gate.**

**D2.4 — Mapping to Scooling `runtimeLaneSchema` (factual reconciliation).** Scooling already
exposes `[local, self_hosted, enterprise, openrouter, direct_provider, disabled]`. Canonical mapping
adopted at the `ModelRuntimeAdapter` boundary (Phase 1):

| Brief §4 lane | Scooling lane | Note |
| --- | --- | --- |
| In-browser **and** Companion | `local` | Both are *client-side*; the in-browser-vs-companion choice is a Knowtation-internal device-capability decision, opaque to Scooling. |
| Self-hosted | `self_hosted` | Org endpoint. |
| Enterprise endpoint | `enterprise` | Org contract endpoint. |
| BYO key (OpenRouter) | `openrouter` | Already present; provider arrives “for free” via the §9 OpenRouter lane. |
| Managed cloud (cheap/premium) & direct BYO provider | `direct_provider` | Managed/premium routed through **Knowtation packs**; Scooling runs **no** model billing (brief §6.3, gate §8). |
| Lane off / fallback exhausted | `disabled` | Falls back to embeddings-only / no inference. |

**D2 outcome: CONFIRMED.** The §4 matrix, the default-lane logic, the client-side constraint, and the
Scooling mapping are accepted as the basis for the Phase 1 `ModelRuntimeAdapter` seam.

---

### D3 — Derived-artifact storage per privacy tier

**Simple summary.** Where do the AI by-products live — the short summary of a note, the math
“fingerprints” used for search (embeddings), and the insight events (connections, open questions)?
For **Convenience** users: in the cloud, as today. For **Privacy-max** users: **never** as something
the host can read — either kept on the device or encrypted with the user’s own key before it’s
uploaded. Generating something privately on-device and then storing it readable in the cloud would
quietly defeat the privacy promise; this decision forbids that.

**Technical summary.** Phase 0 **confirms gate §5** and finalizes it **per artifact type**. The ZK
key hierarchy itself stays out of scope (brief §9 owns it); this record fixes only the **storage
location + host-readability policy**. **Critical clarification of the “paradox”:** today’s memory
events use **AES-256-GCM with a server-held key** (`KNOWTATION_MEMORY_SECRET`, brief §9.1) — that is
**encryption-at-rest, NOT zero-knowledge**, because the operator can decrypt. For Privacy-max,
“client-encrypted before upload” means a **client-held (ZK) key**; the existing server-held-key
encryption does **not** satisfy the Privacy-max requirement.

**D3.1 — Per-artifact, per-tier matrix (final):**

| Artifact | Convenience (server holds key) | Privacy-max / ZK (user holds key) |
| --- | --- | --- |
| `ai_summary` (`mcp/tools/index-enrich.mjs`) | Cloud canister, host-readable plaintext, as today | **Local-only cache, or client-encrypted (envelope under per-note/vault DEK) before upload.** Stored as **ciphertext only**; host cannot read. |
| Embeddings / vectors (`lib/tag-suggest.mjs`) | Cloud canister server-side vector index, as today | **Computed client-side**; vectors stored server-side **only as encrypted-at-rest ciphertext** (enables sync/backup) **or** kept local-only; **plaintext vectors never leave the device**; vector search runs client-side (brief §9.5). |
| Insight events (`runDiscoverPass`: connections / contradictions / open_questions / topic_count) | Cloud canister memory store, as today (server-readable even where AES-256-GCM-at-rest, per server-held key) | **Computed client-side (companion)**; stored **client-encrypted** under `DEK-memory`; host cannot read (brief §9.5). |

**D3.2 — Binding policy (gate §5, restated and locked):** Privacy-max derived artifacts are **never**
stored as **host-readable plaintext** and are **never** stored under a **server-held key**. The only
acceptable Privacy-max storage states are **(a) local-only** or **(b) client-encrypted under a
user-held key** before upload.

**D3.3 — Multi-device interaction (brief §8.5).** Cached-result location follows D3.1. For
Privacy-max, artifacts sync between devices **only as ciphertext**; a device without the key
(e.g. a phone with no companion) sees ciphertext and falls back per D2.2 (embeddings-only / no AI)
until that device’s key is enrolled (cross-device DEK re-wrap is ZK’s concern, brief §9.4 — out of
scope here).

**D3.4 — Retention / deletion (brief §8.8, baseline).** Derived artifacts inherit the **source
note’s** retention; deleting a note deletes its derived artifacts (summary, vectors, insight events).
For Privacy-max, destroying the key **crypto-shreds** all derived artifacts (they become permanently
unreadable). Detailed lifecycle/minors rules remain in the deferred consent item (gate §11); this is
the safe baseline.

**D3 outcome: CONFIRMED.** Per-artifact storage is fixed; the encryption mechanism is delegated to
the ZK tier (brief §9).

---

### 13.1 What Phase 0 unblocks

With D1–D3 accepted, the following become available to later phases:

- **Phase 1 (`ModelRuntimeAdapter` seam + lane matrix):** lane identifiers (D2.1), default-lane logic
  (D2.2), client-side constraint (D2.3), Scooling mapping (D2.4), and the metering boundary
  (D1.2 — owner-billed, managed-only).
- **Phase 6 (derived-artifact storage + provenance):** per-tier storage policy (D3) and provenance
  fields (D1.3(4), §6).
- **Phase 10 (Scooling consumption):** the unmetered-local / owner-billed-managed rule (D1.2, D2.4).

### 13.2 What remains NOT approved by this record

Phase 0 approves **decisions only**. The gate’s
[“DOES NOT approve (no code)”](#this-gate-does-not-approve-no-code) list is unchanged: no binary,
no loopback listener, no new canister/Hub routes, no new storage paths, no OAuth scope changes. D1
additionally has a **hard prerequisite**: the **tenancy implementation gate** (auto-owner
provisioning, hosted role store, invites, effective/owner billing identity) must land before any
companion phase writes to a delegated partition.

### 13.3 Explicitly deferred (not Phase 0 blockers)

Consent/data-lifecycle detail incl. minors/classrooms (gate §11), quality/eval loop (§11),
managed-lane abuse/quota specifics (§11), distribution/signing/auto-update (§7/§11), and the entire
ZK key hierarchy + PQC (brief §9). None block Phase 1; D1/D3 carry the safe default-OFF / never-
host-readable baselines until they land.

### 13.4 Approval

| Decision | Recommendation | Owner approval |
| --- | --- | --- |
| D1 — tenancy + owner-vs-member billing/consent | ACCEPT (with tenancy-gate prerequisite) | ☐ pending |
| D2 — lane matrix + defaults + client-side constraint | CONFIRM | ☐ pending |
| D3 — derived-artifact storage per tier | CONFIRM | ☐ pending |

On owner approval of D1–D3, Phase 0 is **complete** and work proceeds to **Phase 1 — 🔀 Hybrid:
`ModelRuntimeAdapter` seam** (design/spec the seam with a thinking model, implement with Sonnet/auto).
