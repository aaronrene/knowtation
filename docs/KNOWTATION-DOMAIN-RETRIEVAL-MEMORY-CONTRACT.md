# KD-P1 — Knowtation domain objects, retrieval and memory contract

**Date:** 2026-11-13. **Revision:** 1, proposed for freeze review; not accepted or implemented.
**Owner:** Knowtation domain owner, with the existing retrieval, permission and identity owners named below.
**Branch:** `docs/kd-p1-domain-memory-contract` in the isolated Knowtation worktree.
**Authority:** the owner's single-task KD-P1 instruction and the November 13 core-direction decision. This is a Knowtation contract, not a proposed universal memory service.

The deliverable is a reviewable specification. No freeze pass, native qualification, production readiness, package publication or implementation permission is claimed. The accepted Phase B synthetic schema remains unchanged. “Must” below describes proposed acceptance requirements, not capabilities already shipped.

## 1. Scope and evidence

A person can save knowledge, recall authorized notes and memory with precise sources, correct it without losing the distinction between past and current beliefs, continue locally when sync is unavailable, and remove access without leaving retrievable derived content. Knowtation owns that experience and its permission decisions. Muse supplies deterministic history; MuseHub supplies its separately qualified collaboration, distribution and identity services. Neither becomes an embedding service.

The [core plan reference snapshot](evidence/KD-P1/20261113/inputs/KNOWTATION-MUSE-DOMAIN-CORE-PLAN.md) supplies KD-P1–P6 and acceptance rows A1–A8. The [DI roadmap snapshot](evidence/KD-P1/20261113/inputs/KNOWTATION-DOMAIN-AND-IDENTITY-ROADMAP.md) supplies DI-01–08. The [accepted direction](evidence/KD-P1/20261113/inputs/decisions/2026-11-13-muse-domain-core-direction.md) preserves local/offline use and Knowtation's authority. Those snapshots retain historical instructions as evidence, not executable tasks. This contract does not resume the separate MuseHub repair lane.

[Source inventory](evidence/KD-P1/20261113/sources.json) pins the inspected working files by SHA-256, with their absolute locations. The isolated branch starts at local Muse `main`, `sha256:7ba3e811ecfbf1c9786b2f5a227d7aab17768eb73a16f1f2758036bf908009d5`; it does not contain the active working tree's uncommitted product changes. Claims about current source refer to the inventory, not to an assertion that those changes landed on main. Only three planning documents are copied as reference inputs. Other source links below point to the inspected checkout.

**Current B02:** the handover and exact owner-acceptance record say revision 9 passed adversarial round 9, P1 is complete, and P2 Auto implementation is authorized but not started. The delta digest is `593c82133249f0fdc9c0cdce02430ff68db9078348b911ac36cdbfd9a2b1c295`. Earlier “revision 8” and “round 9 pending” summaries are stale. This session does not execute either B02 prompt. The bound NEXT reader returned `refused: next_stale_head`; this explicit KD-P1 task proceeds without reconstructing or publishing NEXT.

**Evidence classes:** source inspection proves that code is present, not that a deployed surface works. Spec status tables and dated results are attributed separately. No product/provider tests or live services were exercised. The November 3 Phase B record reports 122 passing cases before a small EOF-anchor correction, followed by static predicate-equivalence and syntax checks; it is not a fresh final-source corpus run. See the [Phase B receipt](/Users/aaronrenecarvajal/knowtation/docs/evidence/B02/knowtation-semantic-core-20261103/README.md).

### Release boundary

“First release” here means the bounded Knowtation domain/retrieval outcome of KD-P2–P4 after their entry gates, with KD-P5's publication boundary specified. It is not the first native Phase C slice: that slice remains the accepted synthetic note only, with refusal-only merge/migrate. Live social discovery, production distribution and private Scooling integration retain KD-P5/P6 and DI-08 gates. Missing hosted support may remain explicitly unsupported under A3; it must not be described as parity or a pass.

No memory-domain brainstorm, MovieMaker completion, new shared-runtime install or MuseHub repair closure is a prerequisite for writing or reviewing KD-P1. Concrete changes to shared Muse interfaces still need their maintainers' decisions.

## 2. Capability inventory

Dispositions are exactly **implemented with evidence**, **required first-release gap**, **later extension**, and **unsupported/unverified**. A row's bounded implemented part does not certify the broader outcome.

| Capability and existing plan rows | Disposition | Evidence and precise limit | Owner / phase / acceptance |
| --- | --- | --- | --- |
| Note validation, exact raw source, snapshot, diff, independent replay | implemented with evidence | Phase B receipt and `domains/knowtation-synthetic-v1`; synthetic in-memory Node only, no native wrapper | Knowtation domain; KD-P2 / DI-03; A8 |
| File vault, local keyword/semantic note search, ordinary writes | implemented with evidence | `mcp/create-server.mjs` calls shared vault/search/write services; existing integration docs. Revision-cited KD-P1 outcome is not established | Knowtation; KD-P2/P3; A1/A4 |
| NoteOutline, DocumentTree, MetadataFacets, body-free SectionSource | implemented with evidence | Their spec status tables and MCP source. Facets: project, tags, date, updated, causal_chain_id, entity, episode_id. Existing path/heading IDs are not guaranteed stable across renames | Knowtation structure owner; KD-P2/P3; A1/A8 |
| Memory event taxonomy, latest-by-type, list, local store, clear and JSONL/MIF export | implemented with evidence | `memory-event.mjs`, file provider, CLI memory dispatch; events and export exist, but this does not prove complete retention or idempotent durable domain save | Knowtation memory; KD-P2/P3; A2/A4/A5 |
| Memory-informed vault prompts | implemented with evidence | Local prompt composition and hosted parity B3: recent search events plus vault search, not semantic search inside memory | Knowtation retrieval; KD-P3; A1/A3 |
| Confidence distinction | implemented with evidence | `verifyMemoryEvent` returns verified/hint/stale from path existence/mtime or failed-operation status. This is not source-digest verification or factual truth | Knowtation memory; KD-P3; A5 |
| Semantic memory providers | unsupported/unverified | Vector, Mem0 and Supabase implementations exist. Current CLI/MCP use the synchronous manager and do not await `search`; factory may select file; providers can swallow failures. End-to-end semantic recall not proved | Knowtation retrieval; KD-P3; A2/A3 |
| Hosted semantic memory search | required first-release gap | Bridge route returns empty results and a future-provider note; hosted MCP has memory prompts, not equivalent memory-search tooling. Required before that mode can ship, not an A3 requirement to support all surfaces | Hosted owner; KD-P3; A2/A3 |
| Stable citations, current-source validation, explicit provider failures | required first-release gap | Source/revision binding and failure/completeness envelope below are absent from the current cross-surface contract | Knowtation retrieval; KD-P3; A1–A3 |
| Save/readback with pending domain commit and retry identity | required first-release gap | Existing write/event APIs do not establish A4's complete receipt; current event generation creates a new random ID | Knowtation persistence/domain; KD-P2; A4/A8 |
| Correction, approval and derived-data deletion | required first-release gap | Existing insights/consolidation and clear do not establish transitive invalidation or approved-current-fact semantics | Knowtation memory/permission; KD-P3; A5 |
| Agent identity, consent, grant and audit substrate | implemented with evidence | Delegation v0 contract and local tool handlers exist behind `DELEGATION_ENABLED`; not proof of live delegated memory access or hosted parity | Knowtation identity/permission; KD-P3/P4; A5/A6 |
| Scoped agent memory contributions and live revocation across transports | required first-release gap | Reuse existing delegation/proposal services; bind the new recall/correction contract to them rather than infer permission from tool availability | Knowtation permission; KD-P3/P4; A1/A4/A6 |
| Exact-revision inspection and corrected-belief history | required first-release gap | Current filters cover dates; they do not resolve immutable source citations or distinguish superseded belief from approved current state | Knowtation memory/domain; KD-P2/P3; A1/A5/A8 |
| Arbitrary branch-wide semantic search, bitemporal inference, automatic belief resolution | later extension | Useful for historical research; not needed to resolve a citation or avoid a stale answer | Knowtation domain/retrieval; later KD-P3/DI-05; A1/A5/A8 |
| Successful semantic merge/migrate | later extension | Accepted S3 first native slice requires status-1 refusals, not merge success | Knowtation + Muse; successor DI-03; A8 |
| Portable notes and memory export | implemented with evidence | CLI file export and JSONL/MIF memory export exist; complete revision/provenance/tombstone package is a gap below | Knowtation; KD-P3; A4/A5/A8 |
| Entity/relationship successor schema | later extension | DI-05 design is required now; public pilot expansion uses its separately accepted schema, not synthetic v1 mutation | Knowtation schema + consumer owners; DI-05/KD-P6; A7/A8 |
| msign-to-session binding | required first-release gap | DI-02 still lacks an agreed proof/session mechanism; Apple login and key fingerprints do not supply it | Knowtation + Scooling + Hub identity; KD-P4; A6 |
| Public persona/thread publication and live discovery | later extension | Reuse SOCIAL-OPEN-RANGE; this contract defines sharing boundaries, not a second thread product or fresh external gate status | Scooling / Knowtation; KD-P5/P6; A7 |
| Private Scooling/theBRAIN access to encrypted notes | unsupported/unverified | B06 consumer contract retains absent producer, refused remote plaintext and false read/write capability flags | Knowtation producer / consumer adapters; DI-08; relevant A1/A4/A6 |
| Independently installable reusable domain package | unsupported/unverified | Phase B core has no application service imports; packaging, native ABI and dependency qualification remain separate | Knowtation + Muse; DI-01/03/06; A8 |

### Candidate additions: why now, or why later

These are refinements of existing rows, not a new queue. Each acceptance reference is to §9's elaboration of the existing core-plan A rows.

| Candidate / concrete journey | Proposed disposition and reason | Owner | Acceptance |
| --- | --- | --- | --- |
| “What is our current venue?” after a corrected note or memory | First-release correction relation, approval state and exact-revision citation: otherwise ordinary recall can present a known wrong answer | Knowtation memory/domain | A1/A5: old venue excluded from current facts; explicit historical inspection labels it superseded |
| “What did we believe at every time across branches?” | Later bitemporal/branch-wide index: exact revision lookup suffices for bounded citation/history; full temporal query needs separate indexing and truth semantics | Knowtation retrieval | Later A1/A8 extension; today unsupported-mode error |
| “Why does this summary say that?” | First-release source references, derivation kind and review state: needed to separate extraction/inference from approved knowledge | Knowtation retrieval/review | A5: unreviewed insight never emitted as an approved fact |
| An agent proposes a learning-session summary for its user | First-release actor/principal distinction, scope intersection and proposal-before-approval; reuse delegation and proposal services | Knowtation permission; consumer adapter owner | A4/A6: read-only or revoked actor cannot write/approve; accepted contribution retains actor and approver |
| Offline edits disagree after reconnect | First-release preserve both inputs and explicit conflict/refusal; automatic merge later because Phase C cannot merge | Knowtation persistence/domain | A4/A8: no overwrite, no fake commit, retry does not duplicate |
| User deletes an event or leaves a shared workspace | First-release deny retrieval immediately and track cleanup across indexes/summaries/provider copies; required to uphold permissions | Knowtation permission/memory | A1/A5: zero unauthorized/deleted hits, counts, snippets and expansion; pending cleanup is visible |
| User moves notes and memory to another local tool | First-release export preserves readable bytes, IDs, revisions, provenance and deletion state for included objects; arbitrary provider/agent-framework migration later | Knowtation export owner | A4/A5/A8: export/reimport fixture preserves those values without resurrecting deleted data |
| User shares an event/community graph | DI-05 successor design now; execution later with explicit publication and query ownership, because public graph is not required for private capture/recall | Knowtation schema; Scooling publication | A7/A8 at public pilot, no synthetic-v1 change |

## 3. Boundaries and deterministic domain contract

| Boundary | Owns | Inputs and outputs / exclusions |
| --- | --- | --- |
| Deterministic schema/core | Knowtation domain owner | Already-authorized bytes and explicit config → validated objects/snapshots/diffs/refusals. No accounts, filesystem selection, network, clocks, embedding/model calls or keys |
| Persistence and review services | Knowtation | Vault bytes, event records, approvals, optimistic concurrency, durable readback and domain-commit queue. Reuse existing write/proposal/memory services |
| Retrieval services | Knowtation | Authorized source selection, index lifecycle, ranking, citation resolution, stale/deleted suppression; provider adapter is replaceable |
| Permission and identity services | Knowtation, with agreed external identity adapters | Resolve principal/actor, enforce scopes at operation and delivery; signing is separate evidence |
| Muse / MuseHub | Their maintainers | Deterministic version history / collaboration, distribution and identity under qualified contracts; no private plaintext or permission expansion inferred |
| UI, CLI, API, MCP and consumer adapters | Their existing owners | Validate transport input, call the same services, render outcomes; cannot define different authorization or correction rules |

### 3.1 Preserve synthetic v1 exactly

The accepted document is `knowtation.synthetic-note/1-proposal`, with state fields `data_class`, `note_id`, `source` and `semantic`; data class is `synthetic-readable-markdown`. Source contains `encoding`, `sha256`, `text`; semantic contains `title`, `tags`, `body`. Config is exactly `{}` bytes. The core validates the source hash and recomputed projection instead of repairing mismatches. IDs and raw-byte rules remain the accepted grammar, including the restricted frontmatter. Do not send richer ordinary-vault Markdown or new memory objects through that grammar and call it compatible.

Reuse `execute('validate'|'snapshot'|'diff', ...)` and independent replay as documented in the [core API guide](/Users/aaronrenecarvajal/knowtation/domains/knowtation-synthetic-v1/README.md). The native adapter may wrap this core only after DI-01. Native merge/migrate refusal is a host-profile decision, not a new export implemented by this document.

### 3.2 Proposed service objects, separate from the guest schema

The following is a logical service contract for KD-P2/P3 and the DI-05 successor design. It does not add fields to synthetic v1 or assign a production Muse domain ID. Names below are proposed versioned DTO names, not existing API paths. Their exact serialized successor schema must be accepted before implementation.

| Object | Required identity and revision | Meaning and validation |
| --- | --- | --- |
| Note | Existing stable `note_id` within vault; immutable source revision | Exact canonical bytes retained. Path is a locator and may change. Legacy notes without an established ID require explicit adoption/mapping; never infer identity solely from title/path |
| Section reference | Note ID + exact source revision + existing heading ID / SectionSource ID | Derived reference, body-free by default. Existing IDs can depend on path/heading; renames or heading edits require recomputation at the new revision, not a promise of permanent section identity |
| Facet projection | Note ID + source revision + facet-contract version | Reuse MetadataFacets names and normalization. Derived projection is rebuildable; inferred values remain marked and cannot overwrite authored facets |
| Attachment reference | Stable attachment ID scoped to vault + byte digest + owning source reference | Availability/custody and content permission are checked separately. No implicit fetch, OCR, transcript or remote-provider grant |
| Memory event | Existing event ID scoped to owner/vault + immutable event digest | Preserve `type`, `ts`, `vault_id`, `data`, `status`, `ttl`, optional `air_id`; add new service metadata only through the successor contract. Operation success is not fact approval |
| Memory assertion/correction | Stable assertion ID, revision, source event/note references, optional `supersedes` | Human-authored or proposed fact with explicit review/lifecycle state. Distinct from the activity event that recorded its creation |
| Summary / insight | Stable derived-object ID, revision, complete input references and derivation record | Model/provider/version and optional prompt/template digest retained privately; review state independent. Missing or inaccessible dependencies make the result unavailable or stale, never an approved current fact |
| Entity / relationship assertion | DI-05 successor ID/revision; typed endpoints and predicate | Not in synthetic v1. Reuse note provenance and explicit source/author/evidence/visibility/validity/correction relations; no automatic entity conflation |
| Persona / thread reference | Existing owner-system identifier, qualified by origin/namespace and revision where supported | References to identity and SOCIAL-OPEN-RANGE objects, not replacement stores. Private account mappings never enter public domain content by default |

Stable IDs identify logical objects; digests identify exact revisions. Newly allocated IDs are persisted once by the service and passed as explicit values to deterministic operations. Retry reuses the allocation. On collision with a different payload, refuse; do not overwrite. Rename preserves note identity; cloning into another authority preserves source provenance but does not transfer its permissions. Split/merge identity changes need explicit lineage in a later schema.

All service records have an explicit schema version, owning scope, object ID and revision, provenance, lifecycle/review state and source references as appropriate. Unknown schema versions are refused. New filters/kinds/capabilities require version negotiation; silent field dropping or coercing a new record into v1 is prohibited. ACL decisions remain outside deterministic state; storing a policy reference is not enforcing it.

### 3.3 Citation and provenance envelope

Every KD-P1 retrieval hit and expansion uses a logical `SourceRef`:

```text
SourceRef = {
  schema_version, authority_ref, vault_ref, kind, object_id,
  source_revision: { algorithm: "sha256", digest },
  locator: null | { path, section_id? },
  domain_ref: null | { repository_ref, commit_id, object_revision }
}
```

`authority_ref` and `vault_ref` are opaque caller-authorized references, not private account aliases. Source digest covers exact note/attachment bytes. For a memory event, it covers the exact persisted UTF-8 JSON payload bytes, excluding the store's record delimiter; the receipt records that payload length and encoding. The service retains those bytes instead of reconstructing a revision from a parsed object. Historical events without retained exact payload bytes remain `legacy_hint` until explicitly adopted; never manufacture an old revision. A missing domain commit remains null with save state `domain_pending` or `not_requested`; null is not a committed revision. The host commit's existing ID format is retained without assuming Git widths or synthesizing IDs.

`locator` is a human navigation aid, never identity or authority. A section citation includes both note revision and revision-scoped section ID. Expansion verifies permission and digest again; if the exact source is unavailable it returns `source_unavailable`, not today's bytes under yesterday's citation. Historical source access uses current permission, not old ACLs.

Each hit also carries `provenance_kind` (`user-authored`, `deterministic`, `model-derived`), source references, `review_state` (`unreviewed`, `approved`, `rejected`), lifecycle (`active`, `superseded`, `retracted`, `deleted`), and verification (`exact_revision`, `legacy_hint`, `unavailable`). Approvals bind actor, approver, exact revision and time. No numeric model confidence or retrieval score changes review state. Existing memory `confidence: verified` is exposed as the legacy path/mtime check, not relabeled `exact_revision` or truth.

Timestamps distinguish recorded time from optional claimed event/validity time; they do not replace hashes, ordering or approval. An unsigned/self-reported event time is not a verified historical fact. Evidence text and retrieved content are untrusted data, never executable agent instructions.

### 3.4 Proposed closed first-release service profile

This is the proposed profile for review, separate from synthetic v1. `SourceRef.schema_version` is `knowtation.source-ref/1-proposal`; `kind` is one of `note`, `memory_event`, `memory_assertion`, `summary`, `attachment`. Section/facet references remain projections of a note, not new canonical stores. Persona/thread/entity objects are later typed references and are not accepted by this first profile. Unknown fields in this profile's metadata are refused; an event's existing `data` remains opaque payload governed by its own event validation.

An assertion or summary has a proposed `knowtation.memory-record/1-proposal` envelope with exactly: `schema_version`, `object_id`, `source_ref`, `provenance_kind`, `sources` (array of SourceRef), `review_state`, `lifecycle`, `supersedes` (null or exact SourceRef), `actor_ref`, `principal_ref`, `approval` (null or exact-revision approver receipt), `recorded_at`, `valid_time` (null or a start/end interval) and `derivation` (null or provider/model/template-version metadata). `source_ref` resolves the immutable payload containing the assertion/summary text; it does not embed arbitrary bytes in identity metadata. `approval` binds `source_ref`, authorized `approver_ref`, operation ID and recorded time. `approved` requires a matching receipt; all other states require `approval: null`. `model-derived` requires nonempty source references and derivation metadata. A manual assertion may have no external source, but is labeled self-asserted rather than independently verified.

Proposed metadata bounds are 128 UTF-8 bytes for an opaque object/authority/vault identifier, 64 source references per record and at most one superseded predecessor per correction. Existing synthetic note IDs retain their stricter 64-byte grammar. Existing section/path safety and size limits remain, with no relaxation. SHA-256 digests are 64 lowercase hex characters in the service digest field; Muse commit identifiers retain the host representation separately. Times use UTC RFC 3339 strings; start must precede end when both are supplied. Required fields cannot be silently defaulted from account names or environment configuration. A missing source, mismatching digest, cyclic correction chain or cross-authority supersession is refused. Corrections of another object's state require a new explicitly authorized relation, not ID reuse.

Payloads and metadata have separate revisions: the payload digest identifies the exact authored text/event bytes, while each immutable approval/correction/lifecycle event has its own persisted event bytes/digest. Retrieval reads the current authoritative state projection and returns its revision alongside the payload SourceRef, so approving unchanged text does not falsely look like a new source payload. The service's compare-and-set precondition covers both expected payload and expected state revision. A derived object records all source payload references plus the source state revisions relevant to its approved/current interpretation.

This profile gives the reviewer a concrete proposal to accept or amend. Production schema identifiers, encoding adapters for existing stores and legacy adoption still require DI-05 acceptance; they are not left to transport-specific invention. Rich graph vocabulary, arbitrary extension maps and multi-predecessor semantic merging are outside the first profile.

## 4. Retrieval and index contract

### 4.1 Modes and bounded request

One shared retrieval service accepts requested scope, query, mode, filters, field selection and limit. Authentication supplies principal and actor; callers cannot set them through free-form fields. Modes are:

1. `vault_keyword`: literal phrase/all-terms over authorized current notes; works without embeddings or MuseHub.
2. `vault_semantic`: embedding-based retrieval over authorized current notes, using the configured compatible index/model.
3. `memory_recent`: event-type/topic/time lookup; no semantic promise.
4. `memory_informed_vault`: explicit composition of recent authorized memory and vault retrieval, with separate citations for both.
5. `memory_semantic`: semantic retrieval of stored events/assertions, distinct from mode 4; requires actual provider capability.
6. `source_revision`: exact authorized citation resolution. It does not imply full historical semantic search.

Existing folder/project/tag/date/entity/episode/causal-chain filters keep their published meanings. Note date filters and memory recorded-time filters remain distinct and are declared in the request. Unknown filters or unavailable historical/branch-wide modes are refused, not ignored. Proposed first-release semantic requests default to five hits, cap at 20 and bounded 300-character snippets; count-only and field selection remain supported only where explicitly advertised. Full bodies require a separate authorized expansion. These are proposed service caps, not a silent change to today's CLI/MCP limits.

Capability discovery reports per transport: supported modes, filters, source kinds, maximum limits, locality, provider readiness, revision-citation support and schema version. Existing `prime` resources can advertise this through a versioned extension; do not create another MCP server. A new capability is false until its implementation and acceptance evidence exist.

### 4.2 Authorization and result envelope

Effective scope is the intersection of the authenticated principal's permission, actor grant (if delegated), requested vault/workspace scope, selected object's policy and custody constraints. An adapter can narrow that intersection only. Resource reads, prompts, counts, facets, snippets, source expansion, caches and summaries follow the same check. Cross-vault/global memory settings do not authorize cross-vault recall.

Candidate generation must be partitioned or constrained to authorized data before ranking and before content goes to an embedding/model provider. Recheck source visibility, current revision, deletion and grant state before returning results and on expansion. Derived summaries require permission to all contributing sources; first release suppresses the whole summary if any dependency is inaccessible rather than risk partial redaction. Mixed-scope caches are forbidden; keys include scope/policy generation, source revision, schema and provider/model version. Permission changes fence cached responses and in-flight delivery.

Proposed result envelope:

```text
{ schema_version, requested_mode, executed_mode, status,
  scope_ref, source_watermark, index_watermark, freshness,
  provider: { kind, model_revision, index_schema } | null,
  results: [{ source_ref, provenance, review_state, lifecycle,
              verification, rank, score?, snippet? }],
  completeness: { truncated, reason? }, error: null | { code, retryable } }
```

`status` is `ok`, `partial`, `unsupported` or `error`. `freshness` is `current`, `lagging` or `unavailable`. Count values refer only to authorized results and state whether they are returned-count or a complete authorized total. `ok` with an empty list means the requested supported operation actually completed on the reported scope/watermark. Provider failure, unset credentials, timeout, quota or unknown index cannot become that result. Error details omit private source identifiers and secrets.

Watermarks are opaque service-issued generations for the selected authority/scope, not wall-clock times. An index generation records the canonical-source and policy generations it fully covers. `current` requires coverage of the selected source generation and a fresh permission/deletion check at delivery; exact citation bytes can remain resolvable even when they are no longer current. An in-flight generation change must be revalidated or return `partial/lagging` only when allowed, otherwise explicit non-success. No `current` claim is derived from a recent indexing timestamp alone. Each result includes the state revision from §3.4 in its provenance envelope.

First-release errors include `unauthorized`, `unsupported_mode`, `provider_unavailable`, `provider_timeout`, `quota_exceeded`, `index_unavailable`, `index_incompatible`, `source_unavailable`, `conflict` and `invalid_request`. Network/authentication failures fail closed. An explicitly requested keyword fallback is a separately labeled execution mode, never an apparently successful semantic response. Partial results require caller opt-in and a reason; security filtering is mandatory regardless and does not expose excluded counts.

### 4.3 Index lifecycle and provider behavior

The canonical source is vault/event data; indexes are rebuildable. Each indexed item binds source ID and revision, custody/authority partition, current policy generation, extraction/chunking version and embedding provider/model/dimension. A change of any incompatible dimension invalidates the entry. Query and document embeddings must use the same declared compatible profile; never mix vectors silently.

On save/correction, invalidate obsolete entries before they can be served as current. New entries may be pending. Current recall may return only current authorized hits, labeled `partial/lagging` if indexing is incomplete; strict-complete requests fail explicitly. Keyword current-source lookup remains independently available. Background indexing cannot resurrect an object after a tombstone or permission generation change. Reindex reads only authorized retained sources and publishes a coherent generation; interrupted jobs retain explicit pending/error status.

Provider execution is awaited through the existing service boundary. Startup capability distinguishes file-only mode, initialized semantic mode and failure. Remote providers require separate configured consent for the data and operation; a configured key alone is not disclosure consent. Quotas, cost caps and model choices use existing consolidation/billing policy. Provider/model selection for the frozen fixture is unresolved (§10), not permission to run paid calls now.

Encrypted bytes remain opaque on MuseHub. Retrieval runs only where the authorized key holder has decrypted the selected content for that operation. Derived embeddings/summaries inherit that content's sensitivity. Lock/sign-out/revocation must prevent later retrieval and late result delivery; persistent derived stores need the same approved custody protection. No server-side semantic search over ciphertext is advertised. B06 private-consumer restrictions remain in force even if Knowtation can search its own decrypted content.

## 5. Memory, correction and temporal recall

Retain the current event taxonomy and capture defaults: `search`, `export`, `write`, `import`, `index`, `propose`; agent interactions, captures, errors and session summaries remain opt-in as configured. Manual user entries remain available. Consolidation/insight/maintenance event types already exist in source. This contract does not turn on new capture or store full prompts/bodies by default. Sensitive-key filtering is not a guarantee that arbitrary content contains no private data.

An activity record says an operation happened. A user-authored assertion says a person asserted something. An inferred insight says a model proposed something. An approval says a permitted person approved an exact revision. These are separate claims. A `user` event stored by an agent does not become a user-approved fact because of its type or `status: success`.

Correction creates a new revision/assertion with `supersedes` referencing the prior exact record; it does not silently mutate history. Approval and supersession of the current projection form one service transition with an expected-current revision. Two competing corrections are a conflict requiring review. Until resolution, the service cannot select a winner by timestamp or model confidence; it returns an explicit conflict or excludes the disputed assertion from approved-current facts. Retraction keeps the provenance that it was retracted only where policy permits history access.

Current recall excludes deleted/retracted records and excludes superseded records from current facts. Unreviewed model-derived insights may appear only in an explicitly requested proposal/context view and are labeled. Exact historical inspection may show a superseded assertion with its revision, recorded/valid time and correction reference, subject to today's permission. A date filter alone is never described as “what was true then.” Arbitrary bitemporal query, branch-wide historical semantic ranking and automated belief reconciliation are later extensions.

Consolidation consumes authorized source revisions, emits a derived proposal and records those dependencies. Accepting it uses existing proposal/review services; later input correction invalidates the derived current result and requires recomputation/review. A model never self-approves. Automated direct materialization from the existing Explore/Discover proposal is not selected by KD-P1; product still decides its path/trigger, and any direct local write must retain derived/unreviewed status rather than imply approval.

## 6. Save, fresh readback, offline operation and conflicts

A service save request contains a stable operation ID, object ID or one-time allocation request, expected source revision, intended bytes/event payload, actor/principal binding and requested review action. Idempotency key scope is authority + vault + operation ID. The durable service stores the payload digest with the key. Repeating the same key/payload returns the recorded outcome; a different payload under that key is refused. Existing random event IDs need this service mapping; no current retry guarantee is inferred.

| State | Required evidence and allowed transition |
| --- | --- |
| `local_pending` | Intent retained locally under approved custody; not yet durably written/read back. Never display “saved” |
| `source_saved` | Canonical bytes/event are durable under the selected storage contract and a fresh reader returns matching object ID, revision and exact payload. Readback bypasses stale cache and the writer's in-memory object |
| `domain_pending` | `source_saved` plus durable queue entry for the exact revision; offline/unavailable domain service named. User sees “saved locally; domain commit pending” |
| `committed` | Exact revision appears in the verified domain record with repository/commit binding and fresh readback. A transport acknowledgement alone is insufficient |
| `failed` / `conflict` | Failure stage and retryability retained, local authored bytes preserved. Does not erase an earlier successful source save or overwrite competing content |

Standalone file mode may report `source_saved` and domain status `not_requested`; it remains a valid product outcome. It does not pass the domain-integrated A4 scenario. Offline mode never requires a remote Hub call to read local authorized notes. Semantic offline recall requires an already configured local model/index; otherwise offer an explicit keyword/recent mode or unsupported result.

On reconnect, reauthorize and compare the expected source/domain parent before replay. If permission was revoked, keep the author's local pending material under existing custody but refuse remote publication and shared retrieval. Domain conflict does not roll back a valid local save. No automatic merge or last-write-wins overwrite is introduced; first native merge/migrate still refuse. Crash recovery uses the durable operation record to distinguish not-written, written-but-unverified and committed; an uncertain attempt does not allocate a second memory ID.

Approval must bind the read-back exact revision. A failed optional telemetry capture cannot falsely invalidate a completed note save; conversely a successful telemetry event cannot prove the note saved. Domain commit queue failures and optional capture failures are separate fields. Thin-bridge `external_ref` stays supported lineage, but is not proof of exact domain commit/readback.

## 7. Retention, permission changes, deletion and export

Delete/clear/expiry operate across canonical event state, latest overlays, keyword/vector indexes, provider copies, derived summaries, caches, exports under service control and domain-history policy. Existing local clear is insufficient evidence: vector/Mem0 clear delegates to the file provider; Supabase starts remote cleanup asynchronously and swallows errors. No code repair is part of this specification.

Deletion first installs a durable deny/tombstone generation at the authoritative service, fences in-flight results and invalidates dependency projections. From acknowledgement of that fence, deleted objects cannot appear in retrieval, expansion, counts or new exports. Physical cleanup is a separately tracked operation with per-store acknowledgements and retryable failures. Report `retrieval_removed`, `cleanup_pending` or `cleanup_complete` with an explicit inventory; never report all-copy erasure based on a local file count.

If the authoritative deny state cannot be read, retrieval fails closed. Offline replicas can enforce the last known local state but cannot learn a remote revocation while disconnected. A shared/offline mode therefore needs an accepted grant freshness/expiry policy before release; it cannot promise instantaneous revocation on disconnected devices. Already disclosed plaintext and independently shared copies cannot be recalled. User-owned local files retain their separate local authority; a revoked remote grant does not authorize destructive removal of those files.

The minimal first-release history policy is **current removal plus restricted retained history**, not guaranteed erasure. Exact past content is accessible only with current historical-read authority and only if the selected retention/custody policy retained it. A tombstone cannot remove plaintext already committed into immutable replicated history. Until a feasible history-retention design is accepted, do not publish private/deletable memory plaintext into durable shared history or claim cryptographic erasure; keep local source/readback and pending domain status honest. A retained history pointer itself can be sensitive and must be scoped.

Expiry uses the event's effective retention deadline and applies the same invalidation rules as explicit deletion. Rebuild/replay/import consults tombstones and correction lineage so old events cannot silently resurrect. Existing `retention_days: null` remains the configured no-expiry option; no new universal retention duration is chosen here. Product/custody owners must choose the shared-history and offline-grant policy before the affected mode ships (§10).

Export reuses existing note and memory export services. Proposed first-release portable manifest includes selected exact bytes/events, logical IDs, source digests, provenance/review/correction links, relevant tombstones and optional verifiable domain references. Scope is explicitly selected and reauthorized at export time. Exclude keys, bearer grants, private identity maps, embeddings/provider credentials and unrelated source content. An inaccessible dependency is recorded as unavailable without leaking its private locator. Restore validates versions/digests and collisions, preserves source identity/provenance, and requires target permission; it cannot recreate authority from exported ACL claims. JSONL/MIF export alone is not evidence for this richer manifest. Universal provider migration and whole-account backup are later work.

## 8. Existing transports and consumer journeys

The [agent integration guide](/Users/aaronrenecarvajal/knowtation/docs/AGENT-INTEGRATION.md) is orientation. Source inspection below controls narrower claims. Existing names remain unchanged; proposed envelopes require versioned adapters and review before altering signatures.

### 8.1 MCP inspection and surface matrix

Local stdio and Streamable HTTP both use `createKnowtationMcpServer`. Local tools include `search`, `get_note`, `list_notes`, `get_note_outline`, `get_document_tree`, `get_metadata_facets`, `get_section_source`, `write`, `index`, `import`, `export`, memory and proposal/delegation tools. Core vault operations call shared `lib` services. Local resources include `knowtation://prime`, vault/note listings, config metadata and memory resources. Instructions/roots are scope hints, not authorization.

Local stdio operates with the process's configured vault/filesystem authority. The inspected local HTTP handler defaults to loopback and does not implement hosted JWT/per-user role authentication; a session ID is not a permission grant. Multi-user or untrusted remote exposure of that handler is unsupported by this contract. Use the existing hosted boundary for hosted identities, not a new ad hoc local auth claim.

Hosted `/mcp` resolves authenticated user/vault context, filters tools by role and binds session requests to current context; changed context invalidates the session. Hosted tools forward to bridge/canister services with current credentials. Viewer has read tools; editor/evaluator additionally write/capture/proposal tools; admin adds index/import/export. Tool-list filtering is not a substitute for service-level checks. Resources such as `knowtation://hosted/prime`, vault-info/listing and hosted memory topics, and prompts such as `memory-context`, `memory-informed-search`, `resume-session`, must enforce the same source scope. Topic windows are bounded recent history, not a complete semantic-memory index.

| Journey/mode | CLI | Local MCP | Hosted API | Hosted MCP | KD-P1 disposition |
| --- | --- | --- | --- | --- | --- |
| Current vault keyword / semantic search | `search --keyword` / `search` | `search` with keyword/semantic mode | `POST /api/v1/search` | `search` | Existing bounded code surfaces; A1 revision/permission/failure contract still needs qualification per mode |
| Narrow source reads | get-note/outline/tree/facets/section commands | corresponding read tools/resources | Note routes; structural surfaces are not assumed REST parity | structural tools present in inspected source | Reuse body-free contracts; no new section body permission |
| Capture / approved save | `write`, `propose` | `write`, `hub_create_proposal` and capture tools | Existing note/proposal routes | role-filtered write/proposal/capture | Current operations exist; exact A4 receipt and domain queue are gaps |
| Recent memory / latest / store | `memory query/list/store` | `memory_query/list/store` | memory GET/store routes | memory prompts/resources; no equivalent store tool in inspected ACL | A3 must advertise the actual distinction |
| Semantic memory | `memory search` exists; sync/await gaps | `memory_search` exists; sync/await gaps | `/api/v1/memory/search` stub | no semantic-memory tool in inspected ACL | Unsupported/unverified today; KD-P3 shared service fix/qualification, not a second server |
| Memory-informed vault search | service composition by caller | existing prompt | recent memory + vault search composition | existing prompt | Distinct from semantic memory, cite both sources |
| Memory export/clear | JSONL/MIF export; confirmed clear | `memory_clear` confirmed; no equivalent full export tool claimed | memory clear route | no matching memory clear/export tool claimed | Existing support incomplete for §7; do not advertise deletion parity |
| Immutable historical/branch retrieval | not established | not established | not established | not established | Exact citation resolver required; arbitrary branch semantic search unsupported |
| Encrypted private foreign-consumer read/write | local custody path only | no new foreign-consumer grant | no plaintext permission implied | no plaintext permission implied | DI-08/B06 gates remain closed |

Current memory-route auth/source partitions are inspected structure, not fresh proof that every role, revocation and encrypted case passes. A3 implementation evidence must exercise those edges across tools, resources and prompts. CLI/API/MCP share service rules rather than duplicating the new memory policy in dispatchers.

### 8.2 Concrete consumer mapping

Classification applies to the journey, not the product as a whole.

| Consumer / journey | Classification | Reuse and remaining boundary |
| --- | --- | --- |
| Knowtation user finds a note by words, inspects headings, opens it | supported with evidence | Existing local CLI/MCP services and structural spec status; KD-P1 revision-cited completion remains a missing service capability |
| Knowtation agent saves a proposed session summary for approval | adapter/configuration need + missing service capability | Existing memory/proposal/delegation services; configure allowed scope and add exact revision/approval linkage, never treat memory_store as approval |
| scool.ing signed-in helper retrieves selected permitted notes | supported with evidence, bounded source inspection | `knowtationVaultRetrieve.ts` lists up to 8 candidates, applies workspace scope and fetches capped bodies for prompt context; not semantic-memory or immutable-revision proof |
| scool.ing learner recalls an approved correction with its sources | missing service/tool capability | Consume Knowtation's cited retrieval/correction API through existing vault adapters; no duplicate index/parser or private mapping store |
| scool.ing community discovers a published event/place/knowledge link | domain-schema gap | DI-05 assertions/public projection and KD-P5 SOCIAL-OPEN-RANGE; publication/endpoint permissions at every hop, no invented second thread model |
| theBRAIN uses local authorized note context for inference | adapter/configuration need; end-to-end integration unverified | Existing local CLI/MCP may supply scoped context to an authorized local process. Companion is optional; no evidence that a named theBRAIN runtime is currently connected |
| theBRAIN returns a summary for durable memory | missing service/tool capability / adapter need | Reuse proposal service with actor/source/revision metadata; inference output is not a grant to write or approve |
| scool.ing or theBRAIN asks for private encrypted note plaintext | missing producer capability, currently unsupported | B06 explicitly records absent producer and false read/signed-write/proposal flags. Generic MCP and device pairing do not satisfy this gate |

Scooling's inspected agent architecture already assigns canonical memory to Knowtation and requires scoped adapters/review-before-write. Its dated theBRAIN tools freeze does not authorize Knowtation write-back. This session does not inspect or claim fresh deployed theBRAIN integration; that uncertainty is a status, not a reason to build a general agent framework.

### 8.3 Synthetic second consumer — modularity acceptance under A8

In a later bounded test, a tiny synthetic consumer imports only the deterministic core contract and receives already-authorized in-memory fixture bytes. It validates, snapshots, diffs and independently replays the accepted v1 examples with identical bytes/digests/refusals. It preserves provenance when passing opaque source references through a service adapter. It cannot call the core to bypass source selection or permission.

Acceptance requires a dependency inventory proving no import of Knowtation UI, account database, embedding vendor, deployment config, runtime environment credentials, filesystem/network selectors or mutable global application state. Inputs include explicit IDs/config; no implicit clock/ID generation in the core. Unknown versions/unsupported operations refuse. Service adapter tests separately demonstrate narrower scope and no permission expansion. This specifies a test consumer, not a second application or an independently installable package promise. Phase B's existing in-memory separation is the starting evidence; packaging/ABI qualification belongs to DI-01/03/06.

## 9. Completion journeys mapped to the existing acceptance table

The core plan's **Acceptance table** controls row meanings. Some earlier capability-matrix cells in that plan are off by one: identity is A6, open range A7, domain round-trip A8; this document uses those definitions. No duplicate acceptance queue or test suite is created here. All demonstrations below are future work, not passes from this documentation session.

| Bounded journey | Existing acceptance and required demonstration | Owner / phase |
| --- | --- | --- |
| Capture/save → fresh readback | **A4**, with **A8**: approved note and manual memory use a stable operation ID; fresh reader matches exact source revision; integrated case links the commit or reports pending. Fail after write/before receipt and retry without duplicate event; stale parent refuses | Knowtation persistence/domain; KD-P2 / DI-03 |
| Authorized recall → source/revision expansion | **A1/A2/A3**: meaning query retrieves expected authorized note/event with exact reference; keyword/recent modes labeled; re-read resolves exact revision. Unauthorized caller gets no source, snippet, count or derived summary; exercise each supported transport | Knowtation retrieval/permission; KD-P3 |
| Corrected knowledge → approved current answer | **A5**, supported by **A1/A2/A8**: unreviewed insight stays a proposal; approved correction supersedes original, invalidates derived summary/index; current answer uses new fact. Explicit history shows old state labeled; conflicting corrections refuse automatic resolution | Knowtation memory/review/domain; KD-P3 |
| Offline save → reconnect or refusal | **A4/A8**, surfaced by **A3**: local read/write works without Hub; pending commit survives interruption; reconnect reauthorizes and verifies parent. Revoked/conflicting replay preserves local bytes and refuses remote completion. First native merge/migrate return required refusal | Knowtation persistence/domain; KD-P2 / DI-03 |
| Permission/deletion change → retrieval and derived-data change | **A1/A2/A5/A6**: revoke between query and delivery; delete event with embedding/summary; suppress immediately and track cleanup. Rebuild/export/replay cannot resurrect. Offline policy limitations are explicit | Knowtation permission/memory; KD-P3/P4 |
| msign author/action proof | **A6**: agreed DI-02 proof binds origin, identity, action and existing account; invalid/replayed/revoked proof refused, rotation preserves identity, unlink never transfers ownership | Identity owners; KD-P4 / DI-02/04 |
| Explicit scoped publication | **A7**: preview exact fields/attachments/attribution, publish only with permission, enforce thread/endpoint visibility, keep private source references private | Knowtation publication + Scooling; KD-P5 |
| Independent deterministic consumer | **A8**: §8.3 dependency/byte/refusal checks, no synthetic-v1 modification or package-install claim | Knowtation domain; KD-P2 / DI-03 |

### Fixture and measurable thresholds

Freeze a synthetic fixture of **100 notes and 100 memory events**, two vaults, two principals and one scoped agent. Include deterministic distractors, repeated headings/renamed paths, one correction chain, competing corrections, an unreviewed derived insight, a failed operation, a deleted item with derived index/summary, one revoked share and one encrypted-scope negative case. No real notes, mappings or keys. Pin manifest and expected object/revision relations before implementation tests; this is a new service fixture, not an addition to the sealed Phase B corpus.

For A1/A2, use five predeclared paraphrase queries for notes and five for memories, each with one expected authorized relevant object and an explicitly permitted review state. Each expected hit must appear in the top five; unauthorized leakage is zero across results, snippets, counts, facets, prompts and expansions. No relative score threshold is inferred across providers. Provider/model/runtime/hardware and warm/cold conditions must be recorded; the proposed local interactive bound is return **or explicit failure within 2 seconds** for each query, without hiding model startup. Readiness may report unavailable while loading. Quota/timeout/offline/model mismatch must produce explicit non-success, with zero success events for failed search. Reindex after deletion yields zero deleted-ID hits.

A4 uses fresh independent-reader readback, retries at each state boundary and conflicting payload reuse; A5 checks rebuild/export after corrections, deletions and permission changes. A3 records pass or explicit unsupported per tested mode/transport, with actual evidence references. Hosted absence cannot be marked tested success. Existing cost caps remain; selecting a fixture provider is a review decision and does not authorize calls in this session.

## 10. Precise open decisions and owners

Roles below are coordination responsibilities, not claims that Gabriel or another owner approved the proposal.

| Existing row | Decision to close | Proposed boundary / who decides / entry blocked |
| --- | --- | --- |
| KD-P1 / DI-05 | Exact successor object/SourceRef/event canonical encoding, persistent ID adoption and operation/receipt schema | Keep synthetic v1 intact; Knowtation domain/retrieval owners accept a separately versioned service/schema contract. Blocks new schema implementation, not this review packet |
| KD-P3 | First-release surface selection and fixture embedding profile | Recommend local CLI + local MCP for A1/A2 first, existing hosted vault surfaces qualified separately; hosted memory remains explicitly unsupported until its own slice. Product/retrieval owners choose provider/model/version/hardware and caps before execution |
| KD-P3 / DI-05 | Exact historical-read policy, event expiry and derived/provider cleanup guarantees | Recommend current removal + restricted retained history; custody/product owners choose stored history content, retention durations and feasible deletion acknowledgements before shared memory history ships |
| KD-P3/P4 | Shared offline-grant freshness and late revocation behavior | Existing permission/custody owners select bounded grant validity and disconnected behavior; no instantaneous offline revocation promise. Blocks shared offline claims, not user-owned local file use |
| DI-01.1 | Non-timeline dispatch and domain ID | Knowtation + Muse runtime owner/Gabriel agree exact caller and ID; never impersonate `timeline_wasm_test` |
| DI-01.2 | Runtime, ABI, helper and resource-profile pins | Exact artifact hashes/profile; preserve accepted fuel/memory bounds and distinguish 2-second job from 10-second worker. No installed runtime replacement |
| DI-01.3 | Feature declaration and refusal-only operations | Muse host + Knowtation accept status-1 merge/migrate refusals for the first native slice; successful operations remain later |
| DI-01.4 | Caller diagnostics/shared host-policy change | Prefer existing local assertion; host owner allocates any actually required shared code/diagnostic, not a speculative redesign |
| DI-01.5 | Development package identity | Knowtation + Muse agree synthetic descriptor/schema/config/profile binding; development identity is not production authority |
| DI-02 | msign ↔ Knowtation/Scooling account/session bridge | Identity owners select supported proof mechanism, verifier/API, audience/origin canonicalization, nonce/expiry/replay store, consent and rotation/recovery behavior. No profile lookup or Apple login substitution |
| DI-05 | Entity/assertion vocabulary and query ownership | Knowtation owns canonical knowledge schema/permissions; Scooling consumes through adapters. Decide external relationship projection ownership with concrete platform/Kinship interface work; no universal memory-domain owner dependency |
| KD-P5 / DI-06/07 | Public projection, package visibility/licensing and distribution qualification | Preserve current visibility/license. Package/code/schema/docs/synthetic-example reuse is a distinct release choice from user-data sharing. Muse/MuseHub trust/history and publication owners qualify only relevant later modes |
| DI-08 / B06 | Private producer interface and foreign-consumer custody | Existing producer/consumer owners close B06 separately; no plaintext/session/write grant from generic MCP availability |

DI-02's proposed minimum linking invariant is a verified binding of **canonical hub origin + immutable identity_id** to an existing internal principal, with explicit proof of control of both and exact action consent. Key fingerprints are rotating credentials. Challenges must be audience/action-bound, expiring and single-use; conflicting links require explicit resolution. Recovery re-proves control and preserves note ownership; unlink blocks future binding use without rewriting past authorship. A public persona link needs separate publication consent. Actual protocol payload, browser/session handoff and revocation checks await the identity owners' agreement and later deployed-interface qualification. No key changes or API calls are authorized here.

DI-05's smallest useful later graph is a community hosting an event at a place, a consenting persona contributing to an activity, and a published knowledge artifact documenting it. Assertions carry their own ID, typed endpoints/predicate, source revision, issuer/evidence, visibility, optional validity interval and correction state. Each traversal checks edge and endpoint permissions before counts, snippets or explanation. Knowtation owns private projections; the shared query-service owner is unresolved. This is a demonstrated consumer need and a versioned successor, not a reason to expand the native v1 packet now.

## 11. Review and native-integration entry criteria

**KD-P1 review entry:** this contract, pinned input inventory, truthful surface/capability matrix, bounded A1–A8 mapping and explicit unresolved decisions are available together. Reviewer should challenge false current-source claims, correction/approval transitions, deletion/rebuild races, offline limitations, source citations, provider failure behavior, agent scope and the modularity case. Record findings against the exact document digest. Author self-checks are not independent freeze review. No review stamp or ledger pass is authored here.

**KD-P1 completion:** independent freeze review passes the exact revised contract under repository requirements and the product/domain owner accepts it. Choices necessary to freeze a concrete service slice must be resolved or explicitly narrowed to unsupported modes; “unresolved” must not become an implementer's silent default. DI-01, external identity mechanism and publication decisions may remain recorded future-entry gates when they are outside that accepted slice. Preparing this packet does not mark KD-P1 accepted or authorize KD-P2–P6.

**KD-P2 / DI-03 native entry:** all five DI-01 choices closed in writing; accepted Phase B inputs/core preserved; exact isolated runtime/package profile pinned; B02 vault closeout or explicit stable handoff; separate bounded implementation authorization. Native scope is synthetic validate/snapshot/diff with required resource/output/refusal conformance. No real private-vault enrollment, successful merge/migrate, distribution or deployment inferred.

**KD-P3 entry:** accepted retrieval/memory slice and selected synthetic provider fixture; shared-service implementation plan closes source citations, provider awaits/readiness, correction, authorization and deletion behavior for each advertised surface. **KD-P4 / DI-04:** DI-02 agreed and interface qualified before enabling identity adapters. **KD-P5:** publication boundary accepted before any share, live discovery only through its existing gates. **KD-P6 / DI-06/07:** qualified trust/history/distribution and public-pilot journeys. **DI-08:** B06 and the particular private custody/authentication modes qualified separately.

No product code, provider tests, identity-key changes, installed runtime changes, deployment, remote messages, Scooling board edits or Ourware changes are part of this deliverable. The active Knowtation worktree, B02 artifacts and NEXT retain their separate authority.
