# Media Write Surfaces — Canonical Contract (Phase 2F-b-d-kn, Step 2F-b-d-kn-a)

Status: **Contract frozen (2F-b-d-kn-a Thinking, 2026-07-02).** Two canonical **write** surfaces —
`media_external_link` and `media_attach` — as a **typed facade over the existing Knowtation
`/proposals` lifecycle (SD-4 — *not* a new write path)** plus a per-vault connector allowlist and an
import-consent chain. This is the **companion canonical surface** required by Scooling
`docs/MEDIA-EXTERNAL-LINK-AND-ATTACH-CONTRACT-2F-d.md` §6 (driving requirement). **No
implementation, no routes, no posture flip in this step.** Mechanical implementation is
**2F-b-d-kn-b (Auto)** on branch `feat/phase-2f-b-d-kn-media-write-surfaces`. Hub enablement is **two
separate gates** (`MEDIA_EXTERNAL_LINK_ENABLED`, `MEDIA_ATTACH_ENABLED`), each the **canonical-first**
prerequisite for a **separate** Scooling Tier 3 session (2F-b-d-e external link, 2F-b-d-f attach) —
**never bundled**.

Related:

- `docs/ATTACHMENT-STORE-CONTRACT-2F-b.md` — canonical attachment **read** model (§1 record, §1.1 id
  derivation, §2 policy overlay, §6 Scooling mapping, §7 scope inheritance, §8 fail-closed,
  SEC-A-05 no-SSRF). This contract **extends** it with writes and a fourth derivation source.
- `docs/TASK-WRITE-PROPOSAL-CONTRACT-2G-d.md` — **SD-4 parity reference** (propose → evaluate →
  approve → apply; server-stamped `proposal_kind`; optimistic concurrency; deny-by-default
  scope×role; apply reconciliation; Tier 3 checklist shape). This contract mirrors it verbatim in
  structure.
- `docs/PROPOSAL-LIFECYCLE.md` — states/roles/`base_state_id` (`kn1_` FNV-1a), evaluation gate
  (`HUB_PROPOSAL_EVALUATION_REQUIRED`), `source`, `review_queue`.
- `scooling/docs/MEDIA-EXTERNAL-LINK-AND-ATTACH-CONTRACT-2F-d.md` — **driving consumer** (§2/§3
  method rules, §4 result types, §5 wire mapping, §6 canonical boundary, §7 fail-closed, §9 two Tier
  3 checklists). This document is the canonical half named there.
- `docs/SPEC.md` §2.4 — note frontmatter `attachments[]` (Mist blob ids) — the `media_attach` apply
  target.
- `docs/FLOW-AUTHORING-WRITEBACK-CONTRACT-7A-L1.md` — SD-4 facade precedent (`flow-authoring.mjs`).
- `lib/attachments/attachment-store.mjs`, `lib/attachments/attachment-handlers.mjs`,
  `lib/attachments/attachment-store-file.mjs` (2F-b-b, live) — the read store this write path joins.
- `lib/note-state-id.mjs` — `stableStringify`, `kn1_` / `absentNoteStateId()` reused for concurrency.
- `mcp/resources/image-fetch.mjs` — the SSRF-safe fetcher that this write path **never** invokes.
- `docs/openapi.yaml` — Hub wire shapes land **in the same change as the routes** (2F-b-d-kn-b).

**Scope fence (2F-b-d-kn-a):** proposal kinds + request/response shapes + connector-allowlist store +
import-consent store/lifecycle + scope×role write authority + review-before-write lifecycle +
optimistic concurrency + apply reconciliation + no-SSRF fence + read-model extension (fourth source)
+ posture/gating + Scooling consumer mapping + error taxonomy + seven-tier test matrix names +
OpenAPI shapes + two independent Hub-enablement checklists **only**. **Not** in scope: any
`lib/attachments/attachment-write.mjs` implementation, Hub routes, CLI/MCP wiring, OpenAPI edits
(land **with** routes in 2F-b-d-kn-b), Scooling changes, byte import/mirroring, detach/unlink, OCR,
and any posture flip (`MEDIA_EXTERNAL_LINK_ENABLED` / `MEDIA_ATTACH_ENABLED` stay **off**).

**Posture (unchanged this step):** `MEDIA_EXTERNAL_LINK_ENABLED = off` and `MEDIA_ATTACH_ENABLED =
off` (default). Read-only attachment list/get (2F-b-b) is unchanged and independent. Scooling
`MEDIA_EXTERNAL_LINK_AUTHORIZED` / `MEDIA_ATTACH_AUTHORIZED` stay hard-`false`.

---

## Simple summary

Today Knowtation can *list* your photos, videos, and files safely, but it cannot *add* anything. This
document is the safe blueprint for two new abilities, each behind its own lock:

1. **Link an external item** — record a pointer to a photo or video that lives in another cloud
   (Google Drive, Dropbox, an iCloud share) **without copying the file** and **without ever opening
   the link**. Knowtation only stores an opaque handle for a connector you have already approved —
   after you consent to the import and a human reviews the proposal. No password, token, or web
   address is ever stored or fetched.

2. **Attach a media item to a note** — link a media item you can already see to one of your notes.
   Nothing edits the note directly; a **proposal** is submitted, and the note only changes after a
   human approves it — exactly how notes, Flows, and tasks already change.

Both abilities reuse the same review-before-write machinery the rest of Knowtation uses; nothing is
written to your vault until a human approves. Everything stays off until two *separate* explicit
authorizations turn them on one at a time — never together. The rule that never bends: external
links are references, not fetches; the server never reaches out to an arbitrary URL.

## Technical summary

Two canonical writes, each a **typed facade over `/proposals` (SD-4)** — no new write path, no direct
canonical mutation at propose time. `handleMediaLinkProposeRequest` validates an allowlisted
`connector_id` + opaque `opaque_ref` (**never dereferenced/fetched — SSRF-safe**), verifies an active
`knowtation.media_import_consent/v0`, resolves scope×role write authority server-side, then creates a
standard proposal with `source: "media"`, server-stamped `proposal_kind: media_external_link`, and
`media_meta` for apply routing. `handleMediaAttachProposeRequest` creates a `media_attach` proposal
carrying the target note `base_state_id` (`kn1_`). Approve → apply is the **same** machinery notes,
Flows, and tasks use: `reconcileApprovedMediaProposal` upserts a credential-free external reference
into `hub_attachment_external_refs.json` (a **fourth derivation source**, `source: connector_ref`,
surfaced by the 2F-b read store) for external links, or edits the target note's frontmatter
`attachments[]` for attach. Two **independent** Hub gates (`MEDIA_EXTERNAL_LINK_ENABLED`,
`MEDIA_ATTACH_ENABLED`) default **off**. Self-hosted Hub only in v0 (calendar/task/attachment
parity); hosted gateway proxy deferred.

---

## 0. Design decisions (recorded — Tier 2)

> **KN-MD-1 — Media writes reuse SD-4.** `media_external_link` and `media_attach` create standard
> Knowtation proposals with `source: "media"`, server-stamped `proposal_kind`, and `media_meta` for
> apply routing. Review, evaluation, approve, apply, and the `base_state_id` optimistic-concurrency
> check are the **same** machinery notes, Flows, and tasks use. The external-reference store and note
> frontmatter change **only** on approve→apply — never at propose time. *Rationale:* one audited
> review path; no duplicated approve/apply logic; adapters never write canonical knowledge directly.
> Parity with SD-4, `FLOW-AUTHORING-WRITEBACK-CONTRACT-7A-L1.md`, and
> `TASK-WRITE-PROPOSAL-CONTRACT-2G-d.md`. Mirrors Scooling **MD-1**.

> **KN-MD-2 — Connectors are server-side, allowlisted, reference-only.** Connector resolution and any
> external I/O are a **canonical Knowtation concern**, governed by a per-vault allowlist
> (`hub_media_connector_policy.json`, §5). Scooling forwards `connector_id` + `opaque_ref` + `intent`
> only; it never resolves, dereferences, or fetches the target. In v0 there is **no** connector SDK
> and **no** fetch of any kind — the reference is stored credential-free from the opaque handle
> alone. *Rationale:* keeps the SSRF and credential surface entirely off the consumer and behind the
> canonical gate. Resolves Scooling **MD-2**.

> **KN-MD-3 — Import consent is a human artifact, never agent-self-granted.** A durable external
> reference requires an active `knowtation.media_import_consent/v0` (§6). Consent is granted by an
> authenticated human writer (CLI / Hub REST, scope×role), **not** exposed as an MCP write tool
> (injection-surface minimization). Missing / expired / revoked ⇒ `MEDIA_IMPORT_CONSENT_REQUIRED`.

> **KN-MD-4 — Two abilities, two gates, never bundled.** `MEDIA_EXTERNAL_LINK_ENABLED` and
> `MEDIA_ATTACH_ENABLED` are independent env + policy flags, each the canonical-first prerequisite for
> a **separate** Scooling Tier 3 session (2F-b-d-e, 2F-b-d-f). *Rationale:* different risk profiles
> (an external reference reaches outside the vault; an attach mutates a note). Mirrors Scooling
> **MD-3**.

> **KN-MD-5 — External links extend the read model as a fourth derivation source.** Apply of
> `media_external_link` upserts a durable, credential-free record read back by the 2F-b store as
> `source: connector_ref`, `storage_kind: external_link`, `attachment_id: att_link_<32hex>`. The read
> contract's three sources (`vault_file` / `mist_blob` / `embedded_url`) gain a fourth
> (`connector_ref`); `ATTACHMENT_ID_RE` widens to include the `link` tag (§9.4). *Rationale:*
> `GET /api/v1/attachments` must surface the new reference (cross-repo I-MEDIA-WRITE-01) without a
> parallel read path.

---

## 1. Surfaces (triple-exposed, identical contract)

All **write** surfaces require the relevant Hub gate (§11) and resolve write authority server-side.
Consent **grant** is deliberately not an MCP write tool (KN-MD-3).

| Surface | External link (write) | Attach (write) | Import consent |
| --- | --- | --- | --- |
| **MCP** | `media_external_link_propose` | `media_attach_propose` | `media_import_consent_list` (**read-only**) |
| **Hub REST** | `POST /api/v1/attachments/link-proposals` | `POST /api/v1/attachments/attach-proposals` | `POST` / `GET` / `DELETE /api/v1/attachments/import-consents[/:id]` |
| **CLI** | `knowtation attachment link-propose …` | `knowtation attachment attach-propose …` | `knowtation attachment import-consent grant\|list\|revoke …` |

All propose surfaces converge on **one handler family** (`lib/attachments/attachment-write.mjs`):

- `handleMediaLinkProposeRequest` — external-link proposal create.
- `handleMediaAttachProposeRequest` — attach proposal create.
- `handleMediaImportConsent{Grant,List,Revoke}Request` — consent lifecycle (human writer).

No surface re-implements write logic — parity proven by deep-equality (§14 tier 2).

### 1.1 Common request fields

Every propose request includes:

| Field | Req | Description |
| --- | --- | --- |
| `intent` | yes | Untrusted human-readable reason; recorded on proposal; **never executed** |
| `scope` | yes | `personal` \| `project` \| `org`; validated against resolved write tier (§2); never widens |
| `proposal_kind` | no (ignored if client sends) | **Server-stamped** on create — client value ignored |

`media_attach` additionally requires `base_state_id` (target note concurrency token, `kn1_`, §8).

---

## 2. Write-authority model (scope × role, server-side, deny-by-default)

Reuses attachment/Flow/task **read** visibility plus a stricter write tier (parity
`TASK-WRITE-PROPOSAL-CONTRACT-2G-d.md` §2, `FLOW-AUTHORING-WRITEBACK-CONTRACT-7A-L1.md` §2):

| Target scope | Minimum role | Resolution |
| --- | --- | --- |
| `personal` | authenticated writer (`editor`+) in own vault | `resolveFlowVisibleScopes` includes `personal` |
| `project` | `editor` | visible scopes include `project` **and** role ≥ editor |
| `org` | `admin` | role must be `admin` |

| Rule | Contract |
| --- | --- |
| **Authorization, not a filter** | Write tier resolved server-side; client never supplies its own tier. |
| **Deny by default** | Ambiguous ⇒ `400 ATTACHMENT_SCOPE_AMBIGUOUS`. Unauthorized ⇒ `403 ATTACHMENT_SCOPE_DENIED`. |
| **No scope widening** | Payload `scope` validated against resolved write tier **before** proposal create. |
| **No existence leak** | Attach on unreadable media/note ⇒ `404 unknown_attachment` / `404 unknown_note` (same as missing). |
| **Consent grant authority** | Consent grant/revoke requires the **same** scope×role tier as a write at that scope (§6). |
| **Attach visibility fence** | `media_attach` requires the caller to be able to read **the media** (2F-b §7) **and** write **the note** (this table). |

---

## 3. Proposal kinds (server-stamped `proposal_kind`, `source: "media"`)

| `proposal_kind` | Apply target | Mutation |
| --- | --- | --- |
| `media_external_link` | new credential-free external reference | upsert `hub_attachment_external_refs.json` entry → derived `connector_ref` attachment (KN-MD-5) |
| `media_attach` | existing note frontmatter | append media pointer to note `attachments[]` (SPEC §2.4), optimistic-concurrency note edit |

**Non-goals (2F-b-d-kn):** detach / unlink proposal kind (v0 attach-only); byte import / mirror
(reference-only); connector-catalog sync; hosted canister write index. Consent grant/revoke are
**not** proposal kinds — they are direct human writes (KN-MD-3).

---

## 4. Request / response shapes

### 4.1 `media_external_link` — `POST /api/v1/attachments/link-proposals`

```jsonc
{
  "proposal_kind": "media_external_link",  // ignored — server stamps
  "intent": "Link shared drive design board",
  "scope": "personal",
  "connector_id": "gdrive",                // CONNECTOR_ID_RE; must be server-side allowlisted (§5)
  "opaque_ref": "1AbCd_efGhIjkLmnOpQrStU", // OPAQUE_REF_RE; connector-scoped handle; NEVER dereferenced
  "consent_id": "mic_9f8e7d6c5b4a3210",    // active knowtation.media_import_consent/v0 (§6)
  "display_label": "Design board"          // optional, untrusted; else derived from connector_id
}
```

Rules:

| # | Rule |
| --- | --- |
| L-1 | `connector_id` MUST match `CONNECTOR_ID_RE = /^[a-z][a-z0-9_]{0,31}$/`; not-allowlisted/disabled ⇒ `403 MEDIA_CONNECTOR_DENIED`. |
| L-2 | `opaque_ref` MUST match `OPAQUE_REF_RE = /^[A-Za-z0-9._:#-]{1,256}$/`; overflow/charset ⇒ `400 MEDIA_DRAFT_INVALID`. |
| L-3 | **No server-side fetch** — neither propose nor apply dereferences `opaque_ref` or any URL (§10). Reference stored credential-free. |
| L-4 | **Import-consent chain** — an active, unexpired, non-revoked consent for `(connector_id, scope)` MUST exist (§6). Missing/expired/revoked ⇒ `403 MEDIA_IMPORT_CONSENT_REQUIRED`. |
| L-5 | **Scope is authorization** (§2) — deny-by-default; client cannot widen. |
| L-6 | **Gate** — `MEDIA_EXTERNAL_LINK_ENABLED` on, else `403 MEDIA_EXTERNAL_LINK_DISABLED`. |
| L-7 | **Proposal only** — create a `media_external_link` proposal; apply persists the reference (§9). |
| L-8 | **Untrusted fields** — `intent`, `opaque_ref`, `display_label` are untrusted; never interpreted as commands; stamped for the prompt-injection label path. |
| L-9 | **Deterministic id** — server computes `attachment_id = "att_link_" + sha256("link:" + connector_id + "|" + opaque_ref)[:32]`; duplicate live reference ⇒ `409 MEDIA_LINEAGE_CONFLICT`. |

### 4.2 `media_attach` — `POST /api/v1/attachments/attach-proposals`

```jsonc
{
  "proposal_kind": "media_attach",       // ignored — server stamps
  "intent": "Attach cover image to lesson note",
  "scope": "personal",
  "attachment_id": "att_file_0a1b2c3d4e5f60718293a4b5c6d7e8f9",  // ATTACHMENT_ID_RE; must resolve + be in scope (2F-b)
  "note_ref": "note:lessons/2026/photosynthesis.md",            // NOTE_REF_RE; scope-visible + writable
  "base_state_id": "kn1_0123456789abcdef"                       // target-note concurrency token (§8)
}
```

Rules:

| # | Rule |
| --- | --- |
| A-1 | `attachment_id` MUST match `ATTACHMENT_ID_RE` (§9.4); unknown/out-of-scope ⇒ `404 unknown_attachment`. |
| A-2 | `note_ref` MUST match `NOTE_REF_RE = /^note:[A-Za-z0-9._:\/-]{1,256}$/` (Hub-internal); the wire ref MUST stay ≤128 chars / `[A-Za-z0-9._:-]` for Scooling round-trip (2F-b §6 live-parity pin). Unknown/out-of-scope ⇒ `404 unknown_note`. |
| A-3 | **Scope×role write authority** (§2) on the **note**; caller must also read the media (2F-b §7). |
| A-4 | **Optimistic concurrency** — `base_state_id` re-checked at approve against the live note fingerprint; mismatch ⇒ `409 MEDIA_LINEAGE_CONFLICT` (PROPOSAL-LIFECYCLE `kn1_`). |
| A-5 | **Gate** — `MEDIA_ATTACH_ENABLED` on, else `403 MEDIA_ATTACH_DISABLED`. |
| A-6 | **Proposal only** — apply edits the note frontmatter (§9); `auto_approvable` always `false`. |
| A-7 | **Idempotent attach** — media already present in the note's `attachments[]` at apply ⇒ no-op (no duplicate entry), apply still succeeds. |
| A-8 | **Untrusted fields** — `intent` untrusted; media `display_label` remains untrusted per read contract. |

### 4.3 Proposal response — `knowtation.media_proposal/v0`

Identical envelope for both kinds (Scooling maps `proposal_id`→`proposalRef`, `external_ref`→`externalRef`):

```jsonc
{
  "schema": "knowtation.media_proposal/v0",
  "proposal_id": "…",
  "proposal_kind": "media_external_link",   // or media_attach
  "attachment_id": "att_link_…",            // minted (link) or referenced (attach)
  "note_ref": null,                          // note:… for media_attach
  "connector_id": "gdrive",                  // null for media_attach
  "scope": "personal",
  "base_state_id": "kn1_…",                  // note token (attach); absent-sentinel for link (§8)
  "external_ref": null,                      // SD-2 lineage bridge id when Muse configured; else null
  "auto_approvable": false,
  "status": "proposed",
  "review_queue": "media-writes"
}
```

---

## 5. Connector allowlist policy — `hub_media_connector_policy.json`

Per-vault, admin-managed, **deny-by-default**. A dedicated file mirrors the attachment policy overlay
(`hub_attachment_store.json`) — it holds **no** connector secrets, only enablement + display metadata.

```jsonc
{
  "schema": "knowtation.media_connector_policy/v0",
  "vaults": {
    "<vault_id>": {
      "connectors": {
        "gdrive": { "enabled": true, "display_name": "Google Drive", "updated": "2026-07-02T00:00:00Z" }
      }
    }
  }
}
```

| Rule | Contract |
| --- | --- |
| **Deny-by-default** | Absent file / vault / connector, or `enabled:false` ⇒ `403 MEDIA_CONNECTOR_DENIED`. |
| **Admin-only management** | Allowlist writes require `admin`; separate from the link gate (config may exist while the gate is off). |
| **No secrets** | The policy MUST NOT store OAuth tokens, client secrets, refresh tokens, or connector base URLs. |
| **Charset** | Connector keys match `CONNECTOR_ID_RE`; `display_name` is untrusted display text. |
| **Robust load** | Missing/malformed ⇒ empty allowlist (all connectors denied). |

Persistence primitives (2F-b-d-kn-b — new, mirror calendar/attachment stores):
`getMediaConnectorPolicyPath(dataDir)`, `loadMediaConnectorPolicy(dataDir)` /
`saveMediaConnectorPolicy(dataDir, store)` (tmp + rename), `getVaultConnectors(dataDir, vaultId)`.

---

## 6. Import-consent record — `knowtation.media_import_consent/v0`

Per-vault, human-granted, revocable, expiry-aware. Stored in `hub_media_import_consent.json` (no
connector content beyond the id it authorizes).

```jsonc
{
  "schema": "knowtation.media_import_consent/v0",
  "vaults": {
    "<vault_id>": {
      "consents": {
        "mic_9f8e7d6c5b4a3210": {
          "connector_id": "gdrive",
          "scope": "personal",
          "granted_by": "<uid_hash>",          // UID_HASH_REF_RE; never a raw identifier
          "granted_at": "2026-07-02T00:00:00Z",
          "expires_at": null,                   // ISO8601 | null (no expiry)
          "status": "active"                    // "active" | "revoked"
        }
      }
    }
  }
}
```

| Rule | Contract |
| --- | --- |
| **Human artifact** | Consent is granted by an authenticated human writer (CLI / Hub REST); **not** an MCP write tool (KN-MD-3). MCP exposes read-only `media_import_consent_list`. |
| **`consent_id`** | `CONSENT_ID_RE = /^mic_[a-f0-9]{16}$/`; server-minted. |
| **Scope×role** | Grant/revoke at `(connector_id, scope)` require the §2 write tier for that scope. |
| **Validity at propose** | A link propose requires a matching consent with `status:"active"` and (`expires_at` null or `> now`). |
| **Revocation is immediate** | Revoked/expired consent blocks new link proposals; already-applied references are **not** retroactively removed (revocation is prospective; removal is a separate future gate). |
| **Gate coupling** | Consent grant requires `MEDIA_EXTERNAL_LINK_ENABLED` on (consent has no meaning without the link ability); listing consents is always allowed to authorized readers. |
| **No secrets** | The record MUST NOT store tokens, URLs, or connector credentials. |

Persistence primitives: `getMediaImportConsentPath(dataDir)`, `loadMediaImportConsentStore` /
`saveMediaImportConsentStore` (tmp + rename), `getActiveConsent(dataDir, vaultId, connectorId, scope, now)`.

---

## 7. Review-before-write lifecycle

Identical to SD-4 / 7A-L1 §3 / 2G-d §5:

```
media_external_link_propose / media_attach_propose
        │  validate + connector allowlist + import consent + write-authority + concurrency precheck
        ▼
   POST /proposals  ──►  status: proposed  (source:"media", media_meta, intent, review_queue:"media-writes")
        │
        ▼
   /proposals/{id}/evaluation  ──►  pass | fail | needs_changes   (HUB_PROPOSAL_EVALUATION_REQUIRED honored)
        │
        ▼
   /proposals/{id}/approve  ──►  base_state_id re-check (409 on conflict; attach only)
        │
        ▼
   reconcileApprovedMediaProposal  ──►  external-ref store OR note frontmatter ONLY mutation
```

| Rule | Contract |
| --- | --- |
| **No silent writes** | Propose never mutates the external-ref store or any note. |
| **`auto_approvable`** | Always `false` for media proposals in v0 (human review default). |
| **Evaluation gate** | `HUB_PROPOSAL_EVALUATION_REQUIRED` honored unchanged. |
| **Rollback** | Failed reconcile rolls back — no partial index/note state. |
| **Orchestrator** | Scooling orchestrator invokes only through the adapter → same propose path; it never writes Knowtation directly. |

---

## 8. Optimistic concurrency

| Item | Definition |
| --- | --- |
| **Attach `base_state_id`** | Target-note fingerprint `kn1_` (FNV-1a 64-bit over `canonicalJSON(frontmatter) + "\0" + body`, `lib/note-state-id.mjs`). Re-checked at approve; mismatch ⇒ `409 MEDIA_LINEAGE_CONFLICT`. |
| **Link absent-sentinel** | `media_external_link` creates a new reference; `base_state_id` is the absent-flow sentinel (`absentNoteStateId()` shape). Duplicate live `attachment_id` ⇒ `409 MEDIA_LINEAGE_CONFLICT` (L-9). |
| **Check points** | Propose-time precheck + approve-time authoritative re-check. |

---

## 9. Apply reconciliation (`reconcileApprovedMediaProposal`)

| `proposal_kind` | Handler behavior |
| --- | --- |
| `media_external_link` | Validate connector still allowlisted + consent still active; upsert credential-free record into `hub_attachment_external_refs.json` keyed by `att_link_<token>`; stamp `created`/`updated`; **no fetch** (§10) |
| `media_attach` | Re-check note `base_state_id`; append media pointer to note frontmatter `attachments[]` if absent (idempotent, A-7); write note via existing note-write path |

`media_meta` on the proposal record:

```jsonc
{
  "record_kind": "media_external_link" | "media_attach",
  "proposal_kind": "media_external_link",
  "attachment_id": "att_link_…",
  "connector_id": "gdrive",
  "consent_id": "mic_…",
  "note_ref": "note:…"       // media_attach only
}
```

### 9.1 External-reference store — `hub_attachment_external_refs.json`

```jsonc
{
  "schema": "knowtation.attachment_external_ref/v0",
  "vaults": {
    "<vault_id>": {
      "refs": {
        "att_link_<32hex>": {
          "connector_id": "gdrive",
          "opaque_ref": "1AbCd_efGhIjkLmnOpQrStU",   // connector-scoped handle only; NOT a URL, NOT a credential
          "scope": "personal",
          "display_label": "Design board",            // untrusted
          "consent_id": "mic_…",
          "created": "2026-07-02T00:00:00Z",
          "updated": "2026-07-02T00:00:00Z"
        }
      }
    }
  }
}
```

### 9.2 Read-model join (2F-b store extension)

The 2F-b read store (`lib/attachments/attachment-store.mjs`) gains a fourth derivation source that
reads `hub_attachment_external_refs.json`:

| Field | Value for `connector_ref` |
| --- | --- |
| `source` | `connector_ref` |
| `storage_kind` | `external_link` |
| `attachment_id` | `att_link_<32hex>` |
| `display_label` | stored untrusted label (never the `opaque_ref`, never a URL) |
| `byte_size` | `null` (never fetched) |
| `scope` | stored scope (still deny-by-default at read, 2F-b §7) |
| `agent_visible` | overlay default `false` (2F-b §2) |

### 9.3 Note-frontmatter apply (attach)

`media_attach` apply appends the media's underlying pointer to the target note's `attachments[]`
(SPEC §2.4). For `mist_blob` media the pointer is the internal Mist id; for `connector_ref`/`vault_file`
media the pointer is the `attachment_id`. The change flows through the existing note-write path so
`updated`, provenance, and `kn1_` recomputation stay consistent. `linked_note_refs` for the media then
includes the note on the next read (cross-repo I-MEDIA-WRITE-01).

### 9.4 `ATTACHMENT_ID_RE` widening (delivered in 2F-b-d-kn-b)

| Export | 2F-b value | 2F-b-d-kn value |
| --- | --- | --- |
| `ATTACHMENT_ID_RE` | `/^att_(file\|mist\|url)_[a-f0-9]{32}$/` | `/^att_(file\|mist\|url\|link)_[a-f0-9]{32}$/` |

Scooling maps `att_link_<token>` → `media_link_<token>` (37 chars ≤ `MEDIA_ID_RE` 48-char tail).

---

## 10. No-SSRF fence (inherits ATTACHMENT-STORE §8.7 / SEC-A-05)

1. **External links are references** — neither propose nor apply dereferences `opaque_ref`, resolves a
   connector, or fetches any URL. `mcp/resources/image-fetch.mjs` is **not** invoked on this path.
2. **Credential-free storage** — the external-ref record stores the opaque connector handle only; no
   tokens, credentialed URLs, provider keys, or absolute paths (§9.1).
3. **No connector SDK in v0** — connector resolution is a canonical concern; v0 records the handle
   without contacting the provider. Any future fetch is a **separate** derived-artifact + consent gate.
4. Security tier (§14 tier 7) asserts **zero** outbound network calls during link propose and apply.

---

## 11. Posture / gating (default off)

| Control | Default | Effect |
| --- | --- | --- |
| **`MEDIA_EXTERNAL_LINK_ENABLED`** (Knowtation env + `hub_media_write_policy.json`) | **off** | `link-proposals` + consent grant return `403 MEDIA_EXTERNAL_LINK_DISABLED`. |
| **`MEDIA_ATTACH_ENABLED`** (Knowtation env + policy) | **off** | `attach-proposals` return `403 MEDIA_ATTACH_DISABLED`. |
| Read-only attachment list/get (2F-b-b) | live | Unchanged — independent of both write gates. |

Policy resolution mirrors `TASK_WRITES_ENABLED` / `HUB_PROPOSAL_EVALUATION_REQUIRED`: env `=1`/`true`
⇒ on; `=0`/`false` ⇒ off; unset ⇒ read `data/hub_media_write_policy.json`
(`media_external_link_enabled` / `media_attach_enabled` booleans), default off. **Two independent
keys — never a single combined flag** (KN-MD-4). Enabling either is the **canonical-first**
prerequisite for the corresponding Scooling Tier 3 flip; **do not flip without explicit
authorization** (§16).

---

## 12. Scooling consumer mapping (for the later live wire)

When Scooling flips a media write gate (2F-b-d-e/f, Tier 3), `mediaWriteHubTransport.ts` maps this
Hub JSON ↔ `scooling.media_library_adapter/v0`. This section is the canonical anchor for Scooling
`docs/MEDIA-EXTERNAL-LINK-AND-ATTACH-CONTRACT-2F-d.md` §5.

| Adapter method | Hub route | `proposal_kind` |
| --- | --- | --- |
| `linkExternalReference` | `POST /api/v1/attachments/link-proposals` | `media_external_link` (server-stamped) |
| `attachToNote` | `POST /api/v1/attachments/attach-proposals` | `media_attach` (server-stamped) |

Hub `knowtation.media_proposal/v0` → Scooling `MediaWriteProposalRef` (`proposal_id`→`proposalRef`,
`external_ref`→`externalRef`). Hub error codes map **opaquely** to the Scooling refusal taxonomy — no
scope/id/existence leaks:

| Hub code | Scooling reason |
| --- | --- |
| `MEDIA_EXTERNAL_LINK_DISABLED` (and legacy `MEDIA_WRITES_DISABLED`) | `media_external_link_not_authorized` |
| `MEDIA_ATTACH_DISABLED` | `media_attach_not_authorized` |
| `MEDIA_CONNECTOR_DENIED` | `media_connector_denied` |
| `MEDIA_IMPORT_CONSENT_REQUIRED` | `media_import_consent_required` |
| `ATTACHMENT_SCOPE_DENIED` | `media_scope_denied` |
| `ATTACHMENT_SCOPE_AMBIGUOUS` | `media_scope_ambiguous` |
| `unknown_attachment` | `unknown_media` |
| `unknown_note` | `unknown_note` |
| `MEDIA_LINEAGE_CONFLICT` (409) | `media_lineage_conflict` |
| any other (`MEDIA_DRAFT_INVALID`, `EVALUATION_REQUIRED`, …) | `invalid_request` |

Scooling stores **nothing** canonical (no reference, no consent, no note edit); it validates,
gate/env double-locks, maps errors opaquely, and routes the proposal pointer to the review tray.

---

## 13. Error taxonomy

`MEDIA_DRAFT_INVALID` · `MEDIA_EXTERNAL_LINK_DISABLED` · `MEDIA_ATTACH_DISABLED` ·
`MEDIA_CONNECTOR_DENIED` (403) · `MEDIA_IMPORT_CONSENT_REQUIRED` (403) · `ATTACHMENT_SCOPE_DENIED`
(403) · `ATTACHMENT_SCOPE_AMBIGUOUS` (400) · `unknown_attachment` (404) · `unknown_note` (404) ·
`MEDIA_LINEAGE_CONFLICT` (409) · `EVALUATION_REQUIRED` (403, approve, unchanged).

(`ATTACHMENT_SCOPE_*` and `unknown_attachment` are reused verbatim from ATTACHMENT-STORE §4/§8 so the
read and write surfaces share one taxonomy.)

---

## 14. Seven-tier test matrix (2F-b-d-kn-b Auto)

Files: `test/media-write-*.test.mjs`. **No network in any tier** (the no-SSRF invariant means a
network call is itself a failure). Fixtures: a temp vault with `media/` files, a note with
`attachments[]` frontmatter and a known `kn1_`, an allowlisted connector (`gdrive`), a
not-allowlisted connector, an active consent, and an expired/revoked consent.

| Tier | File | Focus |
| --- | --- | --- |
| unit | `test/media-write-unit.test.mjs` | `CONNECTOR_ID_RE` / `OPAQUE_REF_RE` / `CONSENT_ID_RE` / widened `ATTACHMENT_ID_RE` accept-canonical / reject-malformed; deterministic `att_link_<token>` derivation; proposal envelope stamps (`source:"media"`, server `proposal_kind`, `review_queue:"media-writes"`); `media_meta` shape; gate resolution defaults off |
| integration | `test/media-write-parity-integration.test.mjs` | CLI = MCP = Hub deep-equal propose envelopes; both gates off ⇒ `MEDIA_EXTERNAL_LINK_DISABLED` / `MEDIA_ATTACH_DISABLED` on all surfaces; consent grant not exposed as MCP write tool |
| e2e | `test/media-write-e2e.test.mjs` | grant consent → link propose → approve → `GET /api/v1/attachments?source=connector_ref` shows credential-free ref → attach propose of it to a note → approve → `GET /api/v1/attachments/{id}` shows note in `linked_note_refs` (I-MEDIA-WRITE-01) |
| stress | `test/media-write-stress.test.mjs` | burst refusals with gates off; 100 concurrent link proposes for the same `(connector,opaque_ref)` ⇒ one live ref, rest `409`; `opaque_ref` at 256 chars ok / 257 rejected; large `intent` bounded |
| data-integrity | `test/media-write-data-integrity.test.mjs` | approve round-trip byte-stable; external ref stored credential-free (no URL/token bytes); attach targets exactly `note_ref`; idempotent re-attach adds no duplicate; SD-4 — no store/note mutation at propose time; revoked consent blocks new links but leaves applied refs intact |
| performance | `test/media-write-performance.test.mjs` | propose + apply p95 budgets; allowlist + consent lookup O(1)/O(log n), not a vault scan; read-model join stays O(files + notes×refs + external_refs) |
| security | `test/media-write-security.test.mjs` | **SSRF:** zero outbound fetch on link propose + apply (assert `image-fetch.mjs` never called; no socket); not-allowlisted connector ⇒ `MEDIA_CONNECTOR_DENIED`; missing/expired/revoked consent ⇒ `MEDIA_IMPORT_CONSENT_REQUIRED`; scope deny + no-widen; out-of-scope media/note ⇒ `unknown_attachment`/`unknown_note` (no leak); injection in `intent`/`opaque_ref`/`display_label` inert; `JSON.stringify` audit — no tokens/credential URLs/paths/bytes in request, proposal, ref store, or response; stale attach `base_state_id` ⇒ `409` |

**Cross-repo I-MEDIA-WRITE-01** (with Scooling 2F-b-d-b): propose `media_external_link` → approve →
`GET /api/v1/attachments?source=connector_ref` shows the new credential-free reference → propose
`media_attach` of it to a note → approve → `GET /api/v1/attachments/{id}` shows the note in
`linked_note_refs`.

**Verification gate (2F-b-d-kn-b):**

```bash
node --test test/media-write-*.test.mjs
node scripts/verify-media-write-smoke.mjs   # self-hosted Hub; propose only, approve via UI/test admin
```

---

## 15. OpenAPI wire shapes (land with routes in 2F-b-d-kn-b)

Extend the existing `Attachments` tag. Auth: `BearerAuth` + `X-Vault-Id`; mounted under the same auth
stack as read (`jwtAuth`, `apiLimiter`, `requireVaultAccess`); write routes `requireRole('editor',
'admin')` (org scope resolves to admin server-side).

```yaml
MediaProposalResponse:
  type: object
  required: [schema, proposal_id, proposal_kind, attachment_id, scope, auto_approvable, status]
  properties:
    schema:         { type: string, enum: [knowtation.media_proposal/v0] }
    proposal_id:    { type: string }
    proposal_kind:  { type: string, enum: [media_external_link, media_attach] }
    attachment_id:  { type: string, pattern: '^att_(file|mist|url|link)_[a-f0-9]{32}$' }
    note_ref:       { type: [string, 'null'] }
    connector_id:   { type: [string, 'null'] }
    scope:          { type: string, enum: [personal, project, org] }
    base_state_id:  { type: string }
    external_ref:   { type: [string, 'null'] }
    auto_approvable:{ type: boolean, enum: [false] }
    status:         { type: string, enum: [proposed] }
    review_queue:   { type: string, enum: [media-writes] }
```

Routes: `POST /api/v1/attachments/link-proposals`, `POST /api/v1/attachments/attach-proposals`,
`POST|GET|DELETE /api/v1/attachments/import-consents[/{id}]`. Errors per §13.

---

## 16. Hub-enablement checklists (canonical-first — one gate per session)

Each gate is enabled in its **own** operator session, consumed when DONE, and is the **prerequisite**
for the matching Scooling Tier 3 flip (2F-b-d-e / 2F-b-d-f). **Never enable both in one session**
(KN-MD-4).

### 16.1 External link (`MEDIA_EXTERNAL_LINK_ENABLED`) — prerequisite for Scooling 2F-b-d-e

| # | Gate | Pass criterion |
| --- | --- | --- |
| KE-1 | Contracts frozen | This doc + Scooling `MEDIA-EXTERNAL-LINK-AND-ATTACH-CONTRACT-2F-d.md` committed |
| KE-2 | 2F-b-d-kn-b impl green | Seven tiers pass with gate **off**; re-run with gate **on** in dev/staging only |
| KE-3 | No-SSRF proven | Security tier: zero outbound fetch on link propose + apply |
| KE-4 | Connector allowlist | Not-allowlisted ⇒ `MEDIA_CONNECTOR_DENIED`; allowlisted + consent ⇒ proposes |
| KE-5 | Import consent | Missing/expired/revoked ⇒ `MEDIA_IMPORT_CONSENT_REQUIRED`; active consent ⇒ proposes |
| KE-6 | Scope negatives | Personal writer cannot create `project`/`org` reference; ambiguous fails closed |
| KE-7 | No secrets | `JSON.stringify` audit of request + proposal + ref store — no tokens/URLs/paths/bytes |
| KE-8 | Read-model join | Approved link shows in `GET /api/v1/attachments?source=connector_ref`, credential-free |
| KE-9 | Attach gate untouched | `MEDIA_ATTACH_ENABLED` remains **off** this session (never bundled) |
| KE-10 | Hosted smoke | `scripts/verify-media-write-smoke.mjs` link path PASS (propose only) |
| KE-11 | Governance sync | `KNOWTATION-OVERSEER-HANDOVER.md` updated; row CONSUMED |
| KE-12 | Merge path | Muse merge to `main` + GitHub `muse-mirror` PR (SD-14); no direct GitHub `main` push |

### 16.2 Attach (`MEDIA_ATTACH_ENABLED`) — prerequisite for Scooling 2F-b-d-f

| # | Gate | Pass criterion |
| --- | --- | --- |
| KA-1 | Contracts frozen | This doc + Scooling companion committed |
| KA-2 | 2F-b-d-kn-b impl green | Seven tiers pass with gate **off**; re-run with gate **on** in dev/staging only |
| KA-3 | Proposal only | Approve applies the note frontmatter edit; propose alone never mutates the note |
| KA-4 | Concurrency | Stale `base_state_id` ⇒ `409 MEDIA_LINEAGE_CONFLICT`; no lost updates |
| KA-5 | Idempotent attach | Re-attaching present media adds no duplicate `attachments[]` entry |
| KA-6 | Scope negatives | Personal writer cannot attach to `project`/`org` note; unknown note ⇒ `unknown_note` (no leak) |
| KA-7 | Existence leak | Out-of-scope `attachment_id` ⇒ `unknown_attachment` (== missing) |
| KA-8 | No secrets | `JSON.stringify` audit — no tokens/paths/bodies |
| KA-9 | External-link gate untouched | `MEDIA_EXTERNAL_LINK_ENABLED` state unchanged this session (never bundled) |
| KA-10 | Hosted smoke | `scripts/verify-media-write-smoke.mjs` attach path PASS (propose only) |
| KA-11 | Governance sync | `KNOWTATION-OVERSEER-HANDOVER.md` updated; row CONSUMED |
| KA-12 | Merge path | Muse merge + `muse-mirror` PR (SD-14); no direct GitHub `main` push |

**Explicit authorization record (operator fills on enable day, per gate):**

```text
MEDIA_EXTERNAL_LINK_ENABLED — authorized 2026-07-02 by operator (Tier 3 session 2F-b-d-kn-c)
Repo: knowtation @ feat/phase-2f-b-d-kn-c-external-link-gate
Gate flipped: MEDIA_EXTERNAL_LINK_ENABLED=1 (data/hub_media_write_policy.json + seed script)
Other media write gate: MEDIA_ATTACH_ENABLED unchanged (never bundled)
Verification: 22/22 media-write tests; verify-media-write-smoke.mjs --live-propose 5/5 PASS
Downstream: unblocks Scooling 2F-b-d-e Tier 3
```

```text
MEDIA_ATTACH_ENABLED — authorized 2026-07-03 by operator (Tier 3 session 2F-b-d-kn-d)
Repo: knowtation @ feat/phase-2f-b-d-kn-d-attach-gate
Gate flipped: MEDIA_ATTACH_ENABLED=1 (data/hub_media_write_policy.json + seed script)
Other media write gate: MEDIA_EXTERNAL_LINK_ENABLED unchanged (never bundled)
Verification: 22/22 media-write tests; verify-media-write-smoke.mjs --live-propose 7/7 PASS
Downstream: unblocks Scooling 2F-b-d-f Tier 3
```

```text
MEDIA_<EXTERNAL_LINK|ATTACH>_ENABLED — authorized YYYY-MM-DD by <principal>
Repo: knowtation @ <sha>
Gate flipped: <MEDIA_EXTERNAL_LINK_ENABLED|MEDIA_ATTACH_ENABLED>=1
Other media write gate: unchanged (never bundled)
Downstream: unblocks Scooling <2F-b-d-e|2F-b-d-f> Tier 3
```

---

## 17. Acceptance (2F-b-d-kn-a)

- [x] Proposal kinds, request/response shapes, connector-allowlist store (§5), import-consent
      store/lifecycle (§6), write authority (§2), review-before-write lifecycle (§7), optimistic
      concurrency (§8), apply reconciliation + read-model extension (§9), no-SSRF fence (§10),
      posture/gating (§11), Scooling mapping (§12), error taxonomy (§13), seven-tier matrix (§14),
      OpenAPI shapes (§15), and two independent Hub-enablement checklists (§16) frozen here —
      **contract only**.
- [x] Satisfies Scooling `MEDIA-EXTERNAL-LINK-AND-ATTACH-CONTRACT-2F-d.md` §6 driving requirement
      (external-link + attach facades, connector allowlist, import consent, Hub gates, no-SSRF).
- [x] Ratified against ATTACHMENT-STORE-CONTRACT-2F-b (§6 mapping, §8 fail-closed, SEC-A-05),
      TASK-WRITE-PROPOSAL-CONTRACT-2G-d (SD-4 parity), and PROPOSAL-LIFECYCLE (`kn1_`, evaluation).
- [x] Posture unchanged: `MEDIA_EXTERNAL_LINK_ENABLED` / `MEDIA_ATTACH_ENABLED` stay **off**.
- [x] 2F-b-d-kn-b implements to this contract on `feat/phase-2f-b-d-kn-media-write-surfaces`.

## Non-goals (2F-b-d-kn)

- Detach / unlink proposal kind (v0 is attach-only).
- Byte import / mirroring cloud files into the vault (reference-only in v0; import-copy is a later gate).
- Any server-side connector SDK or fetch of `opaque_ref` (KN-MD-2 / §10).
- Retroactive removal of applied references on consent revocation (prospective revocation only).
- OCR / transcription of linked/attached media (ATTACHMENT-STORE non-goal; separate consent gate).
- Hosted canister write index / gateway proxy (self-hosted Hub only in v0).
- The Scooling live flips (2F-b-d-e / 2F-b-d-f) — separate Tier 3 sessions, one gate each.

---

## 18. Handover notes (for 2F-b-d-kn-b — Auto)

1. Branch `feat/phase-2f-b-d-kn-media-write-surfaces` (this branch) off Muse `main`; read this doc +
   Scooling `MEDIA-EXTERNAL-LINK-AND-ATTACH-CONTRACT-2F-d.md` + ATTACHMENT-STORE-CONTRACT-2F-b —
   **no redesign**.
2. Implement `lib/attachments/attachment-write.mjs` (propose handlers + `reconcileApprovedMediaProposal`),
   `lib/attachments/media-connector-policy.mjs` (§5), `lib/attachments/media-import-consent.mjs` (§6),
   and `lib/attachments/attachment-external-ref-store.mjs` (§9.1). Widen `ATTACHMENT_ID_RE` and add the
   `connector_ref` source to `lib/attachments/attachment-store.mjs` / `derive.mjs` (§9.2/§9.4).
3. Extend the proposal apply dispatcher to call `reconcileApprovedMediaProposal` when
   `source === "media"`.
4. Wire Hub routes (§15), CLI (`attachment link-propose|attach-propose|import-consent`), MCP
   (`media_external_link_propose`, `media_attach_propose`, read-only `media_import_consent_list`;
   ACL in `hub/gateway/mcp-tool-acl.mjs`), and OpenAPI **in the same change**.
5. `MEDIA_EXTERNAL_LINK_ENABLED` and `MEDIA_ATTACH_ENABLED` default **off**; seven tiers (§14) green
   with both gates off before handover regen.
6. Do **not** enable either gate and do **not** bundle them — each is its own canonical-first
   enablement session (§16) and precedes a **separate** Scooling Tier 3 flip. No merge to Muse/GitHub
   `main` without explicit operator authorization.
