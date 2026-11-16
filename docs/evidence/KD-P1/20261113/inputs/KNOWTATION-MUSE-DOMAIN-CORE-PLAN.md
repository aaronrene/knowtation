# Knowtation Muse domain — core platform plan

**Date:** 2026-11-13  
**Model for this planning session:** Grok 4.7 (this checkout's session). A separate GPT-6 Astra runtime was not observed.  
**Kind:** architecture and roadmap reconciliation. No implementation, no product test run, no review stamp, no NEXT publication.  
**Decision:** [2026-11-13 Muse domain core direction](decisions/2026-11-13-muse-domain-core-direction.md).  
**Prior research this plan keeps:** [domain and identity roadmap, 2026-11-12](KNOWTATION-DOMAIN-AND-IDENTITY-ROADMAP.md) and roadmap rows DI-01–DI-08.

Canonical NEXT at session entry refused with `next_stale_head`. This plan does not reconstruct a task from the handover and does not publish a successor.

## What a person can do when this is built

A person keeps notes they can open as files, including on their own machine with no remote call. They can ask in their own words and get the relevant note and the relevant saved memory, each with a source and a revision, and only if they are allowed to see them. An approved change stays saved, reads back the same way, and links to the domain record of that change. Identity proofs show who approved an action. A valid proof is not permission to read someone else's vault, and it is not proof that a sentence is true. When a person deliberately shares a scoped open-range thread, the people they allow can find it, read it, and add to it. Private notes and private memory stay private until that person shares them.

That experience is the core platform goal. Today's file vault, keyword and vector search over the vault, and the optional Muse thin bridge are the usable product while this is built. They are not a substitute for the goal, and they are not evidence that the goal was dropped.

## How to read status

| Status | Meaning in this plan |
| --- | --- |
| `implemented-with-evidence` | A named spec status table or dated result record says the bounded slice exists. This session did not re-run it. The acceptance table below is not claimed passed. |
| `planned` | Committed direction or an existing plan. No acceptance evidence in this session. |
| `parked` | Explicitly waiting on a named gate. |
| `missing specification` | The outcome is in scope and the contract for it is not written yet. |
| `unknown` | A current interface, artifact, or fresh status was not in the sources read. Last dated board text is quoted in the evidence column and is not treated as today's pass or failure. |

A roadmap label, a provider class, an SDK method, or a tool name is not release proof. Evidence class is named in the evidence column: dated plan, spec status table, or separately recorded result. Missing evidence is not an implementation pass.

## 1. Domain and authority

| Layer | Holds | Does not hold |
| --- | --- | --- |
| Vault files | Current canonical note bytes for the file-backed product, including offline. | Muse commit identity by themselves. |
| Memory event log | Append-only memory events and the latest-by-type overlay, under the configured provider. | A claim that the default `file` provider is semantic search. |
| Derived indexes | Embeddings, keyword indexes, facet projections, and consolidation summaries for an authorized audience. Bound to source revision and model/version. Rebuildable. | Canonical note bytes. A Muse plugin does not create this store. |
| Muse domain objects | Stable note and object identity, semantic snapshot, diff, and merge according to the domain schema, on branches and commits. | Account login, key custody, or an embedding API. |
| MuseHub | Repository collaboration, package distribution, and identity/attestation services under their own contracts. Hub v1 does not execute the external guest. | Permission to read a Knowtation vault. Semantic search inside encrypted bytes. |

**Search by meaning** ranks authorized note and memory text by the configured retrieval mode (vector and/or keyword) and returns citations. **Semantic diff and merge** compares domain objects by their schema (identity, title, tags, body, and later typed fields) and produces a structural change. Those are different operations. A good search hit is not a merge. A clean merge is not a relevance score.

**Where retrieval runs.** In the Knowtation host already allowed to read the content: the local process for a local vault, or the hosted bridge for content that bridge is allowed to read. See the recommendation in the 2026-11-13 decision. Indexes live with that host's data directory or the hosted memory/search partition, not inside an unauthenticated MuseHub upload.

**Permission.** Knowtation's existing permission authority stays. Linking an identity, following a thread, or holding a signature does not change vault permissions.

**Stable IDs.** Notes already have `note_id` in the accepted synthetic core. Sections use the heading ids from NoteOutline / DocumentTree / SectionSource. Facets use the MetadataFacets field names. Attachments, memories, summaries, personas, and threads need the same treatment in KD-P1: one stable id, a revision pointer, and a provenance class (`user-authored`, `deterministic`, or `model-derived`). Renames keep the stable id. Commit ids identify bytes, not people.

## 2. Semantic retrieval

Included: vault notes and stored memory; semantic and exact/keyword modes; filters for scope, project, tag, time, entity, episode, and causal chain; narrow-first snippets and field selection; source expansion; source and revision citations; current versus historical or branch-specific retrieval; index freshness, reindex, deletion, and model/version compatibility.

**Surfaces to specify, not to imply are equal.** Local CLI (`search`, `memory search`), self-hosted MCP (`search` and memory tools), hosted Hub API (`POST /api/v1/search`, memory routes), and hosted MCP. A surface that does not implement a mode stays listed as unsupported for that mode. UI, CLI, MCP, and API parity is explicit in KD-P1.

**Provider behavior to specify.** Embedding provider selection, startup when the provider is absent, quotas, latency, and failure. Failure returns an explicit error. It does not silently fall through to a result set that looks complete.

**Authorization.** Cross-vault search applies the caller's authorized scope before any hit, count, snippet, or derived summary is produced.

**Two different memory lookups.** A **memory-informed vault query** reads recent memory events of type `search` (and related prompt context) and then searches the vault. A **semantic memory search** runs vector or provider search over stored memory events. The hosted parity document already separates them: `memory-informed-search` uses `GET …/memory?type=search` plus vault search. `POST …/memory/search` is a separate future row and is a stub in that document.

## 3. Persistent memory

Keep the event taxonomy and capture defaults in [MEMORY-AUGMENTATION-PLAN.md](MEMORY-AUGMENTATION-PLAN.md): default capture of `search`, `export`, `write`, `import`, `index`, and `propose`; opt-in `agent_interaction`, `capture`, `error`, and `session_summary`; manual `user` facts. The default provider `file` is key lookup, not semantic recall. Providers `vector` and `mem0` are the plan's semantic-recall paths. README also names Supabase and encrypted tiers; those tiers need the same semantic-routing contract in KD-P1 before anyone calls them complete.

Recorded history, inferred insight, and a user-approved fact stay distinguishable. Consolidation may propose a summary. Discovery may propose an insight. A person reviews before that proposal becomes an approved fact or a vault note. Provenance points at the source events and the source revision.

Retention, export, clear, correction, and permission changes apply to the log, the index, derived summaries, and version history together. A delete that leaves a searchable embedding is not success. Replay of an event is idempotent on its event id. An interrupted or offline sync keeps the local event and reports that the domain commit is pending. A recorded event without matching readback is not a successful save. Failed saves surface the failure.

## 4. Identity and msign

**msign**, as used by MuseHub's identity documentation cited on 2026-11-12, means signed requests bound to an immutable `identity_id`. That anchor stays across key rotation. The current key fingerprint and public key are credentials, not the anchor. Hub-specific derivation means a binding includes the canonical hub origin.

msign is not a login screen, not account linking by itself, not a generic attestation record, and not a legal signature. The Apple native exchange in [KN-APPLE-NATIVE-HOSTED-EXCHANGE-FREEZE.md](KN-APPLE-NATIVE-HOSTED-EXCHANGE-FREEZE.md) mints a Knowtation session from an Apple identity token. That freeze lists cross-provider merge and msign as future work behind the persistence gate. A successful Apple session is not an msign proof.

| Binding | Meaning |
| --- | --- |
| Person or agent identity | Who the product is talking about, including a public persona chosen for sharing. |
| Account or provider identity | Apple, Google, GitHub, or a MuseHub account subject. An alias, not ownership of the vault. |
| Signing key | A credential that can produce an msign or other signed request. Rotation changes the key, not `identity_id`. |
| Authorization | Knowtation's permission decision. Independent of a valid signature. |
| Delegation | A recorded grant to act within a scope. Revocation ends new actions. It does not rewrite past authorship. |

A valid signature shows who signed a payload. It does not grant permission to act, and it does not make the payload true. Recovery and linking require an explicit proof of control of both sides. Matching a name, email, or avatar does not move ownership. Unlink does not delete authored notes.

Passed contracts to reuse: the Apple exchange freeze for its own grant; Scooling's identity adapter and mapping store as the place to extend, without opening Scooling's MuseHub normalization gate until that gate's own qualification passes. The browser and session bridge from msign into Knowtation and Scooling accounts is `missing specification` (KD-ID-01). DI-02 is the row that writes it.

## 5. Open Range

**Canonical name:** algorithm-free open-range threads. Freeze: Scooling `docs/reviews/2026-08-18-social-open-range.md` (`SOCIAL-OPEN-RANGE-a`, amended 2026-09-01 by row 33a). Product note: Scooling `docs/CONNECT-AND-OPEN-RANGE.md`. Inert implementation record: Scooling roadmap row F8b / row 33, `SOCIAL-OPEN-RANGE-b` landed 2026-09-01 as an inert `SocialAdapter`. Live reads stay on tip `SOCIAL-OPEN-RANGE-live`, gated by that freeze's G1 and G2, with MuseHub issue **#152** still named as the live dependency on the 2026-09-01 board.

This plan does not invent a second thread model. Identity-bearing conversations, sources, contributions, branches, forks, merges, and shared history attach to the frozen person-thread and Space-thread design. Knowtation contributes scoped publication of notes and memory, stable ids, and provenance. Scooling contributes the thread experience and product order.

Discovery and search of a thread use the thread's visibility scope. Attribution follows the author binding. Sharing and publication are intentional. Private notes and private memory are absent from public threads until an authorized person shares that material. Corrections and deletion follow the thread contract plus Knowtation's retention rules for any vault object that was the source. Abuse controls stay the ones already in the Scooling freeze; KD-P1 cites them rather than replacing them.

**F7.** Scooling's roadmap, read 2026-11-13, still records MuseHub F7 as mostly delivered as of 2026-09-01 (rows 29 and 29a) and explicitly says whole F7 is not done (Gabriel's audit document and long-lived credential replacement still open on that board). This session did not re-check MuseHub. Current F7 disposition is `unknown`. Do not treat the September board as a fresh pass, and do not treat older "deploy not ready" notes as the live state either. Live open-range remains parked on #152 in that same board, which is a different gate from F7's deploy steps.

Proposed Scooling board edits are in [the companion section](#proposed-scooling-board-edits). This session does not write Scooling's files.

## 6. Structured and multimodal knowledge

Reuse completed read contracts. Do not rebuild them inside the domain guest.

| Contract | Spec status this session read | Domain use |
| --- | --- | --- |
| NoteOutline, DocumentTree v0 | Spec status tables say phases through hosted MCP are implemented on local Muse `main`. | Heading identity and body-free tree. Stable heading ids. |
| SectionSource v0 | Spec records a phase sequence implemented on local Muse `main`, including body-free CLI and self-hosted MCP. Body and snippet policy stays that spec's boundary. | Section identity for citations. KD-P1 must not widen body return ahead of the spec. |
| MetadataFacets v0 | Spec status table says normalizer, CLI, self-hosted MCP, hosted MCP, and the Scooling adapter slice are implemented. | Filters: project, tags, date, updated, causal chain, entity, episode. Extra facet names wait for their own acceptance. |
| Links and backlinks | Existing graph and relate surfaces in the product docs. | Provenance edges with revision pointers in the successor schema (DI-05). |
| Explore / discover insights | [EXPLORE-DISCOVER-INSIGHTS-TO-VAULT-NOTES.md](EXPLORE-DISCOVER-INSIGHTS-TO-VAULT-NOTES.md) is a phased proposal. Phase 0 spec lock is still open in that document. | Human-reviewed materialization. `generated_by` and source event id required. |
| Image, video, audio labels, captions, transcripts, OCR | Companion architecture names embeddings, summaries, and local-versus-managed lanes. Import docs name audio and video transcription as import source types. | Derived fields are `model-derived`, tied to the source revision and model id. They are not user-authored text. |

Deterministic output (a heading id, a normalized tag) is separate from user-authored prose and from model-derived captions or insights.

## 7. Connected surfaces

| Surface | Responsibility already planned | Dependency |
| --- | --- | --- |
| Knowtation | Vault, permissions, retrieval, memory, domain package, review. | This repository. |
| Muse core | Host for an independently owned external domain package (Muse #108 direction, as cited 2026-11-12). | DI-01 pins and a selected runtime. Installed binding in this checkout remains Muse 0.2.1rc13 until a separate task changes it. |
| MuseHub | History, collaboration, distribution, identity services. Does not execute the guest in the approved v1 split. | DI-06 before durable publication. |
| Scooling | Learning and work product, open-range threads, identity adapter. | Scooling board for product order. |
| theBRAIN / companion | Local inference on the client. The companion architecture says the server handles data, identity, permissions, billing, and sync, and does not proxy local inference. | Optional. Not required for the core retrieval outcome when another configured embedding path exists. |
| Agent and creative tools | Existing CLI, MCP, and Hub proposal surfaces. Stori and AgentCeption stay integration plans in the ecosystem vision until their own contracts are accepted. | No new tool in this plan. |

**Deployment.** Local and offline file mode remains valid. Hosted mode uses the existing gateway and bridge authorization. Companion mode may embed locally. Encrypted mode does not upload plaintext for a remote embedding call unless the person has an explicit, separate consent for that call. Capability advertisement must say which retrieval mode is actually configured. Migration from the file vault and the thin bridge is additive: existing notes keep their bytes; domain objects gain ids and commits; `external_ref` on a proposal remains a valid lineage pointer and is not the whole domain.

Optional backends (Mem0, a remote embedding API, MuseHub login) are not required for the core outcome of authorized local retrieval over notes the person already has.

## Capability matrix

| ID | User outcome | Existing requirement / source | Implementation evidence supplied to this session | Present status | Target behavior | Owner | Dependencies | Phase | Observable acceptance |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| KD-AUTH-01 | Notes remain readable as files, offline | Thin bridge; ecosystem vision phase 0–1; 2026-11-13 decision | Dated plans. No fresh run. | implemented-with-evidence | File vault stays a valid canonical note store for local mode | Knowtation | None for local reads | KD-P0 | Open a note with Muse unset and read the same bytes |
| KD-AUTH-02 | A saved change has a domain revision | Synthetic core Phase B; Muse #108 direction cited 2026-11-12 | Phase B result record cited by the 2026-11-12 roadmap. Native path not in that result. | planned | Approve/save links to a domain commit id and reads back | Knowtation domain | DI-01, DI-03 | KD-P2 | Readback matches the commit payload |
| KD-AUTH-03 | Meaning search and semantic merge stay distinct | This plan §1; Phase B validate/snapshot/diff | Phase B covers synthetic diff, not retrieval | missing specification | KD-P1 contract separates the two operations | Knowtation | KD-P1 | KD-P1 | A fixture shows a search hit and a schema diff as different results |
| KD-AUTH-04 | Stable ids survive rename | Synthetic `note_id`; DocumentTree heading ids | Spec/result records for those slices | planned | One id scheme for notes, sections, facets, attachments, memories, summaries, personas, threads | Knowtation | KD-P1 | KD-P1 | Rename keeps id; new commit points at it |
| KD-AUTH-05 | Permissions stay with Knowtation | 2026-11-12 identity section; Apple freeze non-goals | Dated plans | planned | Link, follow, or signature does not change vault ACL | Knowtation | No amendment open | KD-P4 | Unauthorized subject still denied after a valid link |
| KD-RET-01 | Ask in different words, get the note | README search section; retrieval reference; hosted parity `POST /search` | Product and parity docs. This session did not execute search. | unknown | Authorized semantic vault hit with revision citation on CLI, local MCP, hosted API, hosted MCP, or an explicit unsupported list | Knowtation | Embedding provider configured | KD-P3 | Acceptance row A1 |
| KD-RET-02 | Exact/keyword mode | README; retrieval reference | Same as KD-RET-01 | unknown | Keyword mode available and labeled, including when vectors are down | Knowtation | KD-P1 | KD-P3 | A keyword query returns a cited exact hit when vectors are disabled |
| KD-RET-03 | Filter by project, tag, time, entity, episode, chain | README; MetadataFacets fields | Facet read surfaces: spec status table. Filter acceptance: not run here. | unknown | Filters apply before snippets are returned | Knowtation | MetadataFacets v0 | KD-P3 | Out-of-scope tag yields no hit |
| KD-RET-04 | Narrow first, then expand | README two-step retrieval; whitepaper | Product docs | unknown | Paths and snippets first; full source by a second authorized read | Knowtation | Existing get-note contracts | KD-P3 | First response has no full unauthorized body |
| KD-RET-05 | Search a branch or past revision | Domain snapshots | Not in the thin bridge | missing specification | Retrieval can name current, branch, or revision | Knowtation + Muse | DI-03 | KD-P3 | Historical query cites that revision and omits later private edits |
| KD-RET-06 | Rebuild after delete or model change | Memory plan retention; index docs | Docs only | missing specification | Delete and model change drop or rebuild derived vectors | Knowtation | KD-P1 | KD-P3 | Deleted source is absent from the next index |
| KD-RET-07 | Other vaults stay hidden | Parity vault partition notes | Parity doc, not a fresh cross-vault test | unknown | No hit, count, or snippet across an unauthorized vault | Knowtation | Existing ACL | KD-P3 | Acceptance row A1 unauthorized column |
| KD-RET-08 | Embeddings are a chosen provider | Companion architecture; setup docs | Docs. Muse plugin is not an embedding service. | planned | Startup, quota, latency, and failure are explicit | Knowtation | Provider config | KD-P1 | Missing provider returns a named error, not an empty success |
| KD-MEM-01 | Capture follows the taxonomy | Memory augmentation plan | Plan. Default file provider has no semantic recall. | implemented-with-evidence | Defaults stay; opt-in types stay opt-in | Knowtation | None | KD-P0 | File provider records a `search` event and does not claim vector recall |
| KD-MEM-02 | User facts keep provenance | Memory plan `user` type; consolidation guide | Plan | missing specification | Approved fact, inferred insight, and raw event are different types | Knowtation | KD-P1 | KD-P3 | A correction supersedes and leaves the prior event readable as history |
| KD-MEM-03 | Resume a session | Prompts `resume-session`, `memory-context` | Parity matrix documents prompt composition | unknown | Resume cites the summary's source events | Knowtation | KD-P1 | KD-P3 | Resume text points at event ids |
| KD-MEM-04 | Find a memory by meaning | Memory plan `vector` and `mem0`; parity stub for hosted `POST /memory/search` | Ourware review, reused: file/MCP file-memory path does not establish semantic provider operation. Hosted route documented as stub. | planned | Configured semantic-memory routing returns a cited memory event | Knowtation | Provider config; hosted work is past the stub | KD-P3 | Acceptance row A2 |
| KD-MEM-05 | Memory-informed vault search | Parity matrix B3 | Parity doc: `GET` memory type `search` plus vault search. Not memory vector search. | implemented-with-evidence | Stays a distinct mode, labeled as such | Knowtation | KD-RET-01 | KD-P3 | The two modes return different labeled payloads on one fixture |
| KD-MEM-06 | Consolidation proposes, a person accepts | Consolidation guide; explore/discover note | Guides. Materialization phase 0 still open in the explore doc. | planned | Proposals carry provenance and wait for review | Knowtation | Explore phase 0 choice | KD-P3 | Unreviewed insight is absent from approved facts |
| KD-MEM-07 | Clear, export, retain | Memory plan privacy section | Plan | missing specification | Clear and retention cover log, index, summaries, and domain history, with historical-record rules | Knowtation | KD-P1 | KD-P3 | Cleared item is absent from search and export |
| KD-MEM-08 | Failed or offline save is visible | This plan §3 | No contract yet | missing specification | Readback required; pending domain commit is a named state | Knowtation | DI-03 | KD-P2 | Retry after failure does not duplicate the event id |
| KD-ID-01 | msign binds author and action | MuseHub identity page as cited 2026-11-12; DI-02 | Citation is dated. Deployed API not re-read this session. | missing specification | Verify `identity_id`, hub origin, and payload. Refuse invalid and revoked keys. | Knowtation + MuseHub identity owner | DI-02 | KD-P4 | Acceptance row A5 |
| KD-ID-02 | Accounts stay distinct from msign | Apple freeze § non-goals; 2026-11-12 identity table | Freeze text | planned | Apple, Google, and GitHub sessions do not become msign | Knowtation | Persistence gate remains a Scooling/Knowtation gate | KD-P4 | Account recovery cannot retarget another person's notes |
| KD-ID-03 | Signature is not permission or truth | 2026-11-12 plan | Dated plan | planned | Policy check is separate from signature check | Knowtation | KD-AUTH-05 | KD-P4 | Signed request from a revoked member is refused |
| KD-SOC-01 | Shared threads match the frozen design | Scooling SOCIAL-OPEN-RANGE-a freeze | Freeze file read 2026-11-13. Inert b landed per Scooling roadmap 2026-09-01. | implemented-with-evidence | Knowtation cites that design; it does not replace it | Scooling owns the thread product; Knowtation owns scoped share | None for the inert contract | KD-P0 | Docs name SOCIAL-OPEN-RANGE and no second model |
| KD-SOC-02 | A person shares a scoped thread on purpose | CONNECT-AND-OPEN-RANGE; freeze live tip | Live tip still named on MuseHub #152 as of the 2026-09-01 board | parked | Permitted people discover, read, and contribute | Scooling live tip; Knowtation publication | #152 and freeze G1/G2 | KD-P5 | Acceptance row A6 |
| KD-SOC-03 | Private memory stays private | 2026-11-12 pilot journey 5; this plan | Dated plans | planned | No default publication | Knowtation | KD-AUTH-05 | KD-P5 | A private memory id is absent from a public thread index |
| KD-SOC-04 | F7 dependency is recorded honestly | Scooling roadmap rows 29, 29a, F8 | Board text dated 2026-09-01. Not re-checked against MuseHub in this session. | unknown | Owner refreshes F7 and #152 before any live-social claim | MuseHub / Scooling operators | Separate from Knowtation KD-P1 | KD-P5 | A dated status newer than 2026-09-01, or an explicit "still the September record" |
| KD-STR-01 | Headings and trees round-trip | DocumentTree v0 spec status | Spec status table. Tests not re-run. | implemented-with-evidence | Domain snapshot includes the same heading ids | Knowtation | Do not rebuild the parser | KD-P2 | Tree from domain bytes matches the read contract |
| KD-STR-02 | Section citations | SectionSource v0 | Spec phase records. Body policy unchanged. | implemented-with-evidence | Citations use section ids within the body-free boundary until a later accepted phase | Knowtation | SectionSource phases | KD-P3 | Citation resolves to the specified section id |
| KD-STR-03 | Facet filters | MetadataFacets v0 | Spec status table including Scooling adapter slice | implemented-with-evidence | Domain objects carry the same facet fields | Knowtation | v0 field list | KD-P2 | Unknown facet names are refused |
| KD-STR-04 | Derived media stays traceable | Companion architecture; import source types | Architecture brief, not an acceptance run | planned | Caption, transcript, OCR, and summary store source revision, model id, and derivation class | Knowtation | Companion lanes are optional | KD-P3 | Model text is labeled model-derived |
| KD-SRF-01 | Local use without MuseHub | Thin bridge | Operator doc | implemented-with-evidence | Remains true after the domain exists | Knowtation | Decision 2026-11-13 | KD-P0 | Search succeeds with no `MUSE_URL` |
| KD-SRF-02 | Hosted parity is listed per route | PARITY-MATRIX-HOSTED | That matrix. Memory semantic route is a documented stub. | planned | Each KD retrieval mode names hosted support or unsupported | Knowtation | KD-P1 | KD-P3 | Unsupported hosted mode is labeled |
| KD-SRF-03 | Thin bridge remains lineage | MUSE-THIN-BRIDGE | Operator doc | implemented-with-evidence | `external_ref` stays; it is not the domain schema | Knowtation | None | KD-P0 | Approve without Muse still succeeds |
| KD-SRF-04 | Encrypted content is not silently embedded remotely | Companion architecture constraint | Architecture brief | planned | Remote embedding requires a separate consent. Server-side semantic access to ciphertext is out of scope until a design exists. | Knowtation | Decision recommendation | KD-P1 | Encrypted fixture produces no remote provider call in the spec's test outline |
| KD-SRF-05 | Conflicts and migration keep identity | Phase C refusal-only merge/migrate in the R2 packet | R2 scope: merge/migrate are refusal-only for the first native slice | planned | Later slice defines merge, offline reconciliation, and recovery | Knowtation + Muse | DI-01 item 3, then a successor slice | KD-P2 then a named follow-on | Acceptance row A7 on the follow-on, not on the refusal-only slice |

## Acceptance table

Execute this table in a later implementation session. This planning session does not run it. No row is a pass.

| Row | Demonstration | Pass condition | Out of scope for the first slice |
| --- | --- | --- | --- |
| A1 | Meaning-based vault query, wording that does not copy the title | Authorized note returned with source path and revision. Unauthorized caller receives no hit, snippet, or count. | A specific relevance score threshold. Set one in KD-P1 against a frozen fixture, not a live corpus. |
| A2 | Same style of query against stored memory, with semantic memory routing actually configured | A relevant memory event returns with event id and source revision. File-provider mode is reported as non-semantic, not as this pass. | Claiming pass from the tool name `memory_search` alone. |
| A3 | Surface list | Each of CLI, local MCP, hosted API, and hosted MCP is marked pass or explicit unsupported for A1 and A2. | Marking unsupported surfaces complete. |
| A4 | Approved update | Durable content, matching readback, and a link to the domain record or commit. A failed attempt names the failure. An event log line alone is not the pass. | Production catalog publication. |
| A5 | Consolidation and correction | Insight proposal keeps provenance and stays unreviewed until a person accepts. Delete/retention removes or retains history as the KD-P1 rules say. Index rebuild matches that result. | Automatic promotion of insights to facts. |
| A6 | msign | Intended author/action verifies. Invalid or revoked authority is refused. Recovery/linking does not move ownership. | Treating Apple login as msign. |
| A7 | Open range | An authorized person shares one scoped thread. A permitted person can discover, read, and contribute under the frozen SOCIAL-OPEN-RANGE rules. Private notes and memory are absent. | Live tip before Scooling G1/G2 and MuseHub #152 are actually cleared on a fresh record. |
| A8 | Domain round-trip | Objects round-trip and, on the slice that implements merge, merge by schema. Conflicts, offline replay, and migration keep ids. The first native slice may only refuse merge/migrate, and that refusal is its pass for this row until the follow-on. | A green synthetic diff presented as merge. |

**Measures to set in KD-P1, not invented as already passed.** On a frozen fixture of at most a few hundred notes and a few hundred memory events: the authorized hit appears in the top five; unauthorized leakage count is zero; local interactive search returns or fails inside 2 seconds on that fixture with the configured local embedding model; a failed provider call does not write a success event; reindex after delete leaves zero hits for the deleted id. Cost caps stay the existing consolidation and billing caps. These numbers are planning targets for the spec, not measurements.

## Phases

Each core row has an owner, an output, prerequisites, an acceptance result, and a next action. Active B02 vault-availability work in this worktree stays the current implementation queue. These phases are the domain queue beside DI-01–DI-08. They do not start code in this shared worktree.

| Phase | Owner | Output | Prerequisites | Acceptance | Next action |
| --- | --- | --- | --- | --- | --- |
| KD-P0 | Knowtation | This plan, the 2026-11-13 decision, roadmap and handover pointers | Sources listed in the session prompt | A reader can find semantic memory, msign, and open range as core rows | Done as documentation when this plan is in the tree |
| KD-P1 | Knowtation domain owner | Thinking freeze: domain object and retrieval/memory contract. IDs, index location, provider failure, memory-informed versus semantic memory, citation shape, encrypted-content rule, thin-bridge coexistence | This plan. No new Muse runtime pin required to write the spec. | Freeze review pass on that spec. Not this document. | Write that spec in a later Thinking session. Do not implement it here. |
| KD-P2 | Knowtation domain owner | DI-03 native adapter on the pinned runtime, reusing Phase B. Includes readback linked to a domain commit for the synthetic schema. | DI-01 closed. Vault closeout or an explicit stable handoff. Separate implementation authorization. | DI-03 evidence plus acceptance A4 and A8 refusal-only behavior | Keep DI-01 as the decision list. Do not reopen Muse #108 architecture. |
| KD-P3 | Knowtation retrieval owner | Semantic vault search and configured semantic memory search with citations, plus consolidation provenance | KD-P1 accepted. Embedding provider chosen for the fixture. | A1, A2, A3, A5 | Specify hosted `POST /memory/search` as its own slice if the stub remains |
| KD-P4 | Knowtation and Scooling identity owners, with MuseHub identity owner | DI-02 contract and DI-04 adapters. msign verification distinct from session login. | DI-02 text. Deployed identity API confirmed at that time, not from the 2026-11-12 citation alone. | A6 | Draft the contract beside KD-P1. Do not open Scooling's normalization gate from this plan. |
| KD-P5 | Scooling thread owner; Knowtation publication owner | Scoped share into the frozen open-range model. Live discovery only after the live tip's own gates. | Fresh status of MuseHub #152 and F7. SOCIAL-OPEN-RANGE-live gates. | A7 | Record board edits below. Do not implement live social in Knowtation. |
| KD-P6 | Muse/MuseHub owners with Knowtation | DI-06 distribution and DI-07 public pilot | KD-P2 through the gates the pilot actually uses. H4 history/mapping stays a separate publication gate. | DI-07 journeys and zero private leakage | Design trust work early. Qualify it only for the workflows that publish. |

DI-05 (entity and relationship schema) and DI-08 (private Scooling / B06) stay in force. DI-05 is core design beside KD-P1 and implementation before a public pilot. DI-08 is after the public path. B06 remains the next separate producer-interface specification. It does not block KD-P1 or synthetic Phase C.

**Core versus later.** Core completion is KD-P1 through KD-P4, plus the publication boundary in KD-P5's spec. Later enhancements are live open-range discovery (KD-P5 execution), durable public distribution (KD-P6), multimodal thematic jobs beyond existing import transcription, and successful semantic merge beyond the first native slice's refusal-only exports. The later items wait because they depend on named external gates or on a schema successor, not because they are optional to the direction.

## Proposed Scooling board edits

Scooling owns product order. This session did not modify Scooling. Proposed edits for the Scooling owner to apply on that board:

1. Add a pointer from the open-range rows (F8b / row 33 / row 33a) to Knowtation `docs/KNOWTATION-MUSE-DOMAIN-CORE-PLAN.md` so live thread work is sequenced with Knowtation scoped publication, without moving PRIMARY off Scooling's current row.
2. Keep `SOCIAL-OPEN-RANGE-live` parked on MuseHub #152 until a fresh record clears G1 and G2. Do not mark live threads done from the inert adapter land.
3. Split the F7 note from the #152 note if a future edit touches that area: F7 deploy steps and live social identity are different gates. Last combined reading in this session is the 2026-09-01 roadmap text.
4. When identity linking is scheduled, cite Knowtation DI-02 and state that msign is the MuseHub signed-request anchor, not Scooling login.

## Ourware course handoff

This section is learner-facing source material for a later course edit. It does not edit any bound Ourware package, and it does not accept new lessons.

### The experience we are building

Knowtation is the place a person keeps what they know. Notes stay in files they can take with them. Muse and MuseHub are how those notes gain a durable identity, a history of meaningful changes, and a way to work with other people without mixing up who wrote what. Search can find a note or a saved memory from the idea, not only from the exact words. A signature shows who stood behind an action. Sharing a thread is a choice. Private writing stays private until that choice.

People can keep using Knowtation on their own computer today: notes, search over their vault, and saved memory events. The connected domain, semantic search over memory, msign, and live open-range threads are the committed direction from 2026-11-13.

### Learner capability table

| Capability | What a learner can expect | Status word |
| --- | --- | --- |
| Notes in files on their own machine | Read and write without a MuseHub account | Available |
| Search over their own vault | Find notes from the vault index, including meaning-based search when they have configured embeddings | Available as documented for the local product. This handoff does not add a new guarantee. |
| Saved memory of searches and approved notes | The product records memory events. The default file store is lookup by type, not search by meaning. | Available for event capture. Meaning-based memory search is planned. |
| Memory that proposes a summary for a person to review | Consolidation and insight proposals | Planned as a reviewed workflow. Existing consolidation tools are documented separately in the product guide. |
| A Muse domain record for each meaningful change | History of the note as a domain object | Planned |
| msign proof of who authorized an action | Distinct from signing in with Apple, Google, or GitHub | Planned |
| Algorithm-free open-range threads | Scooling's existing learner wording remains its frozen "coming" label. This handoff uses **planned** for the connected Knowtation share. There is no new release date. | Planned |
| Private notes stay private | Sharing is explicit | Available as the permission rule. Live public threads are planned. |

### Concepts to amend when a course edit is actually authorized

- Any lesson that says Muse is only an optional extra, or that a Knowtation domain in Muse is out of the product path. Replace with: the domain is the core direction, and today's file vault remains a supported way to work.
- Any lesson that treats memory-informed vault search and search over memory events as the same feature.
- Any lesson that uses msign as a synonym for login or for the Apple session exchange.
- Any lesson that describes a Knowtation-specific social feed. The name to teach is algorithm-free open-range threads, owned with Scooling's frozen design.
- Any lesson that says a server can semantically search end-to-end encrypted notes. That design does not exist.

Use **planned** for the rows above. Use **in development** only after a session records active implementation evidence. Do not use **coming soon**. Scooling's already published "coming" string can stay as that product's frozen label until Scooling changes it.

## Gaps that still need an owner or a contract

| Gap | Why it is open | Who should own the contract |
| --- | --- | --- |
| KD-P1 retrieval and domain-object spec | Not written | Knowtation domain owner |
| DI-01 five native-entry decisions | Listed, not closed | Knowtation with Muse runtime owners and Gabriel |
| DI-02 msign session bridge | Missing specification | Knowtation, Scooling, MuseHub identity owner |
| Hosted semantic memory route | Documented stub | Knowtation hosted owner |
| Fresh F7 and MuseHub #152 status | Last detailed board text in the sources read is 2026-09-01 | Scooling / MuseHub operators |
| Explore/discover phase 0 product choices | Still questions in that note | Knowtation product owner |
| Successful merge and migrate | First native slice is refusal-only by the accepted R2 packet | Muse host owner allocates the follow-on; Knowtation writes the schema rules |
| Relationship-index service versus Kinship | 2026-11-12 plan leaves the service owner to the platform work | Platform / Kinship owners with Knowtation |

## Next bounded step

**KD-P1.** A Thinking session writes the domain object and retrieval/memory contract described above, then takes it through freeze review. Gates: do not implement; do not run provider tests; do not change identity keys; do not flip network or publish flags; do not edit the bound Ourware package; do not overwrite Scooling's board; do not treat this plan as a freeze pass; do not start the native adapter before DI-01 and a separate implementation authorization. The active B02 pre-installation review stays the implementation priority in this worktree until its own closeout or an explicit handoff.

## Sources read for this reconciliation

Knowtation: README, docs/README, KNOWTATION-ROADMAP, KNOWTATION-OVERSEER-HANDOVER (opening planning blocks), MEMORY-AUGMENTATION-PLAN, WHITEPAPER headings, MEMORY-CONSOLIDATION-GUIDE by reference from the roadmap family, PARITY-MATRIX-HOSTED memory and search rows, ECOSYSTEM-VISION parts 4 and 6, MUSE-THIN-BRIDGE, AGENT-INTEGRATION §4, DOCUMENT-TREE-V0-SPEC status, SECTION-SOURCE-V0-SPEC phase records, METADATA-FACETS-V0-SPEC status, EXPLORE-DISCOVER-INSIGHTS-TO-VAULT-NOTES, COMPANION-APP-MODEL-ROUTING-AND-ENRICHMENT-ARCHITECTURE (constraint sections), KN-APPLE-NATIVE-HOSTED-EXCHANGE-FREEZE non-goals, KNOWTATION-DOMAIN-AND-IDENTITY-ROADMAP, MUSEHUB-DOMAIN-IDENTITY-ROADMAP-HANDOFF.

Scooling (read only): `docs/CONNECT-AND-OPEN-RANGE.md`, `docs/reviews/2026-08-18-social-open-range.md`, `docs/ROADMAP.md` rows for F7, F8, F8b, 29, 33, and 33a. There is no current `docs/ROADMAP.md` alias inside Knowtation; the authoritative file is `docs/KNOWTATION-ROADMAP.md`. `~/scooling` exists and was the tree read. A second `~/SCOOLING` path also exists; the roadmap citations above are from `/Users/aaronrenecarvajal/scooling`.
