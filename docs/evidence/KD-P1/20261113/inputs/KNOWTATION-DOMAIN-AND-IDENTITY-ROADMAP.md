# Knowtation domain and identity roadmap

**Master plan for the integrated goal, 2026-11-13:** [KNOWTATION-MUSE-DOMAIN-CORE-PLAN.md](KNOWTATION-MUSE-DOMAIN-CORE-PLAN.md) and [the direction decision](decisions/2026-11-13-muse-domain-core-direction.md). This November 12 research stays the readiness snapshot, the DI-01–DI-08 evidence, the five Phase C decisions, and the repair sequence. Semantic memory, msign's protocol boundary, and algorithm-free open-range threads are core rows in the November 13 plan. They are not optional extras on top of the native adapter.

**November 12, 2026. Research and planning; implementation remains queued.**

**Follow-through update, later November 12:** the owner reports that #235–237
are being worked in another workspace. Its current records supersede the earlier
operational snapshot below where progress has changed; this update does not
independently establish containment or repair completion. The
[main roadmap](KNOWTATION-ROADMAP.md) tracks DI-01–08 with milestone triggers and
closure evidence. Use the [MuseHub documentation handoff](MUSEHUB-DOMAIN-IDENTITY-ROADMAP-HANDOFF.md)
to carry this plan into that workspace without duplicating its active repair work.

**Make the Knowtation domain and identity-linking foundation the next strategic
initiative after the current encrypted-vault closeout.** Design their interfaces
together, then build the native domain adapter and account-linking adapters as
separate, coordinated pieces. Public knowledge discovery can follow without
waiting for every private sharing, inference, or social-feed feature.

We are closer than the older domain plans suggest: the accepted synthetic
semantic core was implemented on November 3. The immediate domain work is
**Phase C native integration**, not starting the parser again. It needs five
specific Muse decisions. Durable production installation needs additional trust
and history work. MuseHub 0.2.3rc3 is an encouraging release milestone, but its
version number does not close these dependencies or repairs #235–237.

This plan records the owner's requested priority. It leaves the active B02
freeze, its review sequence, installation authority and current worktree intact.
It does not authorize implementation, publication, or deployment. The
[vault work order](VAULT-CURRENT-WORK-ORDER.md) remains the source for the active
vault task. Historical launch entries below the new navigation notices are
preserved; this plan updates their domain destination and sequencing.

**What was originally intended**

The connection is part of the original direction. The
[ecosystem vision](ECOSYSTEM-VISION.md) assigns owned knowledge to Knowtation and
typed history/collaboration to Muse and MuseHub. The
[September domain assessment](reviews/2026-09-25-knowtation-muse-domain-assessment.md)
describes stable note identity, semantic change, and Scooling consumption through
Knowtation's permission boundary. The June
[Scooling identity contract](/Users/aaronrenecarvajal/scooling/docs/ECOSYSTEM-IDENTITY-LINKING-CONTRACT.md)
already planned additive account linking without forcing users to re-register.

The live [Ourware website](https://ourware.org), retrieved November 12, presents
Knowtation as memory, Scooling as learning/work, MuseHub as provenance, and a
connected system of people, places and knowledge. It also presents Kinship as a
shared logic layer. Decide how the relationship/query work belongs within that
existing platform ownership before creating a second graph authority.

The ambition is established. A universal, permission-aware graph is still
application work: installing a Muse domain does not by itself resolve people,
connect places to activities, or discover all useful paths between them.

**Current readiness, with the boundaries that matter**

| Area | Evidence as of November 12 | Consequence |
| --- | --- | --- |
| Encrypted vault availability | November 12 independent review accepts local synthetic implementation: 85 passing focused cases. M1/M2 pre-installation delta has a mechanical freeze pass, but still needs adversarial review and owner acceptance. | Finish this active work before switching the Knowtation implementation effort. Installation and standing consent remain separate. |
| Knowtation semantic core, Phase B | Accepted R2 contract; 122 fixed corpus cases recorded passing; stable `note_id`, raw bytes, title/tags/body, validate/snapshot/diff and independent replay exist. | Reuse the core. Native execution, real private semantics, merge and migration are outside that result. |
| Muse external-domain host | Issue #108 records an approved independent-package architecture and a working timeline reference through ordinary CLI; retained rc15 qualification supports the local host direction. | A useful host exists. The reviewed development discovery still selects `timeline_wasm_test`; it is not a Knowtation entry point. |
| Production domain installation | Host follow-up retains three gaps: authenticated permission/freshness, revocation/rollback, signed package selection/history. | Required before supported durable distribution, not before all isolated synthetic work. |
| MuseHub release | Owner reports Gabriel announced 0.2.3 RC.3 live. Both public repository pages and current `dev/pyproject.toml` corroborate 0.2.3rc3 source. Anonymous staging/production health checks returned healthy. | Source/version corroboration and health are not an attestation of the exact deployed API and worker artifacts. Pin those when qualifying integration. |
| Muse versions | Current upstream `dev` source says 0.2.2rc2; Knowtation's November 12 binding is still installed 0.2.1rc13. Earlier external-domain evidence used rc15. | These are different artifacts. Select and pin a compatible isolated development runtime; do not silently upgrade the shared installation. |
| MuseHub repair queue | Live public #235, #236 and #237 were all open, publicly assigned to Gabriel, with no comments. Newer local ownership notes assign Aaron containment and then these repairs. | Reconcile board ownership with Gabriel; use the newer coordination record for local planning. Open issues do not prove every described defect still reproduces on rc3. |
| Knowtation canonical history | H4 compatibility/history/mapping remains open. | Blocks canonical integration/publication; does not block local documentation or separately authorized isolated development. |
| Scooling identity | Source enables persistent identity mappings and approved aliases. MuseHub persistence is specifically refused; subject/username normalization remains unverified. | Extend the existing adapter/store. The historical “no persistence yet” narrative is stale. |
| Connected discovery | Scooling's repository adapter exposes history/provenance with `socialGraph: false`; live social reads/writes remain false. Knowtation's older graph is mostly note/path links. | Deep relationship discovery remains to be built and qualified. Public mode supplies a useful first scope. |

Phase B evidence has a precise qualification: its runtime run preceded a small
EOF-anchor correction. The record includes static equivalence over 4,471 corpus
samples and final syntax checks, rather than a second runtime execution. Preserve
that evidence honestly; do not restart the completed phase without a relevant
change or demonstrated defect. See the
[Phase B result](evidence/B02/knowtation-semantic-core-20261103/README.md) and
[domain API guide](../domains/knowtation-synthetic-v1/README.md).

**The sequence and when to begin**

There are two current delivery lanes. Knowtation finishes the bounded vault
availability work. MuseHub finishes controlled-delivery containment, then
#235–237. The domain/identity initiative is next in product priority; upstream
repair ownership should be handed off explicitly if it still occupies the same
person. A remote publication blocker need not idle safe local development.

| Stage | Work | Entry and completion criteria |
| --- | --- | --- |
| Now: preserve current delivery | B02 pre-installation correction; MuseHub containment and repair lane below. Prepare domain decisions and identity contracts in documents. | Keep current reviews and exact artifact approvals. Do not start domain code in this shared active worktree. |
| Next: close domain decisions | Reconcile existing L08M-a planning with completed Phase A/B and the independent-package direction. Close the five Phase C decisions below. Agree the identity-link contract and initial entity/relationship vocabulary. | Can prepare now. Decision record names the Muse runtime, development dispatch, package profile and owners; no repeat of approved architecture or Phase B. |
| Next implementation: native domain | L08M-b becomes the thin Knowtation WASM/native adapter on the selected external-domain host. Start with the accepted synthetic contract. | Begin after the current vault delivery reaches an accepted closeout or explicit stable handoff, the five decisions close, and this bounded implementation is authorized. Complete native refusal/output/resource cases and deterministic validate/snapshot/diff parity. |
| Alongside native integration: identity | Extend existing Knowtation/Scooling account-linking adapters and mapping contracts; keep current user IDs. Implement only against the agreed MuseHub identity proof/session contract. | Contract design precedes a public pilot. Implementation may proceed alongside Phase C; it need not wait for a full social product. Complete proof of both accounts, unlink/relink, rotation/recovery and permission-invariance checks. |
| Domain expansion: connected knowledge | Define a successor schema for entities, typed relationship assertions and structured provenance; implement a bounded public projection and query path. | Preserve accepted synthetic v1 unchanged. Use a separately accepted successor/version and explicit migration/compatibility rules. Start design alongside Phase C; start real integration after its relevant runtime and schema contracts are stable. |
| L08M-S: durable distribution | Complete single-publisher trust, freshness, revocation/rollback and signed release/history binding; qualify the chosen Muse/MuseHub pair. Resolve H4 for Knowtation publication. | Required before supported installed packages and real canonical domain history are published. Keep anonymous public reads separate from authority to execute a package. |
| First connected public pilot | One community, a place, an event/activity, consenting public personas and published knowledge. Use the native domain, identity links and rebuildable relationship index together. | Exact release/runtime contract, relevant containment/repair closure, distribution gates, attribution and publication controls pass. Demonstrate the complete journeys below. |
| Private Scooling integration | Extend the same model through authorized Knowtation producers and consumer adapters. | B06 producer contract and the particular private storage/authentication/consent qualifications must close first. Private decrypt/projection stays under Knowtation/device custody. |

The existing **B06 producer-interface specification remains the next separate
vault integration specification**. Coordinate it within the domain/identity
planning effort; do not treat it as a prerequisite for synthetic Phase C or a
public-only model. Conversely, a successful public pilot does not qualify private
Scooling access. “Phase C” in this plan means the native domain phase, not a
Scooling adapter stage.

The recommended kickoff is a milestone, not a guessed date. The current vault
plan already has a fallback proposal due November 30, a December 2 review, a
December 7 completion target, and the running extension's December 9,
16:35:45 PST expiry. Preserve those dates. There is no reason to wait until
December 9 if the bounded closeout and decisions finish earlier. Nor should a
domain kickoff displace an unfinished expiry obligation. Remaining B03/B04/B05
and broad browser/device release qualifications are separate; require those
that the selected workflow actually uses, rather than the entire historical
launch backlog before the first synthetic adapter.

**Five decisions needed before the native adapter**

These are the existing accepted packet's
[S3 dependencies](evidence/B02/knowtation-domain-contract-20261103-r2/IMPLEMENTATION-SCOPE.md#s3-phase-c-local-native-guest-integration),
not a new approval framework:

1. **Knowtation dispatch and domain ID:** Muse/Gabriel and Knowtation agree the
   exact non-timeline development command/caller path. Do not impersonate
   `timeline_wasm_test`.
2. **Pinned runtime/ABI profile:** select the compatible source/runtime/helper,
   distinguish the two-second job bound from the ten-second worker bound, and
   retain the accepted fuel/memory limits.
3. **Deferred operations:** accept the required feature declaration and status-1
   refusal-only `merge`/`migrate` exports for this slice. Successful merge and
   migration are later capabilities.
4. **Caller diagnostics:** use the existing local assertion where sufficient;
   have the host owner allocate any genuinely needed shared diagnostic.
5. **Development package identity:** agree the synthetic descriptor and its
   schema/config/profile binding, without treating it as production authority.

The architecture is already approved in
[Muse #108](https://staging.musehub.ai/gabriel/muse/issues/108): independently
owned executable packages, a constrained raw-byte interface, and a non-executing
MuseHub distribution role. Gabriel also supported a single-publisher pilot.
The September addendum already withdrew the earlier plan to merge the Python
Knowtation plugin into Muse core. The old plugin is an algorithm reference;
the new standalone core and wrapper are the implementation path. Catalog
metadata alone is not an installed executable domain.

**Finish MuseHub cleanup in this order**

The latest local November 12 review does not approve the containment correction
yet. Its remaining spec requires a separate freeze review before the Auto build,
even though the adjacent roadmap table labels the build “Next.” Preserve that
specific entry condition. Two narrow corrections remain: deterministic parser
size/count failures need the agreed quarantine/refusal behavior, and two cache
tests must again require stored and returned pack IDs to match. After independent
review, port to the selected release with the outstanding repository-authorization,
release-provenance and edge/cache evidence. Coordinate rollout before treating
containment as closed. Credential retirement is already owner-confirmed closed;
do not reopen it.

After containment:

| Item | What it fixes | Recommended execution boundary |
| --- | --- | --- |
| [#235](https://staging.musehub.ai/gabriel/musehub/issues/235) | Historical commits lost the exact original timestamp text needed to reconstruct their existing identity; legacy Knowtation clone failures are recorded. | Build the shared read-only classifier/dry-run first. Restore only verified exact raw timestamp values with backups and per-repository transactions. Preserve commit IDs, signatures and parents. Staging and production writes each need the existing explicit approval and rollback plan. |
| [#236](https://staging.musehub.ai/gabriel/musehub/issues/236) | Repair endpoint may report success without persisting `committed_at_raw`. The issue's defect is source-inferred. | Reproduce against the selected release and real PostgreSQL first. If reproduced, persist/reload/recompute before reporting success. Qualify the durable repair path before relying on it for #235. If already fixed, close with evidence instead of a redundant patch. |
| [#237](https://staging.musehub.ai/gabriel/musehub/issues/237) | Fetch/pack delivery lacks a useful server-side indication of reconstructed commit-identity mismatch. | Reuse the classifier; add agreed advisory diagnostics and cache/metadata coverage. Keep client verification and pack bytes intact. Agree the diagnostic response surface with Gabriel. |

Practical order: **shared audit → qualify/fix #236 → reviewed #235 backfill →
verify repaired fetch/clone**, with #237 developed against the same fixtures and
qualified before calling the repair set complete. Do not turn optional diagnostic
redesign into a reason to postpone a safe repair or local domain development.

The issue bodies describe dated observations, not fresh November 12 clone tests.
Refresh reproduction on the selected release. H4 also requires a complete
verified history and explicit Muse-to-Git mapping; closing a database ticket is
not by itself that evidence. Follow the
[H4 diagnostic handoff](evidence/B02/session-key-lifecycle-design-20261109/MUSE-DIAGNOSTIC-HANDOFF.md)
after maintainer repair/compatibility evidence, without repeatedly recloning the
known failing history. These tickets concern **commit identity bytes**, not
people's social identity.

Private operational source records are retained in the neighboring MuseHub
workspace: the November 12
[ownership correction](/Users/aaronrenecarvajal/MUSE_HUB/phase1-private-review/aaron-containment-launch-20261112-ocizj90c/OWNERSHIP-AND-NEXT-STEP.md),
[correction review roadmap](/Users/aaronrenecarvajal/MUSE_HUB/phase1-private-review/independent-review-correction-20261112-g7k/ROADMAP.md),
and [remaining correction spec](/Users/aaronrenecarvajal/MUSE_HUB/phase1-private-review/remaining-correction-freeze-20261112-hbbdm6e3/SPEC.md).
Their private incident details are not reproduced here. Aaron owns the current
containment/repair lane according to that newer owner-supplied coordination;
Gabriel retains release/production coordination.

**Build identity groundwork with the domain, not inside its parser**

Current upstream [identity documentation](https://musehub.ai/muse/identity)
describes MSign signed requests and an immutable `identity_id`, distinct from
the current key fingerprint and public key. Rotation changes keys, not that
anchor. The documented hub-specific derivation means our binding should include
the canonical hub origin. Confirm the deployed API behavior before opening
Scooling's existing normalization gate. The older “wait for MSign to exist”
assumption should no longer drive the schedule; signed requests still need a
deliberate bridge into Knowtation/Scooling browser sessions.

Use separate identities for separate purposes:

| Identifier | Purpose |
| --- | --- |
| Existing internal account/principal ID | Authentication and access decisions; preserve current user identity and approved aliases. |
| Hub-qualified Muse identity | Verified external account-control binding, stable across supported key rotation. Handles and current key fingerprints are aliases/credentials. |
| Public persona ID | A person's chosen public presence; separate from their private account map. More than one persona can be legitimate. |
| Entity ID | A person described in knowledge, community, organization, place, event, activity, topic or artifact. An entity need not have an account. |
| Stable note/object ID | The authored knowledge object's identity across edits/renames; the synthetic core already has `note_id`. |
| Commit/content/package identity | A particular revision or executable artifact, not a person or a durable logical entity. |

Extend the
[Scooling IdentityAdapter](/Users/aaronrenecarvajal/scooling/src/adapters/identityAdapter.ts)
and existing mapping store. Do not replace the current provider-neutral identity
model or expose its private aliases as a public graph. The first adapter slice
should establish:

- Explicit proof of control of the existing account and the selected Muse
  identity, with replay-resistant, audience/origin-bound linking and clear user
  consent. Choose the supported proof mechanism with Gabriel; do not invent
  browser SSO from a profile lookup.
- Stable resolution through handle change, key rotation, unlink/relink and
  recovery. Conflicting links require an explicit resolution; matching a name,
  email, avatar or note mention is not enough to merge accounts.
- No change to vault permissions from linking, following, an attestation or a
  social relationship. Knowtation remains permission authority.
- Separate consent to publish a persona binding. A private verified account link
  must not automatically reveal the same person's other communities or accounts.
- Recorded capability/contract tests before changing the false MuseHub
  normalization and social gates. Keep current login working throughout.

MuseHub already documents [profiles and signed attestations](https://musehub.ai/muse/profiles).
Reuse qualified primitives for attribution and explicit claims. A signature
establishes the signer of a claim, not its truth, a verified real-world person,
or permission to read a vault. Confirm whether Scooling's selected social actions
use versioned Muse `social` repositories or Hub APIs; they are distinct surfaces.
Full social feeds, follower recommendations and organization delegation can
follow the identity foundation.

**Expand the knowledge model without breaking accepted v1**

The current accepted synthetic contract is closed: one note with raw source and
title/tags/body semantics. Adding people or relationship fields to that packet
would change the contract. Preserve it as the conformance baseline. Develop the
next schema explicitly, reusing stable note identity and exact provenance.

Start with a small set of useful types: public persona/person, community,
organization, place, event, activity/project, knowledge artifact, and topic/skill.
Model a relationship as an assertion with its own ID, typed endpoints, predicate,
source revision, author/issuer, evidence, visibility, validity interval and
active/corrected/retracted state. Distinguish an extracted candidate, an approved
assertion and a separately verified claim. Support correction and split/merge
history rather than irreversible automatic entity conflation.

For example, a community hosts an event, the event occurs at a place, a consenting
persona facilitates an activity, and a published note documents its outcome.
Those links should survive file renames and profile-handle changes. A user can
inspect the evidence and source revision behind each link. Reciprocal community
relationships belong in the general knowledge graph; they must not be forced
into identity/delegation constraints.

Keep the responsibilities concrete:

| Layer | Responsibility |
| --- | --- |
| Knowtation | Canonical knowledge objects, permissions, review and publication; private decryption/projection under its existing custody rules. |
| Knowtation domain on Muse | Deterministic state, semantic changes and versioned provenance; no network login, account lookup or key custody inside the guest. |
| MuseHub | Qualified package distribution, repository history/collaboration, identity and selected social/attestation services. The approved external guest is not executed by Hub v1. |
| Relationship/query projection | A rebuildable index over authorized published/shared assertions, with revision and extractor/schema binding. Decide its service owner with the Kinship/platform work. |
| Scooling | Linking and review experience, community/learning workflows, explanation of discovered connections, adapter-mediated reads/writes. |
| Ourware and other products | Discover and navigate published offerings and connections through agreed APIs; do not independently infer or duplicate private identity mappings. |

Public mode is the best first end-to-end scope. Make publication an explicit
preview of the exact fields, attachments, attribution and relationships being
released. A public derivative needs its own identity; restrict its link to a
private source unless separately authorized. Public history is copyable:
retraction can remove current discovery and mark history, but cannot promise to
erase copies already distributed. Choose personal-data policy before writing it
into durable public history.

An edge must be readable only when its own policy and the relevant endpoint
policies permit it. Apply that rule to every traversal hop, result count, cache,
search snippet and explanation. Keep private relationship projections on the
authorized side of the boundary. Storage/decryption mode and audience are
separate choices; a conveniently readable note is not automatically public.

“All connections” should mean all supported, authorized connections within a
declared corpus and query scope. Add cursor pagination, bounded multi-hop queries,
incremental updates and explicit partial/stale-result indicators. Avoid claiming
complete discovery from a truncated note graph or treating an AI similarity
score as proof that two people are the same.

**What the first public pilot must demonstrate**

1. A current Knowtation/Scooling user links a Muse identity, keeps their existing
   internal ID and access, and chooses whether to publish a persona binding.
2. A community publishes an event at a place, an activity and a related knowledge
   artifact. The graph can answer who organizes it, where it happens, which topic
   it concerns, and which published evidence supports the answer.
3. A note rename, handle change, event reschedule and corrected claim update
   discovery without breaking identity or silently retaining stale assertions.
4. Each visible path explains its source revision. Duplicate and conflicting
   entity candidates stay reviewable. Retracted relationships leave current
   discovery, and cache/index rebuilds reproduce the same authorized state.
5. A private note or unapproved persona link contributes no exposed node, edge,
   count, snippet or path explanation. Key rotation and account unlinking do not
   erase authored knowledge or grant additional permissions.

Measure these journeys, index update/rebuild correctness, unauthorized-disclosure
checks and query completeness within the fixture corpus. This gives a meaningful
definition of deep integration without requiring a worldwide social graph first.

**What to prepare while the current work finishes**

Prepare the five-decision Phase C handoff, a one-page identity linking/session
contract, a successor entity/relationship schema with synthetic examples, and the
five pilot journeys. Reconcile release/runtime pins and the existing Scooling
normalization gate with current upstream behavior. Draft B06's producer boundary
so private consumers can later reuse the model. These are useful documentation
tasks now; they do not require changing the active freeze or adding implementation
to the concurrent worktree.

There is no need to ask Gabriel again whether independent domain packages are
acceptable or to repeat the completed timeline proof. Ask for the remaining
concrete interfaces and production trust decisions. If Aaron contributes social
identity work upstream, first agree which reusable Hub API is missing and who
owns it; keep application account mapping and general knowledge relationships in
their existing product boundaries.

**Draft note to Gabriel — prepared for Aaron, not sent**

> Gabriel — thanks for getting MuseHub 0.2.3 RC.3 live. I want to align the next
> Knowtation step with the external-domain work we already agreed in Muse #108.
>
> I am finishing the current encrypted-vault availability work. In MuseHub I am
> keeping containment first, then #235–237, with the selected-release port and
> coordinated staging/production repair approvals. The public tickets still show
> you as assignee; let's reconcile that with the newer ownership plan.
>
> Immediately after this closeout, I want Knowtation's domain and identity-linking
> foundation to be the next initiative. Its synthetic semantic core is already
> implemented with the 122-case conformance result recorded. The next domain
> slice is the thin native/WASM adapter, using an independently owned package.
>
> Could we settle the five Phase C details: a real Knowtation development
> dispatch/domain ID; the pinned runtime/ABI and resource profile; refusal-only
> merge/migrate support; any required host diagnostic; and the development
> package/schema/config identity? We can reuse the approved host architecture
> and single-publisher direction.
>
> For production installation, who owns authenticated publisher permission and
> freshness, revocation/rollback, and signed package/history binding? Which exact
> Muse/MuseHub artifacts should we qualify together?
>
> For identity, I want to preserve existing Knowtation/Scooling users and link a
> verified, hub-qualified Muse identity to them. Which deployed proof/session
> interface should we use, including handle normalization, rotation, revocation
> and recovery? MSign request signing is documented now; I want to agree the
> browser/account-linking bridge and the intended social API surface. I can help
> build missing reusable Hub infrastructure once that scope is clear.
>
> The first product pilot would connect an opt-in public community, people,
> place, event/activity and published knowledge, with revision-backed evidence.
> Knowtation would keep vault permission and private-decryption authority. Does
> this fit the release plan, and are there domain identity/history fields we
> should settle now to avoid a later incompatible migration?

**Evidence and review limits**

Current local sources: [vault work order](VAULT-CURRENT-WORK-ORDER.md),
[pre-installation delta](B02-UNATTENDED-AVAILABILITY-PREINSTALL-DELTA-20261112.md),
[Phase B result](evidence/B02/knowtation-semantic-core-20261103/README.md),
[accepted implementation scope](evidence/B02/knowtation-domain-contract-20261103-r2/IMPLEMENTATION-SCOPE.md),
[B06 follow-up](SCOOLING-B06-PRODUCER-FOLLOWUP.md),
[Muse production-readiness follow-up](/Users/aaronrenecarvajal/MUSE_HUB/muse-108-contract-clean/docs/issues/108-production-readiness-next.md),
[Scooling identity adapter](/Users/aaronrenecarvajal/scooling/src/adapters/identityAdapter.ts),
[repository adapter](/Users/aaronrenecarvajal/scooling/src/adapters/museHubRepoAdapter.ts),
[social adapter](/Users/aaronrenecarvajal/scooling/src/adapters/socialAdapter.ts).

Upstream reads on November 12: [Muse #108](https://staging.musehub.ai/gabriel/muse/issues/108),
[MuseHub #235](https://staging.musehub.ai/gabriel/musehub/issues/235),
[#236](https://staging.musehub.ai/gabriel/musehub/issues/236),
[#237](https://staging.musehub.ai/gabriel/musehub/issues/237),
[Muse registry](https://staging.musehub.ai/gabriel/muse/blob/dev/muse/plugins/registry.py),
[development discovery](https://staging.musehub.ai/gabriel/muse/blob/dev/muse/plugins/external_test/discovery.py),
[Muse version source](https://staging.musehub.ai/gabriel/muse/blob/dev/pyproject.toml),
[MuseHub version source](https://staging.musehub.ai/gabriel/musehub/blob/dev/pyproject.toml),
[identity](https://musehub.ai/muse/identity), [profiles](https://musehub.ai/muse/profiles),
[Ourware](https://ourware.org). Source branches and issue states can change;
refresh exact release pins when starting implementation. Health reads establish
availability, not feature correctness or private-access qualification.

This review makes no code or neighboring-repository changes, runs no product
tests or live repairs, and sends no external messages. It updates only planning
documentation. It supersedes the earlier November 12 advisory's implication that
the new semantic core was still unimplemented and its inability to retrieve the
live Ourware site. Broader graph and identity recommendations remain applicable.
