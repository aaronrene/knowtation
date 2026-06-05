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
