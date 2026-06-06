# Companion App — Phase 6: Derived-Artifact Storage & Provenance Enforcement Gate

**Status:** ✅ **IMPLEMENTATION LANDED 2026-06-06** — Design gate ratified by owner 2026-06-06;
implementation shipped on `feat/companion-app` in the same commit as this doc update. All D6.1–D6.7
decisions are realized. The 7-tier test suite (155 tests, 0 failures across unit/integration/e2e/
stress/data-integrity/performance/security) passes. The full repo suite is clean (3266/3267 pass;
1 pre-existing skip unrelated to Phase 6). See §10 for test obligations honored.

New modules shipped:
- `lib/companion-provenance-validator.mjs` — D6.2 provenance schema + validator
- `lib/companion-tier-resolver.mjs`        — D6.1 per-tier storage routing
- `lib/companion-client-encryptor.mjs`     — D6.4 ClientEncryptor hook (fail-closed default)
- `lib/companion-artifact-writer.mjs`      — D6.6 single DerivedArtifactWriter (authority group)

Migrated (D6.6.2 — direct write paths deleted):
- `mcp/tools/index-enrich.mjs`             — enrichIndexedNotes routes through writer
- `lib/memory-consolidate.mjs`             — runDiscoverPass routes through writer

**Remaining hard prerequisites (unchanged, NOT discharged here):** ZK key hierarchy + two-tier vault
registry (privacy_max fails closed); tenancy identity (cross-partition writes blocked). Phase 7
(packaging/signing) remains a separate, later gate.
**Branch:** `feat/companion-app` (Muse-canonical; paired with the Phase 1–5 code already on this
branch — **not** a docs-only PR to `main`, per the owner's no-docs-only-PR-to-`main` policy).
**Phase table ref:** Gate §12, Phase 6 ("Derived-artifact storage + provenance enforcement — per-tier
policy (§5), `generated_by`/`model`/`version`/`source_event_id` (§6), client-encryption hook for the
privacy-max/ZK tier"). Marked 🔀 Hybrid: design/spec the storage + provenance + encryption seam with a
thinking model (this gate), implement the body against the fixed contract with Sonnet/auto. The seam
is elevated reasoning because a wrong rule here is a **privacy breach** (host-readable privacy-max
artifact), a **multi-tenant policy defect** (a member's companion silently enriching an owner's
notes), or a **crypto-custody mistake** (server-held key masquerading as zero-knowledge).
**Depends on (all accepted):**
[`COMPANION-APP-DESIGN-AND-AUTHORIZATION-GATE.md`](COMPANION-APP-DESIGN-AND-AUTHORIZATION-GATE.md)
(§5 derived-artifact storage paradox, §6 provenance, §12 Phase 6, §13 Phase 0 **D1/D3**, the "DOES NOT
approve" list); Phase 1
([`COMPANION-APP-PHASE-1-ADAPTER-SEAM.md`](COMPANION-APP-PHASE-1-ADAPTER-SEAM.md),
`lib/model-runtime-lane.mjs` — `enforceConsentPolicy`, `isManagedLane`); Phase 5
([`COMPANION-APP-PHASE-5-BIND-GATE.md`](COMPANION-APP-PHASE-5-BIND-GATE.md),
`lib/companion-shell.mjs` — authority/runtime capability segregation D5.8, `companionAvailable` D5.7).
**Hard prerequisite (carried, NOT discharged here):** the **ZK key hierarchy** (brief §9.4: client-side
Argon2id → IK → DEK-vault/DEK-memory, envelope encryption) and the **two-tier vault registry** (brief
§9.3) are owned by the ZK tier and remain unimplemented. Phase 6 defines the **client-encryption hook
interface** and **fails closed** wherever a privacy-max artifact cannot be client-encrypted — it does
**not** build the key hierarchy.
**Related code (grounding, not assumptions):** `mcp/tools/index-enrich.mjs` (`ai_summary` →
`writeNote` frontmatter), `lib/tag-suggest.mjs` + `lib/vector-store.mjs` (embeddings),
`lib/memory-consolidate.mjs` (`runDiscoverPass` → `insight` event), `lib/memory.mjs` /
`lib/memory-event.mjs` (`createMemoryEvent`, `store`), `lib/memory-provider-encrypted.mjs`
(AES-256-GCM with **server-held** `KNOWTATION_MEMORY_SECRET` — encryption-at-rest, **not** ZK),
`hub/gateway/server.mjs` (`scopesForRole` → `vault:read`/`vault:write`),
`hub/gateway/billing-middleware.mjs` (`runBillingGate`).

---

## Simple summary

When the AI on your computer reads a note and produces by-products — a short summary, the math
"fingerprints" used for search (embeddings), little insight cards (connections, open questions), and a
label saying who/what made them — those by-products have to be **stored somewhere**. If the thinking
happened privately on your device but the by-products get saved to the cloud in plain text, your
private content has quietly leaked anyway. That is the trap this phase closes.

This document is the **rulebook for saving AI by-products**. It does not write the saving code. It
fixes six rules and argues each against an attacker:

- **Where each by-product is allowed to live, per privacy level.** Convenience users: cloud, as
  today. Privacy-max users: **never** something the cloud operator can read — either it stays on the
  device or it is locked with the user's own key before it is uploaded.
- **A stamp on every by-product** saying who made it, with which model and version, from which note
  and which source event, when, on which lane, and at which privacy level — so it can be trusted,
  audited, deleted, and re-made when the model is upgraded.
- **Who is allowed to save a by-product into someone else's notes.** A teammate's on-device AI can
  enrich your notes only if you already let them read those notes **and** you turned on "let my team
  enrich my notes" (off by default). A teammate can **never** quietly downgrade your privacy level.
- **A locked door for the privacy-max level.** Until the user-held-key system exists, a privacy-max
  by-product simply **cannot be saved** rather than being saved in the clear. No "temporary plain-text
  for now." Ever.
- **By-products die with their note.** Delete a note and its by-products are deleted too; in
  privacy-max, destroying the key makes them permanently unreadable (crypto-shred).
- **One single saving door,** built so the by-products cannot leak through any side path, the model
  process can never reach your saved data, and no secret ever lands in a log or an error.

## Technical summary

Phases 1–5 delivered the lane/consent decision core, the loopback/OAuth/runtime cores, and the Phase 5
bind contract — but every one of them stopped **short of writing a derived artifact**. Phase 5 §0
explicitly carried "new derived-artifact storage paths / encryption scheme" forward as **NOT lifted —
remains Phase 6.** This document is that gate. It ratifies seven decisions (**D6.1–D6.7**) over the
single new capability Phase 6 introduces — **persisting a derived artifact** — built strictly inside
the Phase 5 **authority group** (the runtime/inference group, D5.8, never writes; it only produces raw
bytes).

The decisions: **D6.1** per-tier, per-artifact storage location (binding routing, fail-closed);
**D6.2** the provenance schema (required fields, where stored, downgrade-safe, not a lifecycle state);
**D6.3** write-back authorization (reuse Phase 1 `enforceConsentPolicy`; preserve
`delegatedEnrichmentAllowed` default-OFF; owner's tier governs; no member silently enriching owner
partitions; no tier downgrade); **D6.4** the client-encryption hook interface (a `ClientEncryptor`
seam that **fails closed** for privacy-max when ZK keys are absent — no plaintext fallback, ever);
**D6.5** retention/deletion (artifacts inherit the source note's retention; delete-on-delete;
crypto-shred for privacy-max); **D6.6** the single-writer enforcement mechanism (object-capability:
exactly one derived-artifact writer, no bypass path, enforced by architecture tests); **D6.7**
provenance integrity + re-enrichment on model upgrade. Every decision defaults **fail-closed**; no
secret (DEK, IK, JWT, `KNOWTATION_MEMORY_SECRET`, loopback token) appears in any artifact, log, error,
or provenance field. The implementation that follows ships its own 7-tier suite before any merge to
`main`.

---

## 0. What this gate lifts — and what it deliberately does not

The design gate's ["DOES NOT approve (no code)"](COMPANION-APP-DESIGN-AND-AUTHORIZATION-GATE.md) list
named *"storing derived artifacts (`ai_summary`, embeddings, insight events) under any new storage path
or encryption scheme."* Phase 5 §0 reaffirmed it as **NOT lifted — remains Phase 6.** This gate lifts a
**bounded subset** of that item — and only that subset.

| Item from the design gate's "DOES NOT approve" list | Phase 6 disposition |
| --- | --- |
| Storing derived artifacts under a new storage path / encryption scheme | **LIFTED** for the **derived-artifact writer** specified in D6.1/D6.6, writing only to the **existing** stores (note frontmatter via `writeNote`, the vector store, the memory `insight` store) under the per-tier routing + provenance + consent contract below. **No new top-level store or table** is created. |
| New derived-artifact **encryption scheme** | **NOT lifted (interface only).** D6.4 defines the `ClientEncryptor` **hook interface** and the fail-closed contract. The actual ZK key hierarchy / envelope encryption (brief §9.4) is **NOT** built here — it remains the ZK tier's gate. Privacy-max writes **fail closed** until that lands. |
| Server-held-key memory encryption masquerading as ZK | **EXPLICITLY FORBIDDEN.** The existing `KNOWTATION_MEMORY_SECRET` AES-256-GCM path is **encryption-at-rest, not zero-knowledge** (brief §9.1, D3 technical summary). It does **not** satisfy privacy-max (D6.1, D6.4). |
| New canister routes / new Hub REST endpoints / wire-protocol changes | **NOT needed / NOT lifted.** Write-back uses the existing authenticated vault-write path (`vault:write` scope, `scopesForRole`). Phase 6 adds none. |
| Any change to OAuth client registration or scopes | **NOT lifted.** Write-back consumes the existing `vault:write` scope ceiling; it changes nothing server-side. |
| Shipping a companion binary / installer / auto-updater | **NOT lifted** — remains Phase 7. |
| Tenancy implementation (auto-owner provisioning, hosted role store, invites, effective/owner billing identity) | **NOT lifted — hard prerequisite** (gate §13 D1 outcome). A Phase 6 write to a **delegated** partition must not enable until the tenancy gate lands the effective/owner identity; until then D6.3 enables **only self-partition** derived-artifact writes. |

**Net:** Phase 6 means "a derived artifact may now be persisted, to the existing stores, under the
per-tier + provenance + consent + retention contract below, inside the authority group." It does
**not** mean "build the ZK key hierarchy," "create a new store," or "ship a product."

---

## 1. Adversarial threat model (the storage/write-back surface)

Phase 5 modelled the *bind/I-O* surface. Phase 6 adds the **persistence** surface: the moment a
private inference result becomes a stored byte. Each attacker is paired with the **exact Phase 6
control** that stops it, argued against the attacker — not pattern-matched.

| # | Attacker capability / failure | Exact Phase 6 control | Decision |
| --- | --- | --- | --- |
| **P6-a** | **The storage paradox**: inference runs privately on-device, but the `ai_summary`/embedding/insight is written to a **host-readable** location, so the private content leaves the device anyway. | Per-tier routing (D6.1): a privacy-max artifact is **only** ever written local-only or as ciphertext under a **user-held** key; a host-readable plaintext write for a privacy-max artifact is **structurally impossible** (single writer, D6.6) and **fails closed** if encryption is unavailable (D6.4). | D6.1, D6.4, D6.6 |
| **P6-b** | **Fake zero-knowledge**: a privacy-max artifact is "encrypted" with the **server-held** `KNOWTATION_MEMORY_SECRET`, which the operator can decrypt — privacy claim is false. | D6.1/D6.4 forbid server-held-key storage from satisfying privacy-max. Privacy-max requires the `ClientEncryptor` (user-held key); the existing at-rest path is recognized as **convenience-tier-only**. `privacy_tier=privacy_max` + server-held key is a rejected combination. | D6.1, D6.4 |
| **P6-c** | **Silent delegated enrichment**: a member's companion enriches an **owner's** notes and writes the artifact with no owner consent (the gate §12 canonical defect). | Every write-back passes Phase 1 `enforceConsentPolicy` with `enrichesDelegatedPartition=true` computed from "actor ≠ partition owner"; `local`/`openrouter` lanes are **denied** unless the owner set `delegatedEnrichmentAllowed` (default OFF). Fail-closed. | D6.3 |
| **P6-d** | **Tier downgrade**: a member (or a misrouted job) writes an owner's artifact at a **weaker** tier than the owner's vault (e.g. a ZK owner's summary stored host-readable because the member's device is convenience-tier). | D6.3: the artifact's `privacy_tier` is resolved from the **owner's** vault tier, never the actor's; a write that would downgrade is rejected fail-closed (D1.3(4)). | D6.2, D6.3 |
| **P6-e** | **Provenance forgery / omission**: an artifact lands with no/false `generated_by`/`model`, defeating audit, trust, and correct re-enrichment. | D6.2 requires a complete, validated provenance record as a **write precondition**; the single writer (D6.6) rejects any artifact missing a required field. Provenance is stamped by the authority group from trusted session/lane state, not from model output. | D6.2, D6.6, D6.7 |
| **P6-f** | **Secret leak into an artifact or its provenance** (note body fragment that is a secret, a token, the DEK, the memory secret, a JWT). | `createMemoryEvent` already rejects sensitive-key payloads (`hasSensitiveKeys`); D6.2 provenance carries **no** secret-bearing field by construction (no key material, no token); D6.6 logs fixed reason codes only. The note **body** is never copied verbatim into provenance. | D6.2, D6.6 |
| **P6-g** | **Orphaned artifact after note deletion**: the source note is deleted but its summary/embedding/insight lingers, readable, indefinitely. | D6.5: note-scoped artifacts inherit the source note's retention and are **deleted on note delete**; vector entries purged; for privacy-max, key destruction crypto-shreds them. Aggregate insights reference `source_event_id`s for invalidation/re-enrichment. | D6.5 |
| **P6-h** | **Bypass write path**: a code path persists a derived artifact directly to frontmatter/vector store/memory **without** going through routing, consent, provenance, or encryption. | D6.6: exactly **one** derived-artifact writer; an architecture/import test asserts no other module writes a derived artifact to any store; the existing `enrichIndexedNotes`/`runDiscoverPass` write paths are **migrated to route through the writer** (no parallel path). | D6.6 |
| **P6-i** | **Ambient-authority pivot from inference**: the runtime/inference group acquires the vault-write capability or the encryption key and writes/exfiltrates. | The **runtime group never writes** (Phase 5 D5.8): it returns raw bytes to the authority group, which alone holds `vault:write` and the `ClientEncryptor`. Re-asserted by the D6.6 architecture test (runtime-adapter module imports no writer/encryptor/canister module). | D6.6 (extends D5.8) |
| **P6-j** | **Plaintext fallback under failure**: encryption fails or keys are missing, and the system "helpfully" stores the privacy-max artifact in the clear so the feature still works. | D6.4: **no plaintext fallback, ever.** Encryption failure / absent key for a privacy-max artifact → the write **fails closed** (artifact dropped or queued local-only encrypted), surfaced as a recoverable error, never downgraded to plaintext. | D6.4 |
| **P6-k** | **Re-enrichment staleness / provenance drift**: model upgrades, but stale artifacts keep their old content with no record that a newer model exists, or re-enrichment silently rewrites provenance hiding the original generator. | D6.7: model/version in provenance triggers re-enrichment on upgrade; re-enrichment writes a **new** provenance record (new `created_at`, `model_version`) and is a **provenance flag, not a lifecycle state** (gate §6) — it never forces the note through the proposal pipeline. | D6.2, D6.7 |

---

## 2. Decision D6.1 — Per-tier, per-artifact storage location (binding routing)

> Question: for each derived artifact, where may it live under each privacy tier, and how is that
> enforced rather than merely documented?

### Verified state

Gate §5 + Phase 0 **D3** already fixed the **policy**: convenience artifacts may live host-readable in
the cloud as today; privacy-max artifacts are **local-only or client-encrypted under a user-held key
before upload — never host-readable plaintext, never under a server-held key.** Grounding on where the
artifacts live **today**:

- `ai_summary` → **note frontmatter** via `writeNote` (`mcp/tools/index-enrich.mjs`), so it inherits
  the note's own storage + sync path.
- Embeddings/vectors → the **vector store** (`lib/vector-store.mjs`, via `lib/tag-suggest.mjs`).
- Insight events (`connections`/`contradictions`/`open_questions`/`topic_count`) → a single **aggregate
  `insight` memory event** (`runDiscoverPass` → `mm.store('insight', …)`), persisted by the memory
  provider — which on the encrypted path uses **server-held-key** AES-256-GCM
  (`KNOWTATION_MEMORY_SECRET`), i.e. **encryption-at-rest, not ZK**.
- Discovery facets (the body-free projections Scooling's Pattern Map consumes, brief §7.4) are a
  read-projection of the insight event; they store nothing new and inherit the insight event's tier.

### Decision — **Routing table is binding; privacy-max never resolves to a host-readable or server-held-key location; resolution is fail-closed**

| Artifact | Convenience (server holds key) | Privacy-max / ZK (user holds key) |
| --- | --- | --- |
| **`ai_summary`** | Note frontmatter, host-readable, as today. | Frontmatter of a **client-encrypted note** (the whole note, frontmatter included, is ciphertext under the note/vault DEK) **or** a **local-only** summary cache. Plaintext `ai_summary` in a host-readable note is **forbidden**. |
| **Embeddings / vectors** | Cloud vector store, server-side index, as today. | Vectors **computed client-side** and stored server-side **only as ciphertext** (sync/backup), **or** kept **local-only**; **plaintext vectors never leave the device**; vector search runs client-side (brief §9.5). |
| **Insight events** (`runDiscoverPass`) | Memory store, as today — **including** the server-held-key AES-256-GCM at-rest path, which is acceptable **only** at convenience tier. | Computed client-side (companion); stored **client-encrypted under a user-held `DEK-memory`**; the **server-held-key path does NOT satisfy this tier** (brief §9.5). |
| **Discovery facets** (Pattern Map projection) | Read-projection of the insight event; no new storage; convenience tier. | Read-projection produced **client-side** from the decrypted insight event; never materialized host-readable. |

**D6.1.1 — Tier is resolved, not assumed.** The effective `privacy_tier` for a write is resolved from
the **owner's vault tier** in the two-tier vault registry (brief §9.3), **not** from the requesting
actor or the device. The registry is owned by the ZK tier (prerequisite). **Until the registry
exists**, the only resolvable tier is **convenience**, and any attempt to write a `privacy_max`
artifact **fails closed** (D6.4) — Phase 6 does not invent a tier source.

**D6.1.2 — Three legal terminal states only.** A derived-artifact write resolves to exactly one of:
**(a) host-readable** (convenience only), **(b) client-encrypted ciphertext under a user-held key**
(privacy-max), **(c) local-only** (either tier). There is **no fourth state**; in particular,
"server-held-key ciphertext" is classified as **(a) host-readable** for policy purposes (the operator
can decrypt) and is therefore **convenience-only**.

**D6.1.3 — Routing is centralized.** The mapping above is implemented in **one** resolver inside the
single writer (D6.6); no caller chooses a storage location directly. A caller supplies the artifact +
provenance; the resolver picks the terminal state from `privacy_tier` and fails closed on any
unmapped/ambiguous combination.

### Fail-closed

Unknown/unresolvable tier → treat as the **most restrictive** (privacy-max) → require client-encryption
→ if unavailable, **refuse the write**. A `privacy_max` artifact that resolves to host-readable or
server-held-key → **reject** (never write). Convenience is never assumed for an artifact whose owner
tier cannot be confirmed.

---

## 3. Decision D6.2 — Provenance schema (required fields, placement, semantics)

> Question: what provenance must every derived artifact carry, where is it stored, and what does it
> mean (and not mean)?

### Verified state

Gate §6 + brief §8.4 require `generated_by`, `model`, `version`, `date`, `source_event_id`, and that
provenance is a **flag, not a lifecycle state** (must not force notes through the proposal pipeline,
brief §7.3). D1.3(4) adds `source = companion` and the **owner's tier** for delegated writes. Today
`ai_summary` carries **no** provenance (it is a bare frontmatter string); insight events carry
`id`/`type`/`ts`/`vault_id` from `createMemoryEvent` but no model/lane provenance.

### Decision — **A single canonical provenance record, validated as a write precondition, stamped by the authority group**

**D6.2.1 — Required fields (every derived artifact, all tiers).** The write is **rejected** if any is
missing or malformed:

| Field | Type | Meaning / source of truth |
| --- | --- | --- |
| `generated_by` | string (actor id) | The authenticated actor whose session produced the artifact (the delegate's id for a delegated write, D1.3(4)). From the verified session, never from model output. |
| `source` | enum `companion`\|`in_browser`\|`managed`\|`self_hosted`\|`enterprise`\|`openrouter` | Origin of the inference, mapped from the selected lane. |
| `model` | string | Model identifier (e.g. the runtime model name). |
| `model_version` | string | Model version/tag. For local runtimes that expose no version, the **`runtime_version`** (runtime build) is recorded and `model_version` set to a pinned digest/tag — one of the two MUST be a concrete value; both-absent is rejected. |
| `runtime_version` | string \| null | Companion/runtime build identifier (null only for non-companion lanes that have no runtime build). |
| `lane` | enum (`RUNTIME_LANES`) | The `selectLane` result that served the call (`local`/`self_hosted`/…). |
| `privacy_tier` | enum `convenience`\|`privacy_max` | The **owner's** resolved vault tier (D6.1.1). Governs storage routing (D6.1) and encryption (D6.4). |
| `source_note_path` | string \| null | Vault-relative path of the single source note (note-scoped artifacts: `ai_summary`, that note's embedding). `null` for aggregate artifacts. |
| `source_event_id` | string \| string[] | The memory `source_event_id`(s) the artifact derives from. Single id for note-scoped; the set of consolidation event ids for an aggregate `insight`. |
| `created_at` | ISO-8601 string | Generation timestamp. (Reconciles gate §6 `date` → `created_at`.) |
| `artifact_type` | enum `ai_summary`\|`embedding`\|`insight`\|`discovery_facet` | Which artifact this provenance describes. |
| `schema_version` | integer | Provenance schema version, for forward-compatible migration. |

**D6.2.2 — Field-name reconciliation (binding).** This schema supersedes the looser gate §6 list:
`date` → `created_at`; `version` → `model_version` (+ `runtime_version`); adds `lane`, `privacy_tier`,
`source` (the prompt's required set). Implementations MUST use these names.

**D6.2.3 — No secret-bearing field, ever.** Provenance carries **no** key material, DEK, IK, JWT,
refresh/loopback token, `KNOWTATION_MEMORY_SECRET`, raw note body, or consent secret. `consentId` (if a
managed-lane write) is recorded as an **opaque reference id only**, never the underlying token. The
existing `hasSensitiveKeys` guard in `createMemoryEvent` applies to any provenance persisted as a
memory event; the writer applies the same scan to frontmatter/vector-sidecar provenance.

**D6.2.4 — Placement (follows the artifact's store, never a new top-level store).**
- `ai_summary`: provenance stored **adjacent in the note frontmatter** (e.g. an `ai_summary_provenance`
  object), so it inherits the note's tier/encryption exactly (host-readable at convenience; ciphertext
  inside an encrypted note at privacy-max).
- Embeddings: provenance stored in the vector store's **per-vector metadata sidecar** (or its encrypted
  equivalent at privacy-max).
- Insight events: provenance embedded in the **`insight` event payload** (already an object via
  `createMemoryEvent`), inheriting the memory store's tier (convenience: server-held-key at-rest;
  privacy-max: `DEK-memory`).

**D6.2.5 — Provenance is a flag, not a lifecycle state (gate §6 / brief §7.3, restated).** Stamping
provenance MUST NOT route a note into the proposal/review pipeline, change its status, or block reads.
It is descriptive metadata for trust, audit, deletion, and re-enrichment.

### Fail-closed

Any required field missing/malformed → **reject the write** (no partial artifact). Provenance fails the
secret scan → **reject**. `privacy_tier=privacy_max` with `source=managed` (a cloud lane produced a
privacy-max artifact) → **reject** as a contradiction (privacy-max never routes private text to a
managed lane, D2.3).

---

## 4. Decision D6.3 — Write-back authorization (owner/delegate; default-OFF; no downgrade)

> Question: who may write a derived artifact into which partition, and how is the
> "member silently enriching an owner's notes" defect kept closed at the storage layer?

### Verified state

Phase 1 `enforceConsentPolicy` already returns `lane_policy_denied` when
`isDelegate ∧ enrichesDelegatedPartition ∧ lane ∈ {local, openrouter} ∧ ¬delegatedEnrichmentAllowed`
(default OFF), and `cloud_consent_required` / `lane_policy_denied` for managed-lane delegate spend
(`delegatedManagedAllowed`). D1.2 sets the billing principal = **owner of the partition written**.
Today's enrichment writers (`enrichIndexedNotes`, `runDiscoverPass`) perform **no** authorization check
before writing — they assume a single-tenant local context. Write authority server-side is the
`vault:write` scope (`scopesForRole`).

### Decision — **Every write-back is gated by `enforceConsentPolicy`; the owner's tier governs; delegated writes stay default-OFF; tenancy is a hard prerequisite for cross-partition writes**

**D6.3.1 — The artifact write is the gated event (not just the inference).** Phase 1 fixed that the
consent gate applies when a call **writes a derived artifact to a partition the actor does not own**
(`enrichesDelegatedPartition=true`). Phase 6 makes the **writer** the enforcement point: before any
derived-artifact persist, the writer calls `enforceConsentPolicy({ lane, containsPrivateData,
consentId, isDelegate, delegatedManagedAllowed, enrichesDelegatedPartition, delegatedEnrichmentAllowed })`
and **persists only on `'allow'`**. `'lane_policy_denied'` and `'cloud_consent_required'` **abort the
write** (surfaced as permission / consent messages respectively, per Phase 1 §2.1).

**D6.3.2 — `enrichesDelegatedPartition` is computed, not trusted.** It is `true` iff the resolved
**owner** of the target partition (`resolveEffectiveCanisterUser` → `effective`) differs from the
authenticated actor (`generated_by`). Self-partition writes (`owner == actor`) set it `false` and are
allowed without the delegated-enrichment opt-in (the actor owns the data).

**D6.3.3 — `delegatedEnrichmentAllowed` stays default-OFF (preserved, not weakened).** Phase 6 changes
**nothing** about the Phase 0/Phase 1 default-OFF posture. A member's companion (`local`) or BYO
(`openrouter`) lane producing an owner-partition artifact is **denied** until the owner flips the
workspace opt-in. This is the storage-layer realization of the gate §12 canonical defect closure —
**no member companion silently enriches owner partitions**, because the **write itself** is blocked,
not merely the inference.

**D6.3.4 — Owner's tier governs; no downgrade (D1.3(4)).** The artifact's `privacy_tier` (D6.2) is the
**owner's** vault tier, resolved at write time (D6.1.1). A delegated write **cannot** select a weaker
tier than the owner's: a ZK owner's artifact is stored client-encrypted **even though a member
generated it on a convenience-tier device**. A write that would downgrade is **rejected**.

**D6.3.5 — Reading is free; producing is gated (D1.4).** Members may **read** an owner's already-stored
derived artifacts subject to their `vault:read` scope. Phase 6 gates only **production/persistence**,
consistent with D1.4.

**D6.3.6 — Cross-partition writes require the tenancy gate (hard prerequisite).** Until the tenancy
implementation lands the **effective/owner identity** and hosted role store (gate §13.2), the writer
**enables only self-partition writes** (`enrichesDelegatedPartition` can only be `false`). A delegated
derived-artifact write is **disabled** rather than guessed — matching D1.2's "delegated managed-lane
and metered ops are not enabled" until the owner billing identity exists.

### Fail-closed

`enforceConsentPolicy` returns anything but `'allow'` → **no write.** Owner tier unresolvable →
treat as privacy-max → D6.4 path (fail closed if no encryptor). Delegate status ambiguous → treat as
delegate (`isDelegate=true`, `enrichesDelegatedPartition=true`) → require the owner opt-in → deny if
absent. Tenancy identity absent → only self-partition writes permitted.

---

## 5. Decision D6.4 — Client-encryption hook interface (privacy-max; fail-closed; no plaintext fallback)

> Question: since the ZK key hierarchy is **not** implemented, what interface does the privacy-max
> write depend on, and what happens when it cannot encrypt?

### Verified state

Brief §9.4 owns the ZK key hierarchy (client-side Argon2id → IK → DEK-vault/DEK-memory, envelope
encryption, hybrid X25519+ML-KEM-768 wrapping) and is **explicitly deferred** (gate §13.3, brief §9.7);
**none of it is implemented.** Today the only encryption is `EncryptedFileMemoryProvider` with a
**server-held** key — disqualified for privacy-max (D6.1.2). Phase 6 must therefore define an
**interface seam** and a **fail-closed** contract, not an implementation.

### Decision — **Define the `ClientEncryptor` hook; privacy-max writes require it; absence/failure fails closed; never a plaintext fallback**

**D6.4.1 — The hook interface (interface only; no key code here).** Privacy-max persistence depends on
an injected capability with exactly this shape (named, not built):

```text
ClientEncryptor (held ONLY by the authority group; never by the runtime group)
  isAvailable(tier, scope) -> boolean
      // true only when a USER-HELD key for this vault/memory scope is unlocked in this
      // process (client-side). Always false at convenience tier and whenever the ZK
      // hierarchy is absent or locked. Fail-closed default: false.
  encrypt(plaintextBytes, { scope, aad }) -> { ciphertext, wrappedDekRef, alg }
      // Envelope-encrypt under the user-held DEK for `scope` (vault | memory).
      // Returns ciphertext + a reference to the wrapped DEK; NEVER returns key material.
  // No decrypt() here — reads/decryption are the client/ZK tier's concern, out of scope.
```

The encryptor is **opaque** to Phase 6: it does not expose keys, never logs, and is the **only** thing
that can turn a privacy-max artifact into a storable byte. Phase 6 calls `isAvailable` then `encrypt`;
it never inspects key material.

**D6.4.2 — Privacy-max write algorithm (binding).**
1. Resolve `privacy_tier` (D6.1.1). If `convenience` → store host-readable per D6.1 (no encryptor
   needed).
2. If `privacy_max`: require `ClientEncryptor.isAvailable(tier, scope) === true`. If **false** (no ZK
   tier, locked key, wrong device) → **fail closed**: do **not** store host-readable; either **drop**
   the artifact (re-derivable later) or **queue it local-only as ciphertext** if a local key is
   present — **never** plaintext to a host-readable store.
3. If available: `encrypt(...)`, then store **only** the returned ciphertext + `wrappedDekRef` +
   provenance. The host sees ciphertext; it cannot read the artifact (brief §9.1 ZK property).

**D6.4.3 — No plaintext fallback, ever (Rule #1 / hard constraint).** There is **no** code path in
which a privacy-max artifact is written in the clear "for now," "temporarily," or "until ZK ships." A
privacy-max write with no available encryptor is a **fail-closed no-op-plus-error**, surfaced as a
recoverable state ("enable your private-vault key to enrich"), exactly mirroring Phase 5 D5.3's
"locked keychain means re-auth, not store insecurely."

**D6.4.4 — Algorithm agility / forward-compat.** The `alg` field and `schema_version` (D6.2) record the
envelope scheme so the ZK tier can introduce hybrid X25519+ML-KEM-768 DEK wrapping (brief §9.5) without
breaking stored artifacts. Phase 6 fixes the **seam**, not the algorithm.

**D6.4.5 — Capability custody.** The `ClientEncryptor` lives in the **authority group** (Phase 5 D5.8)
alongside the keychain/session controller. The **runtime/inference group never holds it** — it cannot
encrypt, cannot decrypt, and cannot write. Re-asserted by the D6.6 architecture test.

### Fail-closed

No encryptor / `isAvailable=false` for privacy-max → **no host-readable write** (drop or local-only
ciphertext). Encrypt throws → abort the write, fixed reason code, artifact not persisted. Convenience
tier never invokes the encryptor (and must never be silently "upgraded" to skip it — tier is the
owner's, D6.3.4).

---

## 6. Decision D6.5 — Retention & deletion (inherit source; delete-on-delete; crypto-shred)

> Question: how long do derived artifacts live, and what happens when the source note is deleted or
> the key is destroyed?

### Verified state

Gate §5/D3.4 baseline: derived artifacts inherit the **source note's** retention; deleting a note
deletes its derived artifacts; destroying the key crypto-shreds privacy-max artifacts. Today the memory
provider supports `clearEvents`/`pruneExpired` and `ttl` per event (`createMemoryEvent`), and
frontmatter `ai_summary` lives and dies with the note file. Vector entries are keyed by note path
(`lib/vector-store.mjs`). Detailed minors/classroom lifecycle is deferred (gate §11).

### Decision — **Note-scoped artifacts inherit the note 1:1 and are deleted on delete; aggregate artifacts are invalidated/re-derivable; privacy-max destruction is crypto-shred**

**D6.5.1 — Note-scoped artifacts (`ai_summary`, that note's embedding) inherit the source note.** They
carry the note's retention exactly. **Deleting the note deletes them**: `ai_summary` vanishes with the
frontmatter; the note's **vector entry is purged** from the store (keyed by `source_note_path`). No
orphan survives the note (P6-g).

**D6.5.2 — Aggregate artifacts (`insight` events, discovery facets) are bound to the memory partition
and reference, don't own, their sources.** An insight derived from 50 notes is **not** deleted when one
source note is deleted (it was never that note's property). Instead: deleting a source note marks the
insight's affected `source_event_id`(s) **stale** (the existing `runVerifyPass` stale-reference
mechanism), flagging it for **re-enrichment** (D6.7) rather than deletion. The insight event follows
the **memory partition's** retention (`ttl`/`pruneExpired`).

**D6.5.3 — Crypto-shred for privacy-max (the strong deletion).** For privacy-max artifacts, destroying
the user-held key (`DEK-vault`/`DEK-memory` or the IK that wraps them) renders **all** ciphertext
artifacts permanently unreadable — deletion-by-key-destruction (brief §9.4 "hard truth of ZK"). This is
the privacy-max guarantee that plaintext deletion cannot match: even un-garbage-collected ciphertext is
inert. The writer records `wrappedDekRef` (D6.4) so a per-scope key destruction shreds exactly the
intended artifacts.

**D6.5.4 — Deletion is also a single-path operation.** Derived-artifact deletion routes through the
**same single writer/owner** (D6.6) so that a delete cannot be partial (frontmatter cleared but vector
left behind). One delete call → all stores for that note/scope.

**D6.5.5 — Deferred (not Phase 6 blockers).** Minors/classroom stricter retention and legal-hold/export
semantics remain the deferred consent/data-lifecycle item (gate §11). D6.5.1–D6.5.3 are the **safe
baseline** until that lands.

### Fail-closed

Deletion that cannot confirm removal from **every** store for a note → reported as **failed/partial**,
retried; never silently treated as complete. Crypto-shred where the key cannot be confirmed destroyed →
surfaced, not assumed.

---

## 7. Decision D6.6 — Single derived-artifact writer (object-capability enforcement)

> Question: what mechanism guarantees that **every** derived-artifact persist (and delete) goes through
> routing + consent + provenance + encryption — with no bypass?

### Verified state

Phase 5 D5.8 established object-capability segregation (authority group holds secrets/handles; runtime
group holds none) and enforced it with an architecture/import test. Today, **two** independent write
paths exist with **no** gate: `enrichIndexedNotes` (frontmatter) and `runDiscoverPass` (memory). A new
unguarded third path (vectors) would reintroduce P6-h.

### Decision — **Exactly one `DerivedArtifactWriter` in the authority group; all stores reached only through it; enforced by architecture tests, not convention**

**D6.6.1 — One writer, one delete path.** A single `DerivedArtifactWriter` capability (authority group)
is the **only** module that may persist or delete a derived artifact in **any** store (frontmatter via
`writeNote`, vector store, memory `insight`). Its `write(artifact, provenance, context)` performs, in
order: **(1)** provenance validation (D6.2) → **(2)** tier resolution (D6.1.1) → **(3)**
`enforceConsentPolicy` (D6.3) → **(4)** encryption routing (D6.4) → **(5)** terminal-state store
(D6.1.2). Any step failing → **no write**, fixed reason code.

**D6.6.2 — Existing writers are migrated, not duplicated.** `enrichIndexedNotes` and `runDiscoverPass`
are **refactored to call the writer** for persistence; their direct `writeNote`/`mm.store('insight', …)`
calls are **removed** (no parallel path). Per the MuseHub/Knowtation "delete on sight" posture, the old
direct-write code is deleted, not left as a fallback.

**D6.6.3 — Runtime group cannot write (extends D5.8).** The `DerivedArtifactWriter`, the
`ClientEncryptor`, and the `vault:write` session live in the **authority group**. The runtime/inference
group returns **raw artifact bytes** to the authority group and holds **no** reference to the writer,
encryptor, canister, or vault client. An **architecture/import test** asserts the runtime-adapter module
and `companion-runtime-manager` import **none** of `{ derived-artifact writer, client-encryptor,
write.mjs, vector-store, memory writer, canister/vault client }`.

**D6.6.4 — No-bypass test (build-blocking).** A repository-wide test asserts that **no module other than
the writer** calls `writeNote` with a derived-artifact frontmatter field, `mm.store('insight', …)`, or a
vector-store upsert for a derived artifact. If a refactor introduces a second path, the test **fails the
build** — the merge is blocked, not shipped with a warning (mirrors D5.8's posture).

### Fail-closed

Any store reachable without the writer → architecture test fails the build. Writer step failure →
artifact not persisted. Ambiguity about which store an artifact belongs to → reject (the writer owns the
mapping, D6.1.3).

---

## 8. Decision D6.7 — Provenance integrity & re-enrichment on model upgrade

> Question: how does provenance stay trustworthy over time, and how is re-enrichment handled without
> hiding history or triggering the proposal pipeline?

### Verified state

Gate §6 / brief §8.4: record `model`/`version`/`date`; **re-enrich when the model upgrades**;
provenance is a flag, not a lifecycle state. `runVerifyPass` already detects stale references.

### Decision — **Re-enrichment writes a fresh provenance record; never rewrites history silently; never a lifecycle state**

**D6.7.1 — Upgrade trigger.** When the active model/runtime version (D6.2 `model_version`/
`runtime_version`) is newer than an artifact's recorded version, the artifact is eligible for
re-enrichment. Eligibility is **advisory** (a flag), batched per the brief §7.2 lazy/cached strategy —
it does **not** force immediate recompute.

**D6.7.2 — Re-enrichment is a new write through the single writer (D6.6).** It produces a **new**
provenance record (new `created_at`, new `model_version`, same `source_note_path`/`source_event_id`),
subject to the **same** consent gate (D6.3) and tier routing (D6.1). It replaces the artifact content
but the new provenance truthfully records the **current** generator — it never forges the original.

**D6.7.3 — Provenance integrity binding.** Provenance binds to the artifact it describes (co-located per
D6.2.4) and, at privacy-max, is encrypted with it (so provenance is not a host-readable side channel
about a private artifact). A privacy-max artifact's `generated_by`/`source_note_path` are **not** stored
host-readable.

**D6.7.4 — Still a flag, not a lifecycle state (gate §6, restated and locked).** Re-enrichment MUST NOT
push the note into the proposal/review pipeline, change note status, or gate reads. It is a derived
metadata refresh.

### Fail-closed

Version unknown/unparseable → treat artifact as **eligible** for re-enrichment (safe: recompute rather
than trust stale) but never block reads. Re-enrichment write fails the consent/tier/encryption gates →
the **existing** artifact is retained unchanged (no destructive half-write).

---

## 9. How Phase 6 discharges the prior phases' deferred obligations

| Source obligation | Discharged by |
| --- | --- |
| Design gate §5 / Phase 0 **D3** — per-tier derived-artifact storage policy | D6.1 (binding routing, fail-closed; server-held-key ≠ privacy-max) |
| Design gate §6 / brief §8.4 — provenance fields + "flag not lifecycle state" + re-enrich on upgrade | D6.2 (canonical schema), D6.7 (re-enrichment) |
| Phase 0 **D1.3(4)** — delegated write records `generated_by`/`source`/owner-tier; no downgrade | D6.2, D6.3.4 |
| Phase 0 **D1.3(2)** / Phase 1 `enforceConsentPolicy` — member companion may not silently enrich owner notes | D6.3 (the **write** is the gated event; default-OFF preserved) |
| Phase 5 §0 — "new derived-artifact storage paths / encryption scheme … remains Phase 6" | This gate (bounded subset, §0) |
| Phase 5 **D5.8** — object-capability segregation (runtime group holds no authority) | D6.6.3 (runtime group cannot write; encryptor/writer authority-only) |
| Brief §9.4/§9.5 — privacy-max client-encryption (ZK) | D6.4 **interface only**; ZK key hierarchy remains the ZK tier's gate (hard prerequisite) |
| Gate §11 — retention/deletion of `ai_summary`/embeddings/insight | D6.5 (safe baseline; minors/classroom still deferred) |

**Remaining external dependencies (NOT discharged here):** the **ZK key hierarchy + two-tier vault
registry** (brief §9 — required before any *real* privacy-max write; until then privacy-max **fails
closed**) and the **tenancy implementation** (effective/owner identity — required before any *delegated*
write; until then only self-partition writes enable). Both are pre-existing hard prerequisites, not new.

---

## 10. 7-tier test obligations (Phase 6 derived-artifact storage layer)

Aaron's Rule #0. The prior phases' suites do **not** absolve the storage/write-back layer of its own
tests. Before any merge to `main`, the Phase 6 implementation ships all seven tiers:

| Tier | Focus |
| --- | --- |
| **Unit** | Provenance schema validation (every required field; reject missing/malformed; `model_version`-or-`runtime_version` rule); tier resolver (D6.1) incl. fail-closed unknown→privacy-max; `ClientEncryptor.isAvailable=false`→no host-readable write; routing table maps each artifact×tier to the correct terminal state; `enrichesDelegatedPartition` computation (owner≠actor). |
| **Integration** | Writer pipeline end-to-end: validate→resolve tier→`enforceConsentPolicy`→encrypt→store, across `ai_summary`/embedding/insight; migrated `enrichIndexedNotes`/`runDiscoverPass` route through the writer; convenience write lands host-readable with provenance; privacy-max write lands ciphertext + `wrappedDekRef`, never plaintext. |
| **End-to-end** | Sign in → local inference (Phase 5) produces a summary → writer persists per owner tier; delegated-enrichment denied without `delegatedEnrichmentAllowed`, allowed with it; convenience vs privacy-max branch; note delete removes summary + vector (+ insight stale-flagged). |
| **Stress** | High-volume concurrent writes across all three stores; large embedding batches to the writer; many delegated-write authorization checks; deletion fan-out across stores under load; no partial/half-write under contention. |
| **Data-integrity** | Provenance round-trips intact and co-located with its artifact; no orphan after note delete (P6-g); crypto-shred renders privacy-max ciphertext unreadable; aggregate insight stale-flag + re-enrichment preserves `source_event_id` history; re-enrichment never destroys the prior artifact on a failed gate. |
| **Performance** | Writer overhead bound per artifact; tier-resolution + consent-gate cost; encryption hook latency budget; deletion fan-out latency; no event-loop starvation on batch enrichment. |
| **Security (centerpiece)** | **No privacy-max artifact ever written host-readable or under the server-held key** (P6-a/P6-b); **no plaintext fallback** when encryption unavailable (P6-j); delegated write **fail-closed** without owner opt-in (P6-c); **no tier downgrade** by a delegate (P6-d); provenance cannot be forged/omitted (P6-e); **no secret** in any artifact, provenance field, log, or error (P6-f); **single-writer no-bypass** architecture test build-blocking (P6-h); runtime group imports no writer/encryptor/vault module (P6-i, extends D5.8); convenience never silently masquerades as privacy-max and vice-versa; global fail-closed posture. |

---

## 11. Constraints honored

- **Decisions only — no storage/writer/encryption code.** This document fixes the contract; it writes
  none.
- **Muse-canonical**, on `feat/companion-app`, paired with the Phase 1–5 code already there — **not** a
  docs-only PR to `main`.
- **No host-readable privacy-max derived artifacts** (D6.1); **server-held-key ≠ ZK** (D6.1.2/D6.4).
- **No temporary plaintext fallback** for privacy-max, ever (D6.4.3 / Rule #1).
- **`delegatedEnrichmentAllowed` default-OFF preserved**; **no member companion silently enriching owner
  partitions** (D6.3) — the **write** is the gated event.
- **Client-encryption is an interface only** (D6.4); the ZK key hierarchy (brief §9) is a hard
  prerequisite, **not** built here; privacy-max **fails closed** until it lands.
- **Derived artifacts inherit source-note retention; delete-on-delete; crypto-shred** (D6.5).
- **No secret in any artifact, provenance field, log, or error** (D6.2.3, D6.6); **no ambient authority**
  — the runtime/inference group cannot write (D6.6.3, extends Phase 5 D5.8).
- **Fail-closed on every ambiguous point** (tier, consent, encryption, delegation, deletion).
- **No assumptions stated as fact** — every cross-reference is anchored to a verified file/section in
  the gate, the brief, or Phases 1–5 code.
- **No new store/table, no new canister/Hub route, no OAuth scope change, no GitHub mirror/deploy**;
  packaging/signing remain Phase 7.

---

## 12. Approval table

| Decision | Recommendation | Owner approval |
| --- | --- | --- |
| **D6.1** — per-tier/per-artifact storage routing; privacy-max never host-readable / never server-held-key; three terminal states; centralized fail-closed resolver | **CONFIRM (locks D3 per-artifact)** | ✅ approved 2026-06-06 |
| **D6.2** — canonical provenance schema (required fields incl. `generated_by`/`model`/`model_version`\|`runtime_version`/`lane`/`privacy_tier`/`source_note_path`/`source_event_id`/`created_at`); validated as write precondition; no secret-bearing field; flag-not-lifecycle | **ACCEPT** | ✅ approved 2026-06-06 |
| **D6.3** — write-back authorization via `enforceConsentPolicy`; `delegatedEnrichmentAllowed` default-OFF preserved; owner's tier governs, no downgrade; cross-partition writes gated on the tenancy prerequisite | **ACCEPT** | ✅ approved 2026-06-06 |
| **D6.4** — `ClientEncryptor` hook **interface only**; privacy-max requires it; **no plaintext fallback**; fail-closed when ZK keys absent; algorithm-agile | **ACCEPT** | ✅ approved 2026-06-06 |
| **D6.5** — note-scoped artifacts inherit + delete-on-delete; aggregate insights invalidated/re-derivable; crypto-shred for privacy-max; single-path deletion | **ACCEPT** | ✅ approved 2026-06-06 |
| **D6.6** — single `DerivedArtifactWriter` in the authority group; existing writers migrated (old paths deleted); runtime group cannot write; no-bypass architecture test build-blocking | **ACCEPT** | ✅ approved 2026-06-06 |
| **D6.7** — re-enrichment writes fresh provenance (no silent rewrite); provenance integrity bound + encrypted at privacy-max; flag-not-lifecycle | **ACCEPT** | ✅ approved 2026-06-06 |

On owner approval of D6.1–D6.7, the **Phase 6 implementation** (the `DerivedArtifactWriter`, provenance
schema, per-tier routing, `ClientEncryptor` seam, retention/deletion, and the migration of the existing
enrichment/discovery writers) is unblocked — itself gated on the §10 7-tier test obligation before any
merge to `main`. The **ZK key hierarchy** (brief §9) and the **tenancy implementation** (effective/owner
identity) remain hard prerequisites for *real* privacy-max and *delegated* writes respectively; Phase 6
**fails closed** in their absence. **Phase 7** (packaging/signing/notarization/auto-update) remains a
separate, later gate and is **not** approved by this document.
