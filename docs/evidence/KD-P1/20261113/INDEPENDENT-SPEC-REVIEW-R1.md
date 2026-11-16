# KD-P1 independent specification review — round 1

**Date:** 2026-11-13 (America/Los_Angeles), verification completed 12:48 PST.
**Kind:** independent, adversarial review of a draft specification. Static source and contract inspection only.
**Verdict:** **FINDINGS.** Four High, five Medium and three Low findings. No Critical finding. The packet is not blocked.

This report is not a freeze stamp, an adversarial-freeze ledger pass, owner acceptance, completion of KD-P1 or authorization to build. It does not repair the contract.

## 1. Subject, identity and evidence limits

| Item | Value |
| --- | --- |
| Subject | `docs/KNOWTATION-DOMAIN-RETRIEVAL-MEMORY-CONTRACT.md`, revision 1, 61,835 bytes |
| Subject SHA-256 | `e542b2a4cbdcb63d810559ac10cc1e59cb88e4051c529b74742c6735016ffd81` (matches the handoff, `packet-manifest.json`, `validation.json` and `handoff-checks.json`) |
| Worktree | `/Users/aaronrenecarvajal/knowtation-kd-p1-20261113` |
| Muse branch / base | `docs/kd-p1-domain-memory-contract` at `sha256:7ba3e811ecfbf1c9786b2f5a227d7aab17768eb73a16f1f2758036bf908009d5`, established from the store's worktree registry (`.muse/worktrees/kd-p1-20261113.json`, `.muse/worktrees/kd-p1-20261113.HEAD`) and branch ref |
| Reviewer | Claude Opus 5.5 (Anthropic), running in Cursor in a new chat. One agent. I have no KD-P1 author or reviewer role in this chat. The contract does not record its author's model. The core plan records Grok 4.7 for its own planning session. I make no claim about any other chat. |
| Source root inspected | `/Users/aaronrenecarvajal/knowtation`, the active checkout, read-only. Below, `[active]/` means that root. |

**Evidence classes used.** Source presence, meaning that code exists, from static reading. Spec and status text, attributed to the document it came from. One small synthetic calculation, described in H2. No product, provider or test runs, no live services, no deployments and no network calls. Runtime and deployed behavior are **not** asserted. Where I say "the code does X", I mean that the inspected working-file bytes do X when executed as written. I did not execute them.

**Unpinned files.** These files are outside `sources.json`. I record their current SHA-256 values as present-time observations, not as pinned evidence:
- `[active]/mcp/resources/metadata.mjs`: `faecec44a630c1cfd7596552b5ece35447751757cb35f6c8fce6aa1cf50fadc4`
- `[active]/mcp/tools/sampling-rerank.mjs`: `4859768bfb46f1bbbeb2cf4cccaf31c91fe1d71060a6946060ca5f78e562a841`
- `[active]/lib/search.mjs`: `3103619aa6ab004ed27bdcb63100ef1a39a14f5c60244195ae1d6c380ed07d89`
- `[active]/mcp/prompts/register.mjs`: `36bff382833cff58061e2cd3d97fdef4c7c41757ebb59b7c707f46cf88220c03`
- `[active]/lib/vault.mjs`: `b2d57da68c1ea0321f39e6318819d9fc36df40d17cb83ac15020cbbe734c0421`
- `[active]/lib/note-outline.mjs`: `49b328eab461d713fa2fd6bbf13e2efcd6ffa33af93729bb2f11fb503688805c`

### Packet verification and drift

- **Packet manifest.** All 11 listed files exist and match their recorded byte counts and SHA-256 values. I checked twice: at session start and again at 12:48 PST, immediately before writing this report.
- **Sources.** All 52 entries in `sources.json` match. **No source drift** was found.
- **Protected active files.** The 7 entries in `validation.json` (`.muse/HEAD`, `.git/HEAD`, `.git/index`, `docs/NEXT.md`, roadmap, handover and B02 delta) match. I checked before and after my only Muse command.
- **B02 status has advanced past the packet.** See L3. The handover hash is unchanged, so its text still reads "P1 complete, P2 next". However, the newer file `[active]/docs/evidence/B02/unattended-availability-implementation-20261110/preinstall-delta-regressions/IMPLEMENTATION-PACKET-20261113.md` exists (SHA-256 `b9b0f60655c88cf45db1ada72f9ab9843d5ff11cb51ba983e32a8a6506c45d32`, last modified 12:42:36 PST, during this review). It describes itself as a "preliminary implementation packet ... for separate P3 review. It does not claim P2 completion". It also records a gap that "keeps the packet short of the P2 gate". Other writers are active in that checkout. I did not execute, read further into or take over any B02 work.
- **Tooling hazard.** I ran `muse status` once from the isolated worktree. It reported the **active checkout's** branch (`docs/scooling-brain-pair-relay`) and that checkout's staged product files, not the KD-P1 branch. The worktree's `.muse` file points at the shared store. The protected hashes were unchanged afterwards, and the store's `stat_cache.msgpack` and `cache/` timestamps show no write. Until worktree resolution is verified, do not run Muse write commands (`add`, `commit`, `checkout`, `merge`) from this worktree. Trust the worktree registry, not `muse status`, for branch identity.

## 2. Findings

Severity reflects how much each finding matters to freezing this contract, not how urgent the underlying code defect is. Each code observation is a counterexample to a contract claim or a reuse instruction. None is a request to fix product code in KD-P1.

### High

#### H1. Integrated domain commit for "approved note and manual memory" is promised, but no first-release schema can hold either

- **Contract:**
  - `docs/KNOWTATION-DOMAIN-RETRIEVAL-MEMORY-CONTRACT.md:291` requires that "approved note and manual memory ... integrated case links the commit or reports pending".
  - `:212-213` defines `domain_pending` and `committed`.
  - `:43` lists "Save/readback with pending domain commit" as a required first-release gap.
  - `:338` limits native scope to "synthetic validate/snapshot/diff".
  - `:314` defers successor encoding to DI-05.
  - `:85` says not to send richer ordinary-vault Markdown or new memory objects through v1.
  - `:230` says not to publish deletable memory plaintext into durable shared history until a retention design is accepted.
- **Plan:** `docs/evidence/KD-P1/20261113/inputs/KNOWTATION-MUSE-DOMAIN-CORE-PLAN.md:194` scopes the KD-P2 output to "readback linked to a domain commit **for the synthetic schema**".
- **Source:** `[active]/domains/knowtation-synthetic-v1/core/note.mjs:70,77,80` refuses any frontmatter field other than `title` and `tags` (`frontmatter_unsupported`). There is no memory-event document type.
- **Counterexample:** A user stores a manual memory, or saves an ordinary note with `date:` or `project:` frontmatter. No accepted domain schema can represent it, and DI-05's successor is not native-implemented in KD-P2–P4. The object can only stay `domain_pending` indefinitely, with a queue entry that nothing will ever consume and a permanent "domain commit pending" message. Otherwise an implementer must invent a schema, which `:85` prohibits. For memory, `:230` additionally forbids putting deletable plaintext into durable shared history. The A4/A8 domain-save promise and the history policy therefore contradict each other. This is the release-blocking contradiction that attack-checklist item F asks about.
- **Impact:** A4/A8 cannot pass as written for two of their named object types. "Saved locally; domain commit pending" becomes a misleading permanent state.
- **Smallest correction:** State that, in the first release, the domain-commit states apply only to objects with an accepted, native-supported domain schema (today, the synthetic fixture note). Ordinary notes and memory events report a declared domain status such as `not_requested` or a new `domain_unsupported`, never `domain_pending`. Run A4's integrated case on the synthetic fixture. Run A4's standalone case on ordinary notes and manual memory. Record "DI-05 successor native support" as a named later entry gate for domain commit of those types.
- **Rows:** A4, A8; KD-P2, KD-P3; DI-03, DI-05; KD-AUTH-02, KD-MEM-08.
- **Owner decision:** Choose the status label, and confirm that domain commit of real notes and memory is a later gate.

#### H2. "Exact source bytes" cannot be derived consistently against the stores and write path the contract says to reuse

- **Contract:**
  - `:95` says notes keep "Exact canonical bytes retained".
  - `:77` says "Reuse existing write/proposal/memory services".
  - `:122` says the memory-event digest covers "the exact persisted UTF-8 JSON payload bytes, excluding the store's record delimiter".
  - `:206` requires a save request carrying "intended bytes/event payload" and an expected source revision.
  - `:211` requires that a fresh reader returns the "exact payload".
  - `:218` says "an uncertain attempt does not allocate a second memory ID".
  - `:105` says that on an ID collision with a different payload, the service must refuse.
- **Source counterexamples:**
  1. **Note writes re-serialize and can lose data.** `[active]/lib/write.mjs:121-136,155` re-reads the file, parses frontmatter through `[active]/lib/vault.mjs:206-217` (default `yaml.load`, which treats invalid YAML as `{}` and trims the body's trailing whitespace), and re-emits it with `yaml.dump` (`write.mjs:85-86`). I replicated those exact calls with js-yaml in an empty temporary directory, without importing product modules. A body-only append to `date: 2026-11-13` / `tags: [venue, plan]` produced `date: 2026-11-13T00:00:00.000Z` and block-list tags. A file whose frontmatter was unparseable lost that frontmatter entirely (`---\n{}\n---`). A file with no frontmatter gained `---\n{}\n---`. There is no expected-revision check: the read at `:121-131` and the write at `:155` are not atomic.
  2. **Encrypted memory has no plaintext persisted bytes and rewrites unrelated records.** `[active]/lib/memory-provider-encrypted.mjs:117` persists AES-GCM ciphertext with a random IV (`:65`). `clearEvents` and `pruneExpired` re-encrypt **every surviving event** with new IVs (`:163,193`). If "persisted bytes" means stored bytes, clearing one event changes the revision of every other event. If it means plaintext, the contract does not say so.
  3. **Supabase stores fields, not bytes, and drops `status`.** `[active]/lib/memory-provider-supabase.mjs:75-82` inserts `id, type, ts, vault_id, data, ttl, air_id` into columns. There is no `status` field, so a failed operation reads back without its failure marker, and the JSON bytes are not retained.
  4. **Retries create new bytes.** `[active]/lib/memory-event.mjs:97-99` assigns a random `id` and the current `ts` on every call. `:218` freezes the ID across retries but says nothing about `ts` and `recorded_at`, which are inside the digested bytes.
- **Impact:** Two conforming implementers will compute different revisions for the same save. One will hash the requested bytes and the other the re-serialized file. One will hash ciphertext and the other plaintext. One will freeze `ts` and the other regenerate it. A4 readback can "pass" while authored frontmatter was silently discarded. A retry after a crash can produce a different digest under the same ID, which `:105` would then refuse as a collision even though nothing actually conflicts.
- **Smallest correction:** Define the revision basis exactly. It is the SHA-256 of the plaintext record bytes the service serialized once, retained independently of storage encoding, encryption wrapper, re-encryption or row mapping. The operation record fixes `id`, `recorded_at`/`ts` and those bytes before the first write attempt. Exact-revision note saves are full-byte replacements under an atomic compare-and-set. If the existing merge-and-reserialize write is reused, its output bytes are the revision, they are returned in the receipt, and it must refuse rather than drop unparseable frontmatter. Note that providers which cannot retain bytes (Supabase rows, Mem0) can only be index or copy stores, not the canonical store.
- **Rows:** A4, A5, A8; KD-P2, KD-P3; DI-05.
- **Owner decision:** Whether the existing write path may be reused for exact-revision saves at all.

#### H3. Approval is not bound to the prior state, and "state revision" is undefined, so offline replay can approve a retracted assertion

- **Contract:**
  - `:134` says the approval receipt binds `source_ref` (the payload), approver, operation ID and time.
  - `:138` says each state event has its own digest, retrieval returns the "state revision", and compare-and-set covers the expected payload and the expected state revision.
  - `:178` says the state revision goes "in its provenance envelope", but the result envelope at `:168-172` has no state-revision field and `provenance` has no defined shape.
  - `:198` says approval and supersession form one transition with an expected-current revision, and that competing corrections are a conflict.
  - `:218` says reconnect compares the "expected **source/domain** parent".
  - `:232` says replay and import consult correction lineage.
- **Counterexample:** Assertion X is `unreviewed` at state revision S1. Device A, online, retracts X, producing S2. Device B, offline, approves X based on what it last saw (S1), producing a receipt that binds X's unchanged payload digest. On reconnect, `:218` compares only the source or domain parent. The payload is unchanged, so the comparison passes. B's receipt carries no expected prior state, so neither replay nor a later import (`:232`) can tell that the approval was made against a superseded state. X becomes approved-current even though a permitted person retracted it. A second derivability gap follows from the same text: "state revision" could be a hash of the latest transition record or a hash of a canonical projection. These behave differently when replicas apply the same transitions in different orders, so compare-and-set tokens would not agree across CLI and MCP implementations.
- **Impact:** This breaks A5's central guarantee that only an approved, current fact is presented as current. It also makes `:198`'s conflict rule unenforceable for offline or imported state.
- **Smallest correction:**
  - Define the state revision as the digest of the latest immutable state-transition record. Each record's bytes include `prev_state_revision`, which forms a hash chain and makes forks detectable.
  - Every approval, correction, retraction and lifecycle receipt binds `expected_state_revision`.
  - Reconnect, replay and import apply a state transition only when its `expected_state_revision` matches the current chain head. Otherwise the result is `conflict`.
  - Add `state_revision` as an explicit result-envelope field.
- **Rows:** A5, A4, A8; KD-P3; DI-05; KD-MEM-02.
- **Owner decision:** None needed beyond accepting the mechanism.

#### H4. The recommended first-release surfaces have no defined way to tell actor from principal, so an agent can author "user" facts and approve its own proposals

- **Contract:**
  - `:146` says "Authentication supplies principal and actor".
  - `:244` says local stdio runs with process authority, and the local HTTP handler has no per-user authentication.
  - `:315` recommends local CLI plus local MCP as the first surface.
  - `:134` requires an `approver_ref`, and `:202` says "A model never self-approves".
  - `:196` says an agent-stored `user` event is not a user-approved fact.
  - `:66` says a read-only or revoked actor cannot write or approve.
  - `:302` requires a fixture with "two principals and one scoped agent".
- **Source:**
  - `[active]/mcp/tools/memory.mjs:59,76` (`memory_store` always writes `type: 'user'` with no actor field).
  - `[active]/mcp/tools/agent-delegation.mjs:47,113,148` (the principal is `config.user_id ?? 'cli-user'`).
  - `[active]/mcp/http-server.mjs:30-43` (each session creates a full server with no authentication).
  - `[active]/docs/AGENT-DELEGATION-V0-SPEC.md:97-103` (the actor must resolve from the agent registry plus a grant, never from caller-supplied text).
- **Counterexample:** An MCP client agent on local stdio calls `memory_store`. That creates `provenance_kind: user-authored`, because nothing distinguishes the caller. The same connection then invokes whatever local approval operation KD-P3 adds. `approver_ref` and `actor_ref` both resolve to the same process identity, so the model has approved itself and the receipt looks like a valid human approval. On these surfaces, the fixture's second principal and scoped agent cannot be represented at all.
- **Impact:** A5 ("stays unreviewed until a person accepts"), A6 and the agent-proposal journey at `:66` cannot be demonstrated on the surface the contract recommends. The text forbids the outcome but specifies no mechanism to prevent it.
- **Smallest correction:**
  - Specify actor derivation per transport. Local stdio and local HTTP MCP calls are always `actor_kind: agent`, with an identity drawn from the delegation registry or a fixed local-agent identity. The principal is the configured local owner.
  - `user-authored` provenance and approvals are accepted only through a human-gesture channel that is not exposed as an MCP tool, such as interactive CLI confirmation or the Hub UI.
  - Alternatively, choose the hosted surface for A5 and A6 and leave local MCP proposal-only.
  - Select surfaces for A4, A5 and A6 explicitly. Today `:315` selects surfaces only for A1 and A2.
- **Rows:** A4, A5, A6; KD-P3, KD-P4; delegation SD-4/SD-10 reuse.
- **Owner decision:** Required. Decide whether local MCP may ever approve, and which surface carries A5 and A6 first.

### Medium

#### M1. The deletion and readback inventory misses stores the existing memory surfaces actually read

- **Contract:**
  - `:38` marks memory-informed prompts as "implemented with evidence", including hosted B3.
  - `:224` names vector, Mem0 and Supabase as the incomplete clear paths.
  - `:253,256,260` record the hosted rows as structure only.
  - `:68` requires deny-on-departure.
- **Source counterexamples:**
  1. **Hosted store and list split.** In Blobs mode, `[active]/hub/bridge/server.mjs:3500-3531` (`memory/:key`, `memory/store`) and `:3569-3584` (`memory/clear`) use the bridge's local file provider. `:3533-3561` (`GET /api/v1/memory`) and capture (`:3012-3030`) use Netlify Blobs. Hosted prompts and resources read only `GET /api/v1/memory`: `[active]/hub/gateway/mcp-hosted-server.mjs:2469,2535,2602` and the topic resource at `:3138,3169`. The parity matrix at `[active]/docs/PARITY-MATRIX-HOSTED.md:95` documents that list reads Blobs. Result: a hosted clear does not remove what `memory-context`, `memory-informed-search` and `resume-session` show, and a manually stored hosted memory never appears in them.
  2. **Lossy Blobs appends.** `server.mjs:3630-3634` does an unlocked read-modify-write append, `:3625` silently truncates to 500 events, `:3843` overwrites with a consolidation set, and failures are swallowed (`:3617,3626`). Concurrent captures can lose events with no error.
  3. **No vault-membership check on memory routes.** `[active]/hub/gateway/server.mjs:1052-1072` proxies memory routes to the bridge, relying on the bridge for isolation. `server.mjs:3484-3491` derives only the user ID and takes `X-Vault-Id` from the header. A member removed from shared vault V can still list their memory events for V, including V's note paths and queries. By contrast, hosted MCP checks `allowed_vault_ids` (`[active]/hub/gateway/mcp-proxy.mjs:165-167`).
  4. **Local legacy fallback.** The `last_search` and `last_export` resources (`[active]/mcp/resources/register.mjs:373,386`; `[active]/mcp/resources/metadata.mjs:127-145`, unpinned) call `mm.getLatest('last_search')` with the raw key (`metadata.mjs:131`). Event types are `search` and `export` (`[active]/lib/memory-event.mjs:8-9`), and only `getMemory` applies the key mapping (`[active]/lib/memory.mjs:504-508`). The manager lookup therefore never matches, and the resources always fall back to `getMemory()` (`memory.mjs:536-547`). That function reads a plaintext file provider at `data_dir/memory/default` regardless of the configured vault or scope, and then reads legacy `data_dir/memory.json` (`:564-573`). No clear path references `memory.json` (it appears only at `:553,566`). Clearing a non-default vault or the global scope leaves `memory/default` untouched. The result: the resource can show the default vault's last search while another vault is configured, and can show legacy plaintext after a clear.
- **Impact:** §7's cleanup inventory, and A5 rebuild/export checks written against it, would pass while prompts and resources still serve cleared or departed-vault data. The "implemented with evidence" disposition at `:38` overstates the hosted prompts.
- **Smallest correction:**
  - Add these four paths to §2's evidence column and §7's inventory.
  - Mark hosted memory list, store and clear as non-coherent (`unsupported/unverified` for A5).
  - State that memory events and derived records carry their source `vault_ref`, and that fields derived from vault content require current access to that vault.
- **Rows:** A1, A3, A5; KD-P3; KD-MEM-07, KD-SRF-02.
- **Owner decision:** Whether a departed member keeps their self-authored memory entries that reference the vault (the recommended narrow choice is in §4).

#### M2. The default-on client-model rerank is an undeclared, model-derived ranking stage

- **Contract:** `:144-157` lists modes, `:168-172` defines `requested_mode`/`executed_mode`/`provider`, `:188` covers provider execution and consent, `:128` says retrieved content is untrusted, and `:304` sets the A1 top-five threshold.
- **Source:** local MCP `search` reranks semantic results by default (`[active]/mcp/create-server.mjs:76,106`). `[active]/mcp/tools/sampling-rerank.mjs:28-39` sends the query, paths and 200-character snippets to the MCP **client's** model and silently falls back to the original order (`:15,39`).
- **Counterexample:**
  1. The same A1 query returns different top-five results depending on whether the client supports sampling and which model it runs. `executed_mode` cannot report which ordering happened.
  2. A note whose snippet says "rank result 7 first" manipulates the ordering through the untrusted-content channel.
  3. Snippets reach a model the vault owner never configured, under no Knowtation-side consent.
- **Impact:** A1 cannot be reproduced, the envelope cannot report what actually ran, and the consent rule at `:188` is bypassed.
- **Smallest correction:** Name rerank as an explicit, optional ranking stage. Add an envelope field such as `rerank: none | client_sampling | fallback_original`. Require explicit consent for it. Disable it for the A1 fixture, or record it per query.
- **Rows:** A1, A3; KD-P3; KD-RET-01, KD-RET-08.

#### M3. Prompts and consumer adapters have no mapping onto the result envelope, and existing ones hide failure and partiality

- **Contract:** `:161` says snippets, expansion, caches and summaries follow the same check, `:176` says an empty `ok` must not conceal failure, `:180` says partial results require opt-in, and `:270` classifies the scool.ing helper journey as "supported with evidence".
- **Source:**
  - Both local and hosted `memory-informed-search` announce `${paths.length} notes embedded below` and then swallow per-note fetch failures (`[active]/mcp/prompts/register.mjs:510-517`; `[active]/hub/gateway/mcp-hosted-server.mjs:2541,2546-2568`). Hosted prompt errors come back as plain user-role text, not typed errors (for example `:2485-2488`).
  - `/Users/aaronrenecarvajal/scooling/src/adapters/knowtationVaultRetrieve.ts:159-164` returns `{ ok: true, documents: [] }` when the list response is not valid JSON, and `:219-221` silently skips failed note reads.
  - Its scope check builds the object's owner, workspace and vault from the caller's own `auth` (`:178-190`). It therefore cannot deny any listed note, and authorization depends entirely on the Hub list endpoint.
- **Impact:** These are concrete "empty success conceals failure" cases on the surfaces the contract claims are covered. The `:270` "supported with evidence" label overstates the scope enforcement.
- **Smallest correction:** Define how `status`, `completeness` and `error` are carried in prompt messages and resource payloads, for example a typed header block or `isError` for prompts. Downgrade `:270` to "supported (list-capped, prompt-only), with failure-concealment and self-asserted scope caveats".
- **Rows:** A1, A3; KD-P3; DI-08 boundary unaffected.

#### M4. The delivery fence contradicts the reused delegation rule for runs in flight

- **Contract:** `:163` says "Permission changes fence cached responses and in-flight delivery". `:295` says "revoke between query and delivery". `:44-46` says reuse delegation and retain its gates.
- **Source:** `[active]/docs/AGENT-DELEGATION-V0-SPEC.md:343` says an "in-flight run on pinned grant **may finish** steps already authorized on that grant version".
- **Counterexample:** A delegated agent starts a recall step and the grant is revoked mid-step. Delegation v0 permits the step to finish and deliver. The contract requires delivery to be fenced. An implementer has to guess which rule wins.
- **Smallest correction:** State that, for retrieval and expansion content, the delivery fence overrides delegation's finish-in-flight allowance, and that the allowance applies only to non-disclosing steps. Alternatively, record an explicit amendment to the delegation spec.
- **Rows:** A1, A6; KD-P3, KD-P4.
- **Owner decision:** Required. This changes the semantics of an accepted spec.

#### M5. The latency criterion is unspecified enough to pass a system that always fails fast

- **Contract:** `:304` says "return **or explicit failure** within 2 seconds ... without hiding model startup. Readiness may report unavailable while loading", and that warm and cold conditions are recorded.
- **Counterexample:** A provider that always returns `provider_unavailable` in 50 ms meets the latency clause. The only other gate is the relevance clause, and the text does not say which run (cold or warm), how many attempts, or which percentile must meet 2 seconds with a successful result.
- **Smallest correction:** State that all 10 queries must succeed warm within 2 seconds each, and that cold start may return `unavailable` within 2 seconds but must reach readiness within a stated bound.
- **Rows:** A1, A2; KD-P3. Plan context: core plan line 184.

### Low

#### L1. Section IDs are ordinal-positional, which the narrowing of KD-AUTH-04 should state explicitly

- **Contract:** `:96` and `:124` already say section IDs are revision-scoped.
- **Source:** `[active]/lib/note-outline.mjs:203-205` builds IDs as `h{level}-{slug}-{ordinal}`, and `[active]/lib/section-source.mjs:135-137` prefixes the path slug.
- **Counterexample:** A note has `## Notes` at ordinal 2 and ordinal 5. Inserting an earlier heading shifts them to 3 and 6. A new `## Notes` heading inserted at ordinal 5 then reuses the old ID `h2-notes-0005` for a different section. Carrying a section ID across revisions by string equality silently resolves to the wrong section.
- **Correction:** Add "never map section IDs across revisions by equality". Record the deviation from KD-AUTH-04 ("Rename keeps id", core plan line 134) as an owner-acknowledged narrowing.
- **Rows:** A1, A8; KD-AUTH-04, KD-STR-02.

#### L2. The digest representation bridge to v1 is unstated

- **Detail:** `:136` specifies 64-character hex digests. Synthetic v1 uses the prefixed form `sha256:<hex>` (`[active]/domains/knowtation-synthetic-v1/core/note.mjs:7`).
- **Correction:** State the mapping for SourceRefs pointing at v1 documents.
- **Rows:** A8.

#### L3. The B02 status line is stale

- **Detail:** `:18` says "P2 Auto implementation is authorized but not started". Newer dated evidence (see §1) shows a preliminary P2 implementation packet for P3 review that does not claim P2 completion.
- **Correction:** In the next revision, cite the handover by date and hash rather than restating B02 status. Do not take over that task.
- **Rows:** none (preservation status only).

## 3. Coverage of checklist A–H

| Item | Checked | Result | Not checked |
| --- | --- | --- | --- |
| A Evidence and scope | Memory factory and sync search (`memory.mjs:405-460,341-342`; MCP `memory.mjs:132-137`; CLI `cli/index.mjs:871,945`); provider swallow and clear; hosted stub (`server.mjs:3563-3567`); delegation tools; B06; theBRAIN wording; Phase B receipt; refusal-only native slice versus first release (`:24`) | Semantic-memory characterization is **accurate**. The file fallback returns explicit `UNSUPPORTED`, and the un-awaited Promise path only occurs after an async import in the same process. The hosted stub is correctly separated from prompts. B06 is accurate. theBRAIN is honestly unverified. Gaps: M1, M3, M4, H1 | The Scooling theBRAIN tools freeze and agent architecture were not read in depth. Deployed parity and B3 merge state are not established |
| B Objects and revisions | v1 core, SourceRef, memory-record envelope, ID and collision rules, rename, unknown versions | H2, H3, L1, L2. Unknown-version refusal and v1 preservation are **sound**. Single-predecessor cycle refusal is stated, with no chain-depth bound noted | DI-05 canonical encoding (deferred by the contract) |
| C Retrieval | Envelope, watermarks, cache keys, recheck before delivery, semantic and full-body paths (`lib/search.mjs:60-63,114-123`), rerank, prompts | Spec rules for the source/permission race and empty success are **sound**. Gaps: M2, M3 | Vector-store and keyword filter internals; hosted search ACL beyond the gateway context |
| D Memory and agents | Activity versus assertion versus approval, `type=user` by an agent, competing corrections, stale summaries, delegation | H3, H4, M4. Competing-correction conflict rule is **sound** | Consolidation internals (`lib/memory-consolidate.mjs`) |
| E Persistence and offline | State table walk: before write, durable but unverified, read back but not queued, committed but unacknowledged; reused operation ID; revocation on reconnect; divergent parents | Operation-record recovery is sound *provided* H2's fixed-bytes rule is added. Divergent state parents: H3. Partial success and telemetry separation are **sound** | None beyond the H2 and H3 dependencies |
| F Deletion and retention | Tombstone fence, cleanup states, offline replicas, history policy, export | Fence and limits are **honest**, with no impossible erasure promise. Gaps: M1 (inventory) and the H1 history contradiction | Export manifest implementation (does not exist yet) |
| G Encryption and modularity | §4.3 custody, B06, encrypted provider, second consumer | Core imports only `node:crypto` and internal modules (`core/*.mjs`), so §8.3's starting evidence holds. The packaging distinction is kept. Encrypted bytes: H2 | WASM, native and package qualification (out of scope) |
| H Decisions and acceptance | A1–A8 mapping against the Acceptance table (core plan 172-182); shifted matrix cells confirmed (KD-ID-01→A6, KD-SOC-02→A7, KD-SRF-05→A8); fixture; DI-01 five decisions (`:318-322`); DI-02 (`:323`); DI-05 ownership (`:324,330`); no invented Gabriel approval (`:310`) | Mapping and preservation are **sound**. Gaps: H1 (A4/A8 scope), H4 (surface for A5 and A6), M5, L1 (KD-AUTH-04) | Fresh F7 and #152 state (not needed) |

## 4. Decision table

The recommendations are the reviewer's narrowest evidence-based choices. **No owner has accepted any of them.**

### Required to freeze the bounded KD-P1 contract

| Decision | Finding | Recommended narrow choice | Decides |
| --- | --- | --- | --- |
| Domain status for objects with no accepted domain schema | H1 | `not_requested` (or `domain_unsupported`); A4 integrated case on the synthetic fixture only; DI-05 native support named as a later gate | Knowtation domain owner |
| Revision byte basis and whether existing write may be reused | H2 | Plaintext service-serialized bytes, fixed in the operation record; atomic compare-and-set full replace; refuse unparseable frontmatter | Knowtation persistence/domain |
| State-revision mechanism | H3 | Hash-chained transitions; receipts bind `expected_state_revision`; replay mismatch is `conflict` | Knowtation memory/domain |
| Actor derivation and approval surface | H4 | Local MCP is always an agent actor and proposal-only; approvals only through a human-gesture channel; name the surfaces for A4, A5 and A6 | Knowtation permission and product owner |
| Delivery fence versus delegation finish-in-flight | M4 | Fence wins for disclosing steps | Knowtation permission (delegation spec owner) |
| Departed member's vault-derived memory | M1 | Deny vault-derived fields on departure; keep only self-authored manual text without vault paths | Knowtation product/permission |
| Rerank stage | M2 | Declared, consented, labeled; off for the fixture | Knowtation retrieval |
| Latency pass condition | M5 | All warm queries succeed within 2 s; bounded cold readiness | Knowtation retrieval |

### Later entry gates (recorded, not freeze blockers)

| Gate | Blocks |
| --- | --- |
| DI-01.1–01.5 (dispatch and domain ID, runtime and ABI pins, refusal-only operations, diagnostics, development package identity) | KD-P2 / DI-03 native |
| DI-05 canonical successor encoding and query ownership | KD-P3 schema implementation; native commit of real notes and memory (H1) |
| KD-P3 fixture provider, model, version and hardware profile and caps | KD-P3 execution (no paid calls authorized) |
| Shared-history retention and offline-grant freshness policy | Shared memory history; shared offline claims |
| Hosted memory semantic slice; hosted list/store/clear coherence | Any hosted A2 or A5 claim |
| DI-02 msign/session proof mechanism | KD-P4 / A6 |
| KD-P5 / DI-06 / DI-07 publication, licensing, distribution | A7, public pilot |
| DI-08 / B06 producer | Private Scooling and theBRAIN plaintext |

## 5. Next bounded action

**Author revision 2 of the KD-P1 contract** in a separate author session. It should:
1. Resolve or explicitly narrow H1–H4 and M1–M5. Lows are optional.
2. Record the owner decisions marked above, without presuming their outcome.
3. Repin the packet manifest.

Then run a **fresh independent review (round 2) in a new chat** against the new digest. Do not start KD-P2–P6, native work or provider runs.

The formal freeze binding is a separate, later step. Its missing prerequisites as of this review are:
- no review launcher bound to the isolated worktree (`handoff-checks.json` `isolated_bound_review_launcher_present: false`);
- the active launcher is bound to the active root, and its NEXT reader refuses `next_stale_head`;
- no producer nonce or review stamp exists for this draft;
- Muse worktree resolution must be confirmed before any Muse write (see the tooling hazard in §1).

## 6. Preservation confirmation

- The only file written by this review is this report. It did not exist before.
- The contract, copied inputs, `sources.json`, `validation.json`, `handoff-checks.json`, `packet-manifest.json`, `review-readiness.md`, `KD-P1-NEXT-SESSION.txt`, the roadmap, the handover, NEXT, existing reviews, ledgers and B02 artifacts were **not edited**.
- No product code, tests, configuration, keys, providers or runtimes were changed. No staging, commit, push, PR, merge, message or deployment occurred.
- I made no Scooling or Ourware edits and did not resume any MuseHub work.
- The only command run against the shared Muse store was a single read-only `muse status`. Protected-file hashes matched afterwards.
- The js-yaml replica ran in an empty temporary directory, wrote no files and imported no product modules.
