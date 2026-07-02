# Attachment Gates — List/Get + Consent/Deletion Contract (Scooling Phase 2F-b, Step 2F-b-a)

Status: **Contract frozen (2F-b-a Thinking).** Implementation (derivation index, policy overlay
store, Hub routes, CLI/MCP, OpenAPI, seven-tier tests, hosted smoke script) is **2F-b-b Auto** on
branch **`feat/phase-2f-b-attachment-store`**. This document is the **Knowtation** side of the
Scooling Phase 2F entry criteria; it unblocks Scooling `MEDIA_LIVE_READ_AUTHORIZED`.

Related:

- `scooling/docs/ROADMAP.md` — **Phase 2F entry criteria** (attachment listing, scoped metadata
  reads, data-lifecycle/import-consent/deletion, prompt-injection labeling). This contract satisfies
  those four criteria on the canonical (Knowtation) side.
- `scooling/src/adapters/mediaLibraryAdapter.ts` — **consumer boundary** (`scooling.media_library_adapter/v0`,
  2F-a inert double on `main`); maps to this wire shape at live-read time (§6).
- `scooling/docs/MEDIA-TASKS-AND-MODEL-STUDIO-PLAN.md` — product placement; `MediaLibraryAdapter`
  method list.
- `scooling/docs/PROMPT-INJECTION-THREAT-MODEL.md` — attachments, alt text, captions, and OCR are
  **untrusted input** for agents.
- `docs/TASK-STORE-CONTRACT-2G.md` — **parity reference** (Option A store, `*ForClient` projections,
  triple-surface list/get, scope deny-by-default, seven-tier matrix, hosted smoke). This contract
  mirrors it verbatim in structure.
- `docs/METADATA-FACETS-V0-SPEC.md` / `docs/DOCUMENT-TREE-V0-SPEC.md` — **body-free discipline**:
  attachment text, media metadata, and OCR are excluded from metadata responses and treated as
  untrusted prompt content. This contract inherits that exclusion.
- `docs/CALENDAR-EVENTS-V0-SPEC.md` — **consent-toggle precedent** (`enabled_for_agents`,
  `agent_context_tier_max`, server-side tier redaction).
- `lib/media-url-extract.mjs`, `mcp/resources/listing.mjs`, `docs/SPEC.md` §2.4 — the three existing
  attachment sources this derivation unifies.
- `lib/flow/flow-scope.mjs` — scope resolution reused (`personal|project|org`).
- `hub/hub_scope.mjs`, `hub/lib/scope-filter.mjs` — folder/project note visibility (attachment scope
  is **inherited from the owning note**, §7).
- `docs/openapi.yaml` — Hub wire shapes land **in the same change as the routes** (2F-b-b).

**Scope fence (2F-b-a):** Canonical attachment model, derivation sources, policy-overlay store shape,
list/get read contract, scope-inheritance rule, consent/deletion semantics, OpenAPI wire shapes,
seven-tier test matrix, and hosted smoke checklist **only**. **No** `lib/attachments/`
implementation, **no** Hub routes, **no** CLI/MCP wiring, **no** Scooling changes, **no** posture
flips (Scooling `MEDIA_LIVE_READ_AUTHORIZED` / `MEDIA_EXTERNAL_LINK_AUTHORIZED` / `MEDIA_ATTACH_AUTHORIZED`
stay `false` until a separate Tier 3 gate).

**Posture (2F-b-b):** **Read-only** list/get over derived attachment metadata, plus **automatic**
deletion propagation (source-gone ⇒ attachment-gone, tested). **No** consent-toggle writes, **no**
external-connector fetch, **no** OCR, **no** byte serving, **no** import-copy. Consent-toggle and
retention writes route through a **separate Tier 3 gate** (`ATTACHMENT_POLICY_WRITES_AUTHORIZED`, §8).

---

## Simple summary

Your photos, videos, PDFs, and screenshots already live in three places Knowtation understands:
files under `media/`, blob IDs stamped in a note's frontmatter, and image/video links written inside
a note. Today there is **no single, safe door** to *list* them or ask for *safe details only*. This
document is the blueprint for that door. It guarantees five things. First, one **read** surface
(`list` + `get`) returns **content-minimized metadata** — never file bytes, never an absolute path,
never a web link that carries a password or token. Second, **who can see an attachment is decided by
the note that owns it** — you cannot see an attachment attached to a note you are not allowed to
read (deny-by-default, enforced on the server). Third, deleting the note or the file **automatically
removes** the attachment from every listing — deletion propagates, it is not a separate bookkeeping
step. Fourth, every human-readable field (filename, caption, alt text) is stamped **untrusted** so an
AI treats it as data, never as instructions; OCR text is **not returned at all** in v0. Fifth, the
CLI, the MCP plug-in, and the Hub REST API return **byte-identical JSON** for the same authorized
request. Turning on agent-visibility toggles or import-copies is a **separate, later, gated** step.

## Technical summary

Attachments are **derived**, not authored: a read-time index over three existing sources —
`media/**` files (`mcp/resources/listing.mjs` walk), frontmatter `attachments[]` Mist blob IDs
(`docs/SPEC.md` §2.4), and embedded body URLs (`lib/media-url-extract.mjs`). The **only** durable
authored state is a small **policy overlay** (`hub_attachment_store.json`, per-vault, keyed by
`attachment_id`) holding agent-visibility consent and retention markers — mirroring the calendar
store's dedicated file and `enabled_for_agents` precedent. A new module `lib/attachments/
attachment-store.mjs` owns derivation + `listAttachments` / `getAttachment`; `lib/attachments/
attachment-handlers.mjs` mirrors `lib/task/task-handlers.mjs`. Scope is **inherited from the owning
note(s)** through `resolveFlowVisibleScopes` + the folder/project allowlist in `hub/lib/scope-filter.mjs`;
orphan `media/**` files default to `personal`. v0 exposes read-only `listAttachments` and
`getAttachment` over **three identical surfaces** — CLI (`knowtation attachment list|get`), MCP
(`attachment_list` / `attachment_get`), Hub REST (`GET /api/v1/attachments`,
`GET /api/v1/attachments/{id}`). `*ForClient` projections drop bytes, absolute paths, raw
credentialed URLs, and OCR. Self-hosted Hub only in v0 (calendar/task parity); hosted canister
attachment index is deferred.

---

## 1. Canonical record — `knowtation.attachment/v0` (derived view)

An attachment record is a **projection over a source**, assembled at read time. It is never written
to a note or authored by a user. The only persisted state is the §2 policy overlay.

| Field | Type | Req | Description |
| --- | --- | --- | --- |
| `schema` | const `knowtation.attachment/v0` | yes | Wire discriminator |
| `attachment_id` | string (`att_<source>_<token>`, see §1.1) | yes | Stable, path-free, lowercase id derived from source |
| `source` | enum | yes | `vault_file` \| `mist_blob` \| `embedded_url` — which of the three derivations produced it |
| `storage_kind` | enum | yes | `vault_blob` \| `external_link` (`vault_file`/`mist_blob` ⇒ `vault_blob`; `embedded_url` ⇒ `external_link`) |
| `mime_class` | enum | yes | `image` \| `video` \| `audio` \| `document` \| `unknown` — derived from extension/MIME, never sniffed bytes in v0 |
| `mime_type` | string \| null | yes | Best-effort MIME (`image/png`, …) from extension map; `null` when unknown |
| `scope` | enum | yes | `personal` \| `project` \| `org` — **inherited from owning note**, deny-by-default (§7) |
| `display_label` | string | yes | **Untrusted** display text (filename stem, alt text, or URL host — never absolute path) |
| `byte_size` | integer \| null | yes | File size for `vault_file`; `null` for `mist_blob`/`embedded_url` (not fetched) |
| `linked_note_refs` | `string[]` | yes | `note:<vault-relative-path-token>` pointers to notes that reference this attachment (≤ `MAX_LINKED_NOTES`) |
| `agent_visible` | boolean | yes | From policy overlay; **default `false`** (fail-closed) — governs agent/tiered reads (§8) |
| `created` | ISO8601 UTC | yes | Source discovery time (file mtime for `vault_file`; note mtime otherwise) |
| `updated` | ISO8601 UTC | yes | Last derivation/overlay update |
| `truncated` | boolean | yes | `true` when a list cap or field cap applied |

**Never present on the wire (fail-closed, §8):** absolute filesystem paths, credentialed or
tokenized URLs, raw file bytes, thumbnails, OCR/transcription text, EXIF/GPS, provider tokens, raw
Mist blob IDs.

### 1.1 Id derivation and regexes (pin v0)

`attachment_id = "att_" + <source_tag> + "_" + <token>` where `<source_tag> ∈ {file, mist, url}` and
`<token>` is the **first 32 lowercase hex chars** of a SHA-256 over a source-specific canonical
string. Lowercase-hex keeps ids opaque, path-free, deterministic, and directly mappable to the
Scooling `MEDIA_ID_RE` (§6).

| Source | `source` | `source_tag` | `token = sha256(...)[:32]` over |
| --- | --- | --- | --- |
| `media/**` file | `vault_file` | `file` | `"file:" + <vault-relative-path>` |
| frontmatter Mist id | `mist_blob` | `mist` | `"mist:" + <mist_blob_id>` (raw id never exposed) |
| embedded body URL | `embedded_url` | `url` | `"url:" + <owning-note-rel-path> + "|" + <normalized-url>` |

| Export | Value | Consumer parity |
| --- | --- | --- |
| `ATTACHMENT_ID_RE` | `/^att_(file\|mist\|url)_[a-f0-9]{32}$/` | Scooling maps → `media_<tag>_<token>` (§6) |
| `NOTE_REF_RE` | `/^note:[A-Za-z0-9._:\/-]{1,256}$/` | vault-relative path token; no leading `/`, no `..` |
| `MIST_ID_RE` | `/^[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]{12}$/` | `docs/SPEC.md` §2.4 (internal only) |
| `MAX_ATTACHMENT_SUMMARIES` | `500` | Scooling `MAX_MEDIA_SUMMARIES` |
| `MAX_LINKED_NOTES` | `64` | Cap on get payload; sets `truncated:true` when capped |
| `IMAGE_EXT_MIME` / `VIDEO_EXT_MIME` / `DOC_EXT_MIME` | reuse `lib/media-url-extract.mjs` maps | Extension→MIME source of truth |

---

## 2. Policy overlay store — `hub_attachment_store.json`

Attachments are derived; the **only** durable authored state is a per-vault policy overlay. A
dedicated file mirrors the calendar store (`hub_calendar_store.json`) — it holds **no attachment
content**, only consent/retention markers keyed by `attachment_id`.

```jsonc
{
  "schema": "knowtation.attachment_store/v0",
  "vaults": {
    "<vault_id>": {
      "policies": {
        "<attachment_id>": {
          "agent_visible": false,        // consent for agent/tiered reads — default false
          "retention": "vault_lifetime", // "vault_lifetime" | "pinned" (v0 read-only surfaces value)
          "updated": "2026-07-02T00:00:00Z"
        }
      }
    }
  }
}
```

### 2.1 Store rules

| Rule | Contract |
| --- | --- |
| **Dedicated file** | `hub_attachment_store.json` under `data_dir`; **not** merged into `hub_flow_store.json` (attachments are not Flow-linked; calendar precedent = one file per domain) |
| **Backward compat** | Missing file / missing vault / missing `policies` ⇒ treated as empty; every attachment defaults `agent_visible:false`, `retention:vault_lifetime` |
| **Atomic writes** | tmp + rename, same helper shape as `saveCalendarStore` (writes only exist behind the §8 Tier 3 gate; v0 reads only) |
| **Orphan GC** | An overlay entry whose `attachment_id` no longer derives from any source is **inert** (never resurrects a deleted attachment) and MAY be pruned on write; v0 never reads a policy without a live derivation |
| **No content** | The overlay MUST NOT store filenames, URLs, paths, bytes, OCR, or note bodies |

### 2.2 Persistence primitives (2F-b-b — new, mirrors calendar)

- `getAttachmentStorePath(dataDir)` → `path.join(dataDir, 'hub_attachment_store.json')`
- `loadAttachmentStore(dataDir)` / `saveAttachmentStore(dataDir, store)` (tmp + rename)
- `getVaultAttachmentPolicies(dataDir, vaultId)` → `{}` when absent (lazy, read-only in v0)

---

## 3. Derivation + read operations — `lib/attachments/attachment-store.mjs`

Read logic derives attachments from the three sources, joins the policy overlay, applies scope, and
projects to client shape. **No source is authoritative for scope** — scope comes from the owning
note(s) (§7).

### 3.1 Derivation sources (reuse — do not duplicate)

| Source | Reused primitive | Yields |
| --- | --- | --- |
| `vault_file` | `listMediaFiles(vaultPath, 'media', extensions)` (extend `mcp/resources/listing.mjs` to full `media/**`) | vault-relative path, size, mtime, ext→mime |
| `mist_blob` | `readNote` frontmatter `attachments[]` (`docs/SPEC.md` §2.4) | Mist ids per note ⇒ `linked_note_refs` |
| `embedded_url` | `extractImageUrls(body)` + `extractVideoUrls(body)` (`lib/media-url-extract.mjs`) | normalized URL, alt, ext→mime (blocks `data:` already) |

`display_label` derivation (all **untrusted**): `vault_file` ⇒ filename stem; `mist_blob` ⇒ owning
note title or `attachment N`; `embedded_url` ⇒ URL **host only** (never full credentialed URL).

### 3.2 Read operations (v0 surface)

| Function | Signature | Returns | Rules |
| --- | --- | --- | --- |
| `listAttachments` | `(dataDir, vaultPath, vaultId, { visibleScopes, filterScopes, effectiveScope, noteRef?, source?, mimeClass?, storageKind?, agentVisibleOnly?, limit?, mediaSubdir? }) → AttachmentListResult` | `{ schema, vault_id, effective_scope, attachments, truncated }` | Summaries only; scope deny-by-default; `limit` capped at `MAX_ATTACHMENT_SUMMARIES`; ordering: `mime_class` asc, then `attachment_id` asc (stable/deterministic) |
| `getAttachment` | `(dataDir, vaultPath, vaultId, attachmentId, { visibleScopes, mediaSubdir? }) → StoredAttachment \| null` | Full `knowtation.attachment/v0` or `null` | `attachmentId` must match `ATTACHMENT_ID_RE`; invisible/out-of-scope/underivable ⇒ `null` (404, no existence leak) |

### 3.3 Client projections (`*ForClient`)

| Function | Drops / keeps |
| --- | --- |
| `attachmentSummaryForClient` | **keeps** `attachment_id, source, storage_kind, mime_class, scope, display_label, created, truncated`; **drops** `mime_type`, `byte_size`, `linked_note_refs`, `agent_visible`, `updated` |
| `attachmentForClient` | Full §1 record; caps `linked_note_refs` at `MAX_LINKED_NOTES` (sets `truncated:true` when capped); **guarantees** no path/URL/bytes/OCR fields exist on the object |

---

## 4. Shared handlers — `lib/attachments/attachment-handlers.mjs`

Mirror `lib/task/task-handlers.mjs`:

| Handler | Maps to store | Error codes |
| --- | --- | --- |
| `handleAttachmentListRequest` | `listAttachments` | `400 ATTACHMENT_SCOPE_AMBIGUOUS`, `403 ATTACHMENT_SCOPE_DENIED`, `400 BAD_REQUEST` |
| `handleAttachmentGetRequest` | `getAttachment` | Same + `404 unknown_attachment` |

Scope resolution: reuse `resolveFlowVisibleScopes` + `resolveFlowScopeQuery` (`lib/flow/flow-scope.mjs`)
so an attachment caller has the **same visible scope set** as Flow/Task for the same identity, then
intersect with note visibility (§7).

Query param mapping (Hub query + CLI flags + MCP args):

| Param | Maps to |
| --- | --- |
| `scope` | Narrows within authorized scopes only (never widens) |
| `note_ref` | Filter attachments linked to a specific note (validated by `NOTE_REF_RE`) |
| `source` | Filter `vault_file` \| `mist_blob` \| `embedded_url` |
| `mime_class` | Filter mime class enum |
| `storage_kind` | Filter `vault_blob` \| `external_link` |
| `agent_visible` | When `true`, return only attachments with overlay `agent_visible:true` |
| `limit` | `1..MAX_ATTACHMENT_SUMMARIES` |

---

## 5. Triple-surface parity (CLI = MCP = Hub REST)

Defining invariant: **the same authorized request returns byte-identical JSON on all three surfaces.**

### 5.1 CLI — `knowtation attachment …`

```
knowtation attachment list [--scope personal|project|org] [--note-ref <note:path>] [--source vault_file|mist_blob|embedded_url] [--mime-class <c>] [--storage-kind <k>] [--agent-visible] [--limit <n>] [--json]
knowtation attachment get  <attachment_id> [--json]
```

- `--json` prints exact Hub JSON to stdout.
- Errors: non-zero exit + same code strings as Hub.

### 5.2 MCP — `attachment_list`, `attachment_get`

Register in `mcp/tools/attachment.mjs` (new) and wire from `mcp/create-server.mjs`
(`mountKnowtationMcp`). Add to hosted ACL (`hub/gateway/mcp-tool-acl.mjs`) as **read-only**. Zod args
mirror query params / `attachment_id`. Results deep-equal Hub payload. (Existing MCP media
**resources** in `mcp/resources/register.mjs` remain; these new **tools** are the parity surface.)

### 5.3 Hub REST

Mount under the existing auth stack (`jwtAuth`, `apiLimiter`, `requireVaultAccess`):

```
app.use('/api/v1/attachments', jwtAuth, apiLimiter, requireVaultAccess);
GET /api/v1/attachments        requireRole('viewer', 'editor', 'admin', 'evaluator')
GET /api/v1/attachments/:id    requireRole('viewer', 'editor', 'admin', 'evaluator')
```

**Self-hosted Hub only in v0.** Gateway/bridge hosted proxy is **deferred** (calendar/task pattern —
local/self-hosted first).

---

## 6. Scooling consumer mapping (for later live wire — not 2F-b-b Knowtation scope)

When Scooling flips `MEDIA_LIVE_READ_AUTHORIZED` (Tier 3), a `mediaLiveWire` maps Hub JSON →
`scooling.media_library_adapter/v0` types (`scooling/src/adapters/mediaLibraryAdapter.ts`):

| Hub (`knowtation.attachment/v0`) | Scooling (`MediaReferenceView`) | Mapping note |
| --- | --- | --- |
| `attachment_id` = `att_<tag>_<token>` | `mediaId` = `media_<tag>_<token>` | strip `att_`, prepend `media_`; both match `[a-z0-9_]`; `media_file_<32hex>` (37 ch) ≤ `MEDIA_ID_RE` 48-char tail |
| `mime_class` | `mimeClass` | identical enum |
| `storage_kind` | `storageKind` | identical enum |
| `scope` | `scope` | identical enum |
| `display_label` (untrusted) | `displayLabel` + `untrustedLabel:true` | Scooling stamps the label |
| `attachment_id` | `opaqueRef` | opaque handle = id (path-free); satisfies `OPAQUE_REF_RE` |
| `linked_note_refs` | `linkedNoteRefs` | Scooling `NOTE_REF_RE` = `/^note:[A-Za-z0-9._:-]{1,128}$/` — Hub MUST keep refs within that charset/length for live parity |
| `created` / `updated` | `created` / `updated` | ISO8601 UTC |
| — | `promptInjectionLabel: "untrusted"` | Scooling constant |
| — | `credentialUrlsReturned: false`, `previewBytesReturned: false` | Guaranteed by §8; Scooling asserts |

Scooling adds `schema: scooling.media_reference/v0`, `contractVersion`, `mode: live`. That flip is
**out of scope** for Knowtation 2F-b-b. `linkExternalReference` / `attachToNote` remain refusing
stubs in Scooling until their own Tier 3 gates.

> **Live-parity constraint (pin):** because Scooling `NOTE_REF_RE` caps at 128 chars, Knowtation
> `linked_note_refs` on the wire MUST be ≤ 128 chars and restricted to `[A-Za-z0-9._:-]` for any note
> intended to round-trip to Scooling. `getAttachment` MUST drop (and set `truncated:true`) any note
> ref that would violate the consumer charset/length rather than emit an unmappable ref.

---

## 7. Scope enforcement (server-side, deny-by-default) — scope inheritance

Attachments have **no independent scope**; scope is **inherited from the owning note(s)**:

| Rule | Contract |
| --- | --- |
| **Note-derived scope** | An attachment's `scope` = the **most restrictive** scope of the notes that reference it, resolved via `applyScopeFilterToNotes` (`hub/lib/scope-filter.mjs`) against the caller's `hub_scope.json` grants |
| **Orphan files** | A `media/**` file referenced by **no** visible note defaults to `personal` and is visible only to callers with `personal` (owner-equivalent) access |
| **Visibility fence** | If the caller cannot read **any** note that references the attachment, the attachment is **invisible** (`getAttachment` ⇒ `null` ⇒ 404) |
| **No widening** | `scope=org` query param under personal-only auth **narrows only** — never widens |
| **Absent/ambiguous** | `400 ATTACHMENT_SCOPE_AMBIGUOUS` |
| **Unauthorized tier** | `403 ATTACHMENT_SCOPE_DENIED` |
| **Missing/invisible** | `404 unknown_attachment` (no existence leak) |
| **Agent/tiered reads** | An attachment is returned to an **agent/tiered** caller only when overlay `agent_visible:true` (§8); default-off attachments are invisible to agent context even within scope |

**Scope test fixture:** an image linked only from a `project` note is invisible to a `personal`-only
caller; an orphan `media/` file is `personal`; an `org`-note image is visible to `org` callers only.

---

## 8. Fail-closed rules

1. **Read-only v0** — no POST/PATCH/DELETE on attachments; consent-toggle and retention writes
   refuse until the `ATTACHMENT_POLICY_WRITES_AUTHORIZED` Tier 3 gate.
2. **Deletion propagation is automatic** — deleting the owning note or the `media/**` file removes
   the attachment from every listing on the next read (derivation is source-of-truth); no separate
   delete call, no tombstone leak. Data-integrity tier asserts this.
3. **No bytes, no paths, no credentialed URLs** — projections never emit file bytes, absolute paths,
   thumbnails, EXIF/GPS, raw Mist ids, provider tokens, or URLs carrying credentials/tokens.
4. **No OCR/transcription in v0** — OCR and image/audio transcription are **excluded** (METADATA-FACETS
   discipline); if ever added, OCR is a **derived artifact** with its own consent chain, never inlined
   here.
5. **Untrusted display fields** — `display_label` (and any future caption/alt) returned verbatim as
   inert data, stamped untrusted; never interpreted as commands server-side.
6. **Consent default-off** — `agent_visible` defaults `false`; agent/tiered reads see an attachment
   only after explicit consent (mirrors calendar `enabled_for_agents`).
7. **External links are references only** — `embedded_url` attachments are never fetched server-side
   in v0; no SSRF surface is added (the existing SSRF-safe fetcher in `mcp/resources/image-fetch.mjs`
   is **not** invoked by list/get).
8. **Robust load** — missing/malformed overlay ⇒ empty policies (all default-off); derivation of a
   malformed source entry is skipped, never fatal.
9. **Content-minimization** — list never returns `linked_note_refs`, `byte_size`, `mime_type`, or
   `agent_visible`.

---

## 9. Seven-tier test matrix (2F-b-b Auto)

Files: `test/attachment-store-*.test.mjs`, `test/attachment-list-get-parity-*.test.mjs`. **No network
in unit tests.** Uses a temp vault fixture with `media/`, notes with `attachments[]` frontmatter, and
notes with embedded image/video URLs.

### 1. unit — `test/attachment-store-unit.test.mjs`

- `ATTACHMENT_ID_RE` / `NOTE_REF_RE` accept canonical ids/refs, reject malformed (`..`, leading `/`,
  uppercase in token).
- Id derivation deterministic: same source string ⇒ same `att_<tag>_<32hex>`; different sources ⇒
  different ids.
- `attachmentSummaryForClient` drops `byte_size`/`linked_note_refs`/`agent_visible`/`mime_type`;
  `attachmentForClient` caps `linked_note_refs` at `MAX_LINKED_NOTES`.
- Missing overlay ⇒ `agent_visible:false` default (backward compat).
- `display_label` for `embedded_url` is host-only (never full URL).

### 2. integration — `test/attachment-list-get-parity-integration.test.mjs`

- CLI `attachment list|get` JSON, MCP `attachment_list|attachment_get`, and Hub handler payload
  **deep-equal** for the same `visibleScopes`.
- Scope filter identical across surfaces.
- Derivation idempotent across repeated `listAttachments`.

### 3. e2e — `test/attachment-store-e2e.test.mjs`

- Temp vault → `attachment list` derives one `vault_file`, one `mist_blob`, one `embedded_url` →
  `attachment get <file id>` returns full record with linked note ref → `attachment list --source
  embedded_url` returns exactly the URL-derived one.

### 4. stress — `test/attachment-store-stress.test.mjs`

- Vault with `MAX_ATTACHMENT_SUMMARIES`+ media files/URLs; list correct, `truncated:true` when capped;
  no quadratic blowup on many notes × many embedded URLs.

### 5. data-integrity — `test/attachment-store-data-integrity.test.mjs`

- **I-A-DEL-01 (deletion propagation):** delete the owning note ⇒ its `mist_blob`/`embedded_url`
  attachments disappear from `list` and `get` ⇒ `404`; delete a `media/**` file ⇒ its `vault_file`
  attachment disappears.
- **I-A-ORPH-01:** overlay entry for a now-underivable id never resurrects an attachment.
- Round-trip: derived record → `attachmentForClient` loses no in-scope field; gains no path/URL/byte
  field.

### 6. performance — `test/attachment-store-performance.test.mjs`

- `listAttachments` / `getAttachment` p95 budget on the `MAX_*` fixture; derivation is O(files +
  notes×refs), not quadratic.

### 7. security — `test/attachment-store-security.test.mjs`

- **SEC-A-01 scope:** `personal` caller never sees `project`/`org` attachments; agent-tier caller
  never sees `agent_visible:false` attachments.
- **SEC-A-02 IDOR:** `getAttachment` for an out-of-scope/underivable id ⇒ `null` ⇒ `404
  unknown_attachment` (identical to missing).
- **SEC-A-03 no-leak:** `JSON.stringify` of any list/get payload contains **no** absolute path
  segment, `file://`, credential/token markers (`token`, `oauth`, `?sig=`, `X-Amz-`), raw Mist id, or
  OCR text.
- **SEC-A-04 injection:** malicious filename / alt text (`"](javascript:...)`, prompt-injection
  strings) returned as inert `display_label`; `promptInjectionLabel` path preserved for consumer;
  scope unchanged.
- **SEC-A-05 no-SSRF:** list/get of an `embedded_url` attachment performs **no** outbound fetch
  (assert `image-fetch.mjs` not called).
- **SEC-A-06 write-refusal:** `POST/PATCH/DELETE /api/v1/attachments*` ⇒ `404`/not-mounted (no write
  route in v0).

---

## 10. Hosted smoke checklist (2F-b-b deliverable)

Script: `scripts/verify-attachment-read-smoke.mjs` (self-hosted Hub; mirrors
`scripts/verify-hosted-task-read-smoke.mjs`).

**Prerequisites:**

- Self-hosted Hub running with JWT auth (`hub/server.mjs`); viewer+ role.
- Vault with a `media/` file, a note with `attachments:` frontmatter, and a note with an embedded
  image URL; `config.data_dir` writable.
- Optional: `hub_flow_workspace_scope.json` + `hub_scope.json` grants for scope tests.

**Steps (operator checklist):**

| # | Step | Pass criterion |
| --- | --- | --- |
| 1 | `GET /api/v1/attachments` with `Authorization: Bearer <jwt>`, `X-Vault-Id: <vault>` | `200`, `schema: knowtation.attachment_list/v0`, `attachments.length >= 1` |
| 2 | `GET /api/v1/attachments/<vault_file id>` | `200`, `storage_kind:vault_blob`, no path/bytes; `linked_note_refs` present |
| 3 | `GET /api/v1/attachments?source=embedded_url` | only `external_link` rows; `display_label` = host only |
| 4 | `GET /api/v1/attachments/<project-only id>` under personal-only role | `404 unknown_attachment` (not 403 — no existence leak) |
| 5 | Delete the owning note, re-`GET` its attachment | `404` (deletion propagated) |
| 6 | CLI parity: `knowtation attachment list --json` | Deep-equal to step 1 JSON |
| 7 | Confirm **no write routes**: `POST /api/v1/attachments` | `404` or not mounted |
| 8 | grep response bodies for `file://`, absolute path, `token`, `X-Amz-`, OCR | zero matches |

Env vars: `KNOWTATION_HUB_TOKEN`, `KNOWTATION_HUB_VAULT_ID`, `KNOWTATION_HUB_API` (default
`http://localhost:3000`).

---

## 11. OpenAPI wire shapes (land with routes in 2F-b-b)

New tag: `Attachments`. Auth: `BearerAuth` + `X-Vault-Id`.

### 11.1 `GET /api/v1/attachments`

Query: `scope`, `note_ref`, `source`, `mime_class`, `storage_kind`, `agent_visible`, `limit` (1..500).
Response schema `knowtation.attachment_list/v0`:

```yaml
AttachmentListResponse:
  type: object
  required: [schema, vault_id, effective_scope, attachments, truncated]
  properties:
    schema:          { type: string, enum: [knowtation.attachment_list/v0] }
    vault_id:        { type: string }
    effective_scope: { type: string, enum: [personal, project, org] }
    attachments:
      type: array
      maxItems: 500
      items: { $ref: '#/components/schemas/AttachmentSummary' }
    truncated:       { type: boolean }
```

`AttachmentSummary`: required fields from `attachmentSummaryForClient` (§3.3).

### 11.2 `GET /api/v1/attachments/{id}`

Response schema `knowtation.attachment_get/v0`:

```yaml
AttachmentGetResponse:
  type: object
  required: [schema, vault_id, effective_scope, attachment]
  properties:
    schema:          { type: string, enum: [knowtation.attachment_get/v0] }
    vault_id:        { type: string }
    effective_scope: { type: string, enum: [personal, project, org] }
    attachment:      { $ref: '#/components/schemas/AttachmentRecord' }
```

Errors: `400 BAD_REQUEST | ATTACHMENT_SCOPE_AMBIGUOUS`, `403 ATTACHMENT_SCOPE_DENIED`,
`404 unknown_attachment`.

---

## 12. Acceptance (2F-b-a)

- [x] Attachment model (§1), id derivation (§1.1), policy-overlay store (§2), derivation + read-op
      contract (§3), shared handlers (§4), triple-surface parity (§5), Scooling consumer mapping (§6),
      scope-inheritance rule (§7), fail-closed rules (§8), seven-tier matrix (§9), hosted smoke
      checklist (§10), and OpenAPI shapes (§11) frozen here — **contract only**.
- [x] Satisfies **Scooling Phase 2F entry criteria**: attachment listing (§3/§5), scoped metadata
      reads (§3.3/§7), data-lifecycle/consent/deletion (§2/§8), prompt-injection labeling (§1/§8/§9).
- [x] Ratified against `scooling/src/adapters/mediaLibraryAdapter.ts` (`MEDIA_ID_RE`, `NOTE_REF_RE`,
      `MediaReferenceView`), `docs/TASK-STORE-CONTRACT-2G.md` parity, and METADATA-FACETS body-free
      discipline.
- [x] 2F-b-b implements to this contract on `feat/phase-2f-b-attachment-store`.

## Non-goals (2F-b)

- Consent-toggle / retention writes (Tier 3 `ATTACHMENT_POLICY_WRITES_AUTHORIZED`).
- OCR / transcription of images or audio (separate derived-artifact + consent gate).
- External-connector fetch / import-copy (Scooling `MEDIA_EXTERNAL_LINK_AUTHORIZED` Tier 3).
- Attach-to-note writes (Scooling `MEDIA_ATTACH_AUTHORIZED` Tier 3; routes through review-before-write).
- Byte/thumbnail serving (existing `image-proxy` remains separate; not part of this read contract).
- Hosted canister attachment index / gateway proxy.
- Scooling `MEDIA_LIVE_READ_AUTHORIZED` flip (separate Tier 3 session).

---

## 13. 2F-b-b implementation checklist (Auto — mechanical)

Branch: **`feat/phase-2f-b-attachment-store`** off Knowtation `main`.

| # | Artifact | Notes |
| --- | --- | --- |
| 1 | Extend `mcp/resources/listing.mjs` (or new `lib/attachments/derive.mjs`) | full `media/**` walk + ext→mime reuse |
| 2 | `lib/attachments/attachment-store.mjs` | derivation + `listAttachments`/`getAttachment` + projections + id derivation |
| 3 | `lib/attachments/attachment-store-file.mjs` | `hub_attachment_store.json` load/save (read-only surface in v0) |
| 4 | `lib/attachments/attachment-handlers.mjs` | shared handlers + scope resolution |
| 5 | `hub/server.mjs` | `GET /api/v1/attachments`, `GET /api/v1/attachments/:id` |
| 6 | `cli/index.mjs` | `attachment list\|get` subcommand |
| 7 | `mcp/tools/attachment.mjs` + `mcp/create-server.mjs` wire + `hub/gateway/mcp-tool-acl.mjs` (read-only) | `attachment_list`, `attachment_get` |
| 8 | `docs/openapi.yaml` | Attachments tag + schemas (same change as routes) |
| 9 | Seven-tier tests | §9 file names |
| 10 | `scripts/verify-attachment-read-smoke.mjs` | §10 checklist automation |
| 11 | Muse + Git commit on feature branch | No push staging unless Tier 3 |

**Verification gate (2F-b-b):**

```bash
npm test -- test/attachment-store-*.test.mjs test/attachment-list-get-parity-*.test.mjs
node scripts/verify-attachment-read-smoke.mjs   # against local Hub
```

**Follow-on (not 2F-b-b):** Scooling live wire + `MEDIA_LIVE_READ_AUTHORIZED` Tier 3; Knowtation
attachment consent-toggle writes (`ATTACHMENT_POLICY_WRITES_AUTHORIZED`); OCR derived-artifact gate.
