# Companion App, Model Routing, Enrichment & Discovery — Architecture Brief

**Status:** design discussion / next-session brief. **No implementation in this session.**
**Audience:** dedicated Knowtation architecture session (developed in conjunction with Scooling).
**Scope:** Knowtation-ecosystem layer (the companion is a Knowtation/Muse component; Scooling consumes it via adapter).
**Related code/docs:**
`hub/gateway/server.mjs` (hosted auth/roles), `hub/lib/hosted-workspace-resolve.mjs` (owner/delegation),
`hub/roles.mjs` (self-hosted role store), `mcp/tools/index-enrich.mjs` (`ai_summary`),
`lib/tag-suggest.mjs` (embedding tag suggestion), `lib/memory-consolidate.mjs` (`runDiscoverPass`),
`docs/EXPLORE-DISCOVER-INSIGHTS-TO-VAULT-NOTES.md`, `docs/MULTI-VAULT-AND-SCOPED-ACCESS.md`,
Scooling: `docs/ADAPTER-CONTRACTS.md` (`ModelRuntimeAdapter`), `docs/PHASE-3F-PATTERN-MAP-DESIGN.md`,
`docs/PRIVACY-AND-SAFETY.md`.

---

## 1. Why this brief exists

While reviewing why a Scooling Pattern Map on un-enriched notes would be weak, we surfaced two
foundational gaps that block real multi-user use of the ecosystem:

1. **Tenancy/teams:** on the hosted Hub, admin is a global env allowlist (`HUB_ADMIN_USER_IDS`);
   new users are `member` with no team, no scope, no invites. Teachers/mentors/teams/scoped access
   (the heart of Scooling) are therefore impossible for ordinary users today.
2. **Enrichment/insight quality & privacy:** summaries (`ai_summary`), tag suggestions, and Discovery
   insights are opt-in and mostly proposal-stage. "Good data in" is inconsistent, and doing it well
   raises a privacy question (note text → model) and a cost question.

This brief records the agreed direction and the open questions for both, centered on a **companion
app + model-routing** design that resolves the privacy-vs-foolproof tension.

---

## 2. The companion app — what it is (and is not)

**It is:** a small, optional, **background helper** (menu-bar / system-tray app, in the spirit of
Ollama or a sync helper). Minimal UI: OAuth sign-in, a "keep my data on my device" toggle, a status
indicator, and management of the local model download. Architecturally it is an **evolution of the
existing self-hosted Hub bridge** + a **bundled local inference runtime** (e.g. Ollama/llama.cpp).

**It is not:** a heavyweight second product, and not required for most users. Managed cloud and
in-browser tiers cover the majority. The companion is the **opt-in tier for heavy, private,
no-manual-setup** local inference.

**Why Knowtation, not Scooling:** local inference is a *substrate* capability that should serve
Knowtation enrichment, Scooling tutoring, and any other ecosystem product. Building it into Scooling
would force re-implementation per product and split it from the vault/identity/permission layer it
must cooperate with. So: **build at the Knowtation/Muse layer; Scooling consumes it through
`ModelRuntimeAdapter` like any other lane.**

**Phasing:** v1 needs no companion — in-browser WebGPU covers light private tasks with zero install.
The companion is the later tier for heavy private inference.

---

## 3. The hard architectural constraint: local inference is invoked CLIENT-SIDE

If the model runs on the **user's machine** but the **gateway runs in the cloud**, the cloud gateway
**cannot reach `localhost`**. Therefore:

> Local/private inference must be invoked by something **also on the user's machine** — the browser
> tab (in-browser WebGPU) or the companion app. The cloud gateway/canister continues to serve
> **data, identity, permissions, billing, and sync**; it never proxies local inference.

This single constraint shapes topology, billing, and what is even possible. Design rule:
**route model calls client-side; route data through the hosted gateway/canister.**

---

## 4. Model-routing lane matrix (agreed direction)

| Lane | Privacy | Setup | Billing | Notes |
| --- | --- | --- | --- | --- |
| Managed cloud (cheap model) | Low (text leaves to 3rd party) | None | **Packs (metered)** | Default for individuals; needs consent for private text |
| In-browser (WebGPU / WebLLM) | High (runs in tab) | None | **Free** | Embeddings + light enrichment; small models only |
| Companion app (bundled local model) | Highest (never leaves device) | One-click install | **Free** (user's compute) | Heavy private inference without manual localhost setup |
| Self-hosted / enterprise endpoint | High (org infra) | Org setup | Free / org contract | Org-privacy selling point |
| BYO key (OpenRouter / provider) | Medium (own contract) | Paste key | **No packs** (user pays provider) | Works on hosted too |
| Managed cloud (premium model) | Low | None | **Packs** | Best quality when privacy isn't the priority |

**Defaults (the user shouldn't need to understand the spectrum):**

- **Individual hosted user:** managed cheap-model lane by default, with a one-click
  **"keep my data on my device"** toggle → in-browser for light tasks, offer the companion when the
  task is too heavy for the browser.
- **Privacy-focused org:** default to self-hosted / BYO endpoint; managed lane **off** — a selling point.
- The product picks the safe default and **shows the trade-off**; graceful fallback when a device
  can't run in-browser (→ companion, or managed-with-consent, or embeddings-only).

---

## 5. OAuth for the companion (and in-browser)

OAuth does not change. The companion is a **native/public OAuth client**:

- Opens the **system browser**, runs the normal Knowtation Google/GitHub OAuth flow with
  **PKCE + loopback redirect** (no client secret on device).
- Receives the same JWT the web app gets, stores it in the **OS keychain**, and acts as the user
  against the hosted gateway/canister — identical identity and scopes.
- The **local model endpoint** needs no separate login: it's a loopback-only service tied to the
  authenticated session. See §8 for securing it.

In-browser inference uses the existing web session; no extra auth.

---

## 6. Billing model (keep base low, pay for what you use)

Three principles:

1. **Local / in-browser / BYO = no packs.** No provider cost to you → nothing metered. The companion
   is a **cost-reducer for you** and a **privacy feature for them** — aligned incentives.
2. **Packs meter the managed (cloud) lane only** — the only lane where you pay a provider.
3. **Scooling does not run its own model billing.** It routes managed-lane usage through
   **Knowtation's shared entitlement/pack system** (Knowtation owns the lanes and the user's
   entitlement). A Scooling model call = a metered event against the user's Knowtation packs. One
   billing system, not two.

**Subscription vs usage:** low/no base subscription covering the **platform** (hosting, storage,
canister, sync); **inference metered via packs** (or free when local/BYO). Don't bake heavy inference
into subscription — that overcharges non-users.

**Open question (tenancy × billing):** when a *member* uses an *owner's* vault/model lane, whose
packs apply — owner's or member's? Define before teams ship (see §9, §10).

---

## 7. Enrichment & Discovery strategy

### 7.1 Embeddings ≠ enrichment

Embeddings already power search + `tag-suggest` and work on poorly-tagged notes (they match the
embedded body, not tags). **Embeddings are the always-on floor.** Even with zero summaries the
product is usable. Embeddings can also run locally/in-browser for privacy.

### 7.2 Enrichment timing — recommended combination

Not one strategy; a layered one:

- **Always on, cheap:** embeddings at index time (local option for privacy).
- **Lazy on first meaningful use in Scooling, cached:** when a note is actually referenced/retrieved/
  used in a pattern, enrich once with a **cheap model** and cache `ai_summary`. Bounds cost to used
  notes.
- **User-triggered ("Enrich this note"):** explicit, clearest consent.
- **Opt-in background batch:** for power users.

Routed by the §4 lane choice (local/cheap for light tasks; managed/premium when chosen).

### 7.3 Do NOT overload "proposal"

Proposals are a **write-back/review** concept. Enrichment is a **derived metadata layer**
(`ai_summary` + embeddings + discovery facets) that attaches to any note. The "designation" is just a
provenance flag (`generated_by`, model, version, date), **not** a lifecycle state. Don't force notes
through the proposal pipeline merely to get summaries.

### 7.4 Discovery is the upstream insight engine (key revelation)

`runDiscoverPass` already emits insight events:
`{ connections, contradictions, open_questions, topic_count }`. These map **directly** onto the
Scooling Pattern Map categories we deferred:

| Scooling Pattern Map card | Discovery signal |
| --- | --- |
| `open_questions` | `open_questions` (resolves the earlier "no signal" blocker) |
| `related_notes` | `connections` |
| `topic_recurrence` | `topic_count` / topic clustering |
| (new) contradictions/gaps | `contradictions` |

**Direction:** Scooling's Pattern Map **consumes Discovery's body-free insight projections** (scoped
to the active bundle), instead of re-deriving from raw structure. Discovery rides the same
model-routing/consent/billing rails as enrichment. **Agents do more than Discovery** (tutoring,
multi-step, social/provenance-aware orchestration) but build **on** Discovery + enrichment — they do
not independently re-read raw text outside the gated rails.

This updates `docs/PHASE-3F-PATTERN-MAP-DESIGN.md`: the deferred `open_questions` / depth signals can
return via Discovery + enrichment projections rather than new raw-structure transports.

---

## 8. What we might have missed (open risks/items to resolve)

1. **Localhost endpoint security.** A loopback model service is an attack surface: **DNS-rebinding**
   and malicious local pages can hit `localhost`. Require an auth token + strict `Origin`/host checks,
   not just "bind to 127.0.0.1." Design this explicitly.
2. **Derived-artifact storage paradox.** If inference runs privately on-device but the resulting
   `ai_summary`/embeddings are stored in the **cloud canister**, the derived content has effectively
   left the device — partially defeating privacy. Privacy-max mode may need **local-only (or
   client-encrypted) storage** of derived artifacts. Decide per privacy tier.
3. **Prompt injection from note bodies.** Note content is **untrusted input** to enrichment/Discovery
   prompts. Treat the body as data, never instructions; sandbox prompts (ties to the existing
   prompt-injection threat model).
4. **Provenance & model versioning.** Record `model`, `version`, `date`, `source_event_id` on derived
   metadata; re-enrich when the model upgrades; surface "generated by X" for trust/audit (ties to
   `AUDIT-PROVENANCE-OBSERVABILITY`).
5. **Multi-device.** Phone (no WebGPU/companion) vs laptop (companion). Compute where capable; decide
   where cached results live (cloud vs local) — interacts with item 2.
6. **Offline / fallback.** Companion offline or device incapable → graceful fallback and later
   re-sync of cached enrichment.
7. **Tenancy × billing/consent.** Owner vs member: whose packs, whose consent, and may a member's
   local companion enrich an owner's notes? Define with the tenancy work.
8. **Consent & data lifecycle.** Auto-enrichment (even local) of private notes should be
   consent-tracked; stricter for minors/classrooms; define retention/deletion of `ai_summary`,
   embeddings, and insight events.
9. **Quality/eval loop.** How do we know cheap/local enrichment is "good enough"? Feedback/eval path.
10. **Abuse/quota.** Managed-lane rate limits and abuse controls; auto-workspace + invites + model
    calls expand the abuse surface.
11. **Distribution/packaging.** Tray helper vs bundled desktop app vs CLI; auto-update; signing;
    OS permissions for the local runtime.

---

## 9. Zero-Knowledge Privacy & Post-Quantum Cryptography

### 9.1 What "true zero-knowledge" means (vs today)

Today Knowtation has **AES-256-GCM encryption at rest** for memory events
(`lib/memory-provider-encrypted.mjs`): data is stored encrypted, but the key
(`KNOWTATION_MEMORY_SECRET`) lives server-side in your hosting environment (Netlify env).
This protects against external attackers and ICP node operators, but the host operator can
decrypt — it is **encryption-at-rest with a server-held key**, not zero-knowledge.

True **zero-knowledge (ZK)** means: the server stores *only ciphertext*; the key is derived
**client-side from the user's passphrase or passkey** and never reaches the server in usable
form. The host is *mathematically* unable to decrypt — not a promise, a cryptographic fact.

The decisive change is **key custody**: ZK means the user holds the key; server-side
encryption means the operator holds the key.

### 9.2 Why Argon2id replaces scrypt (and when to migrate)

Both scrypt and Argon2id are **memory-hard key derivation functions (KDFs)** — they
deliberately make brute-force passphrase attacks expensive by requiring large amounts of RAM
to compute, so GPU/ASIC attacks are impractical.

**scrypt** (2009, Colin Percival): good, not broken, still used in Bitcoin and elsewhere.
**Argon2id** (2015, won the Password Hashing Competition): the current best practice and
OWASP/NIST recommendation. It combines two modes — Argon2i (resistant to side-channel timing
attacks) and Argon2d (maximally resistant to GPU/ASIC brute force) — giving the best of both.
It also has cleaner, more tunable parameters (time cost, memory cost, parallelism).

**Why Argon2id is better:** stronger side-channel resistance, cleaner tuning surface, and
it's what every current standard recommends for new password-based key derivation.

**Migration decision (you are the only user with two vaults):**

The straightforward answer for your situation: **yes, migrate to Argon2id — but do it as
part of building the ZK tier, not as a standalone patch.** Here's why they're bundled:

- The current scrypt use derives a key from `KNOWTATION_MEMORY_SECRET` server-side. Swapping
  scrypt for Argon2id there would still leave the server holding the key — a KDF upgrade
  without a key-custody change is cosmetic improvement, not an architectural one.
- The real upgrade is moving key derivation **client-side**: user types passphrase in the
  browser/companion, Argon2id runs on their device, key never transits the server. That is
  the ZK tier. Argon2id is naturally part of this design.
- For your two vaults: when the ZK tier is built, export (you already have GitHub backup),
  re-encrypt under the new ZK key hierarchy (client-side Argon2id + envelope encryption),
  and re-import. Clean cut, no in-place migration complexity.
- **Do not retroactively patch scrypt → Argon2id on the server-side path.** scrypt is not
  broken; patching it there adds complexity, risks a migration bug, and doesn't actually
  change the threat model. Build ZK right.

Recommended Argon2id parameters for the ZK tier (OWASP 2024):
`time_cost ≥ 3, memory_cost ≥ 64MB, parallelism = 4` (tune upward on capable devices).

### 9.3 The two-tier vault model (agreed direction)

Rather than forcing everyone into ZK (which breaks server-side features) or leaving everyone
on the convenience tier (which isn't truly private), offer **two vault modes**:

| Tier | Key custody | Server can read plaintext | Search/Enrichment/Discovery | Who it's for |
| --- | --- | --- | --- | --- |
| **Convenience** (current path) | Server holds key | Yes | Full server-side | Individuals who want zero friction |
| **Private (ZK)** | User holds key, client-side only | Never | **Client-side only** (in-browser / companion) | Privacy-focused individuals, orgs, classrooms with sensitive data |

Users choose per vault. The ZK tier is the privacy-focused org's selling point and aligns
directly with the companion app — ZK vaults *require* local compute, which is exactly what
the companion provides.

### 9.4 The ZK key hierarchy

```
User passphrase + salt
        │
        ▼  Argon2id (client-side only, never sent to server)
   Identity key (IK)
        │
        ├── wraps ──► DEK-vault (one per vault, random AES-256 key)
        │                   │
        │                   ├── encrypts ──► all notes in vault
        │                   └── wraps ──► per-note DEKs (for selective sharing)
        │
        └── wraps ──► DEK-memory (Discovery/consolidation events)
```

- **DEK (Data Encryption Key):** a random AES-256 key that encrypts actual content.
  Short-lived in RAM; stored only as a wrapped (encrypted) blob on the server.
- **Envelope encryption:** server stores `{ wrapped_DEK, ciphertext }`.
  To read: derive IK client-side → unwrap DEK → decrypt ciphertext. Server never sees IK or DEK.
- **Per-note DEKs:** enable sharing one note without exposing the whole vault (wrap the
  note's DEK to the recipient's public key).
- **Multi-device:** each device/passkey has its own keypair; the DEK is re-wrapped to each
  device's public key. Adding a device = client-side re-wrap. No plaintext key transits server.
- **Recovery:** a high-entropy recovery code (and optionally Shamir secret sharing) also
  wraps the IK. Hard truth of ZK: if all keys and recovery codes are lost, data is
  unrecoverable — the host genuinely cannot help.

### 9.5 Post-quantum hardening

**What is already safe:**

- **AES-256-GCM** (symmetric content encryption): safe. Grover's algorithm gives a quantum
  speedup for key search, but only halves the effective bit strength — 256-bit becomes
  ~128-bit quantum security, which remains computationally unbreakable. No change needed here.
- **Argon2id KDF**: not a quantum target (no known quantum speedup beyond minor constants).

**What is vulnerable (asymmetric crypto):**

- **RSA, ECC, X25519, Ed25519** — all rely on math (integer factoring, discrete logarithm)
  that Shor's algorithm solves efficiently on a large quantum computer.
- In the ZK design, the **DEK wrapping between devices and team members** uses asymmetric
  crypto (encrypt DEK to recipient's public key). This is the layer that needs post-quantum
  hardening for HNDL (Harvest Now, Decrypt Later) protection.

**FIPS 203/204/205 — the 2024 NIST post-quantum standards:**

These are the finalized, globally recognized post-quantum algorithms:

- **FIPS 203 (ML-KEM / Kyber)** — for key encapsulation (wrapping DEKs). Use **hybrid
  X25519 + ML-KEM-768**: combines classical X25519 with post-quantum ML-KEM so an attacker
  must break both to win. This is what TLS (`X25519MLKEM768`) is rolling out now. Applying
  it to DEK wrapping gives HNDL protection immediately on stored ciphertext.
- **FIPS 204 (ML-DSA / Dilithium)** — for signatures (provenance, attestation, Muse commit
  signing). Current Ed25519 is quantum-vulnerable; ML-DSA replaces it.
- **FIPS 205 (SLH-DSA / SPHINCS+)** — backup signature algorithm based on hash functions
  (completely different math from ML-DSA). Belt-and-suspenders if ML-DSA has a future weakness.

**Implementation rule:** use audited libraries (e.g. `noble-post-quantum`, or liboqs via
WASM). Never implement PQC primitives by hand. PQC keys and ciphertexts are larger than
classical equivalents (Kyber ciphertext ~1 KB, Dilithium signatures ~2–4 KB) — account for
this in storage and bandwidth.

**What ZK breaks / moves client-side:**

| Feature | Today (convenience tier) | ZK private tier |
| --- | --- | --- |
| Full-text search | Server-side | Client-side index in encrypted format, or trusted search via companion |
| Embeddings / vector search | Server-side | Client-side (in-browser/companion); encrypted vectors stored server-side |
| Enrichment / summaries | Server-side LLM | Client-side model (in-browser/companion); only ciphertext stored server-side |
| Discovery (`runDiscoverPass`) | Server-side | Client-side (companion); insight events stored encrypted |
| Sync / backup / GitHub export | Plaintext | Ciphertext (GitHub backup becomes encrypted) |
| Attestation / provenance | Content hashes + signatures | Content hashes (of ciphertext) + client-side signatures; server never hashes plaintext |
| Sharing (teams, mentors) | ACL on server | DEK wrapped to recipient's public key client-side; server relays ciphertext |

**ZK + teams:** sharing = wrapping a note's DEK to the recipient's ML-KEM public key
client-side. The server coordinates *who is allowed to request access*; cryptography enforces
it. **Revocation is forward-only** — you can re-key future content, but cannot un-decrypt what
was already shared and decrypted.

### 9.6 ML-DSA signature migration — sequencing with Muse

Ed25519 signatures are used across the Muse ecosystem for commit provenance, identity, and
MuseHub attestation. Migrating to ML-DSA (or hybrid Ed25519 + ML-DSA) is a **cross-product
coordinated change** — it must happen in Muse/MuseHub, and Knowtation/Scooling follow. The
correct trigger is **when Muse adds PQC signature support**, at which point all ecosystem
products upgrade together. Do not unilaterally change signatures in Knowtation alone; that
would create a provenance inconsistency.

**Right now: focus on DEK wrapping (hybrid X25519+ML-KEM).** This is the most urgent
HNDL-protection step, it's contained to the ZK tier, and it doesn't require cross-product
coordination. Signature migration follows when the Muse ecosystem is ready.

### 9.7 Migration path for existing vaults (you as the only user)

Since you are the sole user with two vaults and a GitHub backup:

1. When the ZK tier is built, **export vault content** (already have GitHub backup).
2. Re-encrypt under the new ZK key hierarchy on the client (Argon2id-derived IK,
   envelope-encrypted DEKs, hybrid ML-KEM wrapping for devices).
3. Re-import ciphertext to the canister. GitHub backup from this point = ciphertext.
4. **Discard the old `KNOWTATION_MEMORY_SECRET` server-side key** after confirming
   successful re-encryption. Remove it from Netlify env; it serves no purpose in ZK mode.
5. Store the Argon2id-derived recovery code somewhere physically secure (not a password
   manager alone — a passphrase-protected offline copy).

This is a clean cut with no in-place migration complexity. The only risk is doing step 4
before step 3 is verified — sequence carefully.

---

## 10A. Tenancy/teams (developed in conjunction — own design + gate)

Verified: the **owner + delegation** model already exists (`resolveEffectiveCanisterUser`,
`workspace_owner_id`), but the **hosted path stubs it** (`/api/v1/workspace` → `owner_user_id: null`,
invites "not supported on hosted yet", roles env-only). Two admins must be **separated**:

- **Platform operator** (`HUB_ADMIN_USER_IDS`) — global, rare, operator-only.
- **Workspace owner** — every user, auto-provisioned for their own workspace on first sign-in.

**Work to finish on hosted:** auto-provision workspace + owner on first sign-in; hosted per-workspace
role store; invites flow. Then a user is **owner of their own** and **member of others'**
(already supported by delegation). Security: auto-owner must never allow escalation into another
user's partition. This is its own design doc + authorization gate, Knowtation Muse-canonical.

---

## 10. Decisions to make in the dedicated session

1. Tenancy: auto-workspace-owner provisioning, hosted role store, invites — and the owner/member
   billing + consent rules.
2. Model routing: confirm the §4 lane matrix and defaults; decide whether to pull the
   **local-inference companion** forward (note: inference infra, **distinct from Unsloth training**).
3. Enrichment: confirm the §7.2 combination; confirm Discovery-as-upstream (§7.4); resolve the
   derived-artifact storage paradox (§8.2) per privacy tier.
4. Companion: packaging/distribution, localhost security model (§8.1), OAuth/PKCE confirmation.
5. **ZK tier design:** key hierarchy (§9.4), Argon2id parameters, hybrid X25519+ML-KEM-768 DEK
   wrapping, two-tier vault model (convenience vs ZK), vault migration for current single user (§9.7).
6. **PQC confirmations:** AES-256 stays unchanged; hybrid ML-KEM ships with ZK tier; ML-DSA
   signature migration deferred until Muse ecosystem quantum upgrade (cross-product coordination).
7. Update `docs/PHASE-3F-PATTERN-MAP-DESIGN.md` to consume Discovery/enrichment projections.

---

## 11. Sequencing & PR/push recommendation

- **Pause net-new Scooling *implementation*.** The Pattern Map now depends on tenancy + enrichment +
  Discovery decisions. The Scooling Phase 3F **design** stays as **NO-GO baseline** (PR #16 may remain
  open for review or land as a NO-GO baseline; do **not** start Pattern Map code yet).
- **Record this brief on Muse / MuseHub** via a Knowtation feature branch (`muse commit` →
  `muse push staging <branch>`). Do **not** open a docs-only GitHub PR to `main` (owner policy).
- **Do the dedicated Knowtation session** (tenancy + model routing + companion + enrichment/Discovery
  + ZK/PQC), each topic landing as design + gate before implementation.
- **Then return to Scooling** to: (a) update Phase 3F to consume Discovery/enrichment, (b) record the
  Pattern Map GO/NO-GO, (c) implement once the upstream rails exist.

---

## 12. Session prompt (copy for the dedicated session)

```text
Read docs/COMPANION-APP-MODEL-ROUTING-AND-ENRICHMENT-ARCHITECTURE.md in the Knowtation repo.
Goal: produce design docs + authorization gates (no implementation yet) for, in order:

(1) Hosted tenancy/teams: auto-provision workspace owner on first sign-in, hosted per-workspace
    role store, invites; separate platform-operator (HUB_ADMIN_USER_IDS) from workspace owner;
    define owner/member billing + consent; security: no cross-partition escalation.

(2) Model routing: confirm the lane matrix (managed cheap default + one-click on-device; org BYO/
    self-hosted; in-browser WebGPU; companion app); client-side-inference constraint; OAuth PKCE.
    Also add OpenRouter as an explicit provider lane in lib/llm-complete.mjs (OpenAI-compatible,
    OPENROUTER_API_KEY env, KNOWTATION_CHAT_PROVIDER=openrouter) and expose it in Hub Settings
    integrations UI alongside the existing DeepInfra/OpenAI/Anthropic/Ollama options. Low-risk
    addition — same wire format as DeepInfra; no downstream changes. Scooling's openrouter lane in
    runtimeLaneSchema already anticipates this; it gets the provider for free via ModelRuntimeAdapter.

(3) Companion app: tray/background helper = bridge + bundled local runtime; packaging; localhost
    endpoint security (token + Origin/host checks, DNS-rebinding defense); resolve derived-artifact
    storage paradox per privacy tier.

(4) Enrichment + Discovery: embeddings floor + lazy/cached/user-triggered enrichment with cheap
    models; Discovery (runDiscoverPass) as the upstream insight engine for Scooling's Pattern Map
    (open_questions/connections/topic_count); provenance + prompt-injection handling.

(5) Zero-knowledge + post-quantum: design the two-tier vault model (convenience vs ZK); Argon2id
    KDF client-side; envelope encryption key hierarchy; hybrid X25519+ML-KEM-768 DEK wrapping for
    HNDL protection; confirm AES-256-GCM unchanged; plan vault migration for current single user
    (export → re-encrypt under ZK hierarchy → re-import → retire server-side KNOWTATION_MEMORY_SECRET);
    confirm ML-DSA/Ed25519 signature migration is deferred pending Muse ecosystem quantum upgrade.
    Use audited libraries only (noble-post-quantum or liboqs/WASM); no hand-rolled PQC.

Constraints: Muse-canonical (no docs-only PR to main); no code until each gate is accepted; respect
PRIVACY-AND-SAFETY, data-lifecycle, audit/provenance, and prompt-injection threat model.
Then return to the Scooling session to update PHASE-3F-PATTERN-MAP-DESIGN.md to consume Discovery/
enrichment projections and record the Pattern Map GO/NO-GO.
```
