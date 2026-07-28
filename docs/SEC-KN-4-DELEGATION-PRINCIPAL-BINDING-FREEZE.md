# SEC-KN-4 — frozen spec: delegation principal binding at apply + proposal authorship

**Phase:** SEC-KN-4 (`SEC-KN-4a` Thinking freeze → `SEC-KN-4b` Auto build)
**Freeze status:** **CLEARED for `SEC-KN-4b`** — round-3 review `pass` and escalated decisions D1/D2
**RATIFIED by the operator** 2026-07-26 (§11, §12.1). Code build only: Tier-3 gates T1–T4 (§8) are
**not** authorized and remain unexecuted.
**Date:** 2026-07-26
**Model (this artifact):** Thinking
**Driving finding:** Pass 2 **P4** — `~/scooling/docs/PRE-BUILD-SECURITY-AUDIT-FINDINGS-PASS2.md` (row `P4`)
**Owner repo:** Knowtation (canonical store + permission authority)

## Freeze-contract declaration

```yaml
phase: SEC-KN-4
outputs:
  - id: sec-kn-4-freeze
    path: docs/SEC-KN-4-DELEGATION-PRINCIPAL-BINDING-FREEZE.md
    frozen: true
frozen_inputs:
  - docs/AGENT-DELEGATION-V0-SPEC.md
  - docs/ROADMAP.md
  - docs/OVERSEER-HANDOVER.md
  - "~/scooling/docs/PRE-BUILD-SECURITY-AUDIT-FINDINGS-PASS2.md"
tier3_gates:
  - T1 canister WASM upgrade that installs the new proposal author field
  - T2 merge to Muse main or a muse-mirror pull request (SD-14)
  - T3 flipping the delegation gate on
  - T4 restoring the migration hook to identity on StableStorage in the release after T1
```

---

## 1. Plain-language summary

When someone lets an AI agent act for them, Knowtation stores a "consent" record naming **whose
authority** the agent borrows. Today that name is copied straight out of the request the client sent.
Approving such a request therefore hands out a real access pass in **someone else's name** — the
approval step never re-checks who actually asked.

This document freezes the fix: the request's own claim about *whose authority this is* gets thrown
away at approval time. Instead the server looks up **who wrote the request** (recorded by the server
at the moment it was written, not by the client) and derives the name from that. If the two disagree,
the approval is refused loudly instead of quietly issuing the pass. Requests that carry no
server-recorded author cannot be applied at all.

### Technical summary

`precheckApprovedDelegationProposal` (`lib/agent/delegation.mjs:837-878`) deserializes
`proposal.body` and applies `principal_ref` / `owner_ref` verbatim; the grant mint then copies
`consent.principal_ref` into a bearer-backed `delegation_grant` (`lib/agent/delegation.mjs:1013`).
The canister `ProposalRecord` (`hub/icp/src/hub/Migration.mo:154-184`) carries no authorship column,
so apply has no server-side author to bind to. SEC-KN-4b adds a server-only `created_by` to the
canister record, re-derives `principal_ref` / `owner_ref` from the recorded author at apply, refuses
on mismatch, rejects `org_ref:` authority refs in v0, and closes the missing delegation-gate check on
the apply path.

---

## 2. Ground truth — what the code does today (file+line)

Every row below was read in this session. No row is inferred.

| # | Ground truth | Citation |
| --- | --- | --- |
| G1 | Propose derives the principal from the verified session: `hashPrincipalRef(input.userId)` | `lib/agent/delegation.mjs:761`, `:671` |
| G2 | Apply re-parses `proposal.body` and applies the record as-is; authorship is never consulted | `lib/agent/delegation.mjs:846-877` |
| G3 | Apply performs **no** delegation-gate check (contrast propose `:758`, mint `:943`, list `:904`) | `lib/agent/delegation.mjs:837-845` |
| G4 | `validateConsentRecord` accepts any ref passing `isValidOwnerRef`, which admits **any** `org_ref:<text>` | `lib/agent/delegation.mjs:249`, `:209-218` |
| G5 | Mint copies the stored consent's `principal_ref` into the grant and returns a bearer | `lib/agent/delegation.mjs:1013`, `:1006`, `:1030-1034` |
| G6 | Canister `ProposalRecord` has no authorship field; create sets none | `hub/icp/src/hub/Migration.mo:154-184`; `hub/icp/src/hub/main.mo:1359-1391` |
| G7 | Canister proposal GET / list serialize a fixed field list — no authorship to read | `hub/icp/src/hub/main.mo:1130`, `:1111` |
| G8 | Hosted apply reconstructs `delegation_meta` from **client-supplied** frontmatter / intent | `lib/agent/delegation-hosted-proposal.mjs:100-137` |
| G9 | Hosted proposal create is a generic proxy — client `intent`, `body`, `frontmatter` reach the canister with no intent allowlist | `hub/gateway/server.mjs:3221`, `:3276-3285` |
| G10 | Any successful approve triggers the bridge delegation apply hook | `hub/gateway/delegation-approve-hosted.mjs:29-51`; `hub/bridge/delegation-routes.mjs:181-209` |
| G11 | Hosted workspaces are **delegating**: many member `actorUid`s share one `effectiveCanisterUid` (workspace owner) | `hub/bridge/server.mjs:698-736` |
| G12 | The canister currently ignores `X-Actor-Id` entirely; only `X-User-Id` is read (`userId`) | `hub/icp/src/hub/main.mo:153-158` (no actor header reader exists) |
| G13 | Self-hosted proposals already store a server-derived author, `proposed_by` | `hub/proposals-store.mjs:184-185`, `:318`; set from `req.user.sub` at `hub/server.mjs:2965` and from the session in the delegation handlers `lib/agent/delegation.mjs:812`, `:725` |
| G14 | Self-hosted approve has both author and approver in scope but passes neither to precheck | `hub/server.mjs:3070-3080`, `:3104-3105` |
| G15 | Canister record updates use `{ x with … }`, so a new column survives evaluation / hints / enrich / approve / discard without edits | `hub/icp/src/hub/main.mo:1455-1468`, `:1511`, `:1605`, `:1685`, `:1724` |
| G16 | Unparseable canister proposal bodies degrade to a stub object rather than an error | `lib/canister-proposal-response-parse.mjs:13-26` |

### 2.1 Exploit paths (ordered by precondition cost)

| Path | Precondition | Mechanism | Result |
| --- | --- | --- | --- |
| **A — org-ref escalation (no secret needed)** | Hosted member who may create a proposal and whose partition can be approved | POST a proposal with `intent: delegation_consent_create` (G9) and body `principal_ref: "org_ref:<workspace id>"`; `isValidOwnerRef` admits it (G4); apply stores it (G2) | A grant whose principal is an **org-wide** ref the attacker never proved authority over (G5) |
| **B — named-victim impersonation** | Additionally knows the victim's session `sub` (uid values are of the form `provider:id`) | Same, with `principal_ref: "uid_hash:<sha256(sub)>"` | A bearer grant that names the victim as principal |
| **C — owner-ref identity capture** (persisted forgery; **not reachable today**) | Same as A/B | POST `intent: agent_identity_register` with a crafted `owner_ref`; apply stores it (G2) | A registry row asserting that an agent is owned by someone who never registered it. The grant-free-authority branch it would unlock (`lib/agent/delegation.mjs:580-587`) is **unreachable in the current tree** — all six production `validateChain` callers pass `requireGrant: true` (`lib/agent/delegation.mjs:1174`; `lib/agent/external-agent-protocol.mjs:185`, `:296`, `:386`, `:527`, `:620`), which forces `grantRequired` at `:582-583`. Treat C as forged durable state plus defense-in-depth, **not** a live privilege escalation |
| **D — gate bypass persistence** | Delegation gate **off** | Apply runs without a gate check (G3) | Forged identity/consent rows persist in `hub_delegation_identities.json` / `hub_delegation_consents.json` and become live the instant the gate flips |

**Not exploitable today (still fixed — defense in depth and hosted/self-hosted parity):** the
self-hosted generic create route never forwards `delegation_meta` (`hub/server.mjs:2955-2971`), so
precheck refuses a hand-rolled self-hosted delegation proposal at
`lib/agent/delegation.mjs:842-844`. That is an accident of one call site, not a designed control.

**Verified NOT a hole — do not "fix" (avoids scope creep):** the audit-append route accepts a
client `principal_ref` (`hub/server.mjs:1963-1966`; `hub/bridge/delegation-routes.mjs:299-302`), but
`validateChain` refuses unless it equals the **stored grant's** principal
(`lib/agent/delegation.mjs:613-615`) with `requireGrant: true` (`:1174`). The value is already
server-bound. Changing it would break agent-runtime callers whose session identity is legitimately
not the principal.

---

## 3. Frozen trust model

| Term | Definition | Source of truth |
| --- | --- | --- |
| **Principal** | The human whose authority a delegate borrows | Hash of the **author**, derived server-side |
| **Author** | The verified session identity that created the proposal | Canister `created_by` (new) / self-hosted `proposed_by` — never the request body |
| **Approver** | The verified session identity that approves at review time | `req.user.sub` (self-hosted) / gateway `x-actor-id` (hosted) |
| **Actor** | The `agent_identity` that performs steps | `agent_id` in the identity registry |

### 3.1 Spec correction (deliberate deviation from the audit's fix wording)

Pass 2 P4 prescribes "re-derive `principal_ref` from the **authenticated actor** at apply". Taken
literally that is wrong here, and SEC-KN-4b must **not** implement it: at apply the authenticated
actor is the **approver**. In hosted delegating workspaces the approver is routinely the workspace
owner or an admin reviewing another member's proposal (G11), so binding the principal to the approver
would silently transfer a member's consent to the reviewer — a different impersonation bug with the
same shape.

The frozen binding is to the **server-recorded author**, which is the same verified session whose id
was hashed at propose time (G1, G13). The approver's identity is authorization to apply, never the
identity of the principal.

### 3.2 Trust assumptions this fix inherits (stated, not assumed silently)

1. The canister trusts gateway-minted headers, guarded only by `X-Gateway-Auth`
   (`hub/icp/src/hub/main.mo:1026`, `:932-941`). `created_by` is therefore exactly as trustworthy as
   the existing `X-User-Id` partitioning — no more, no less. This is acceptable **only** because
   SEC-KN-1 made the empty-secret branch deny (`:930-941`, on branch) and SEC-KN-0 verified the
   secret is set. If either regresses, P4's fix degrades with the rest of the model.
2. The gateway derives `x-actor-id` from its own verified session, never from a client header
   (`hub/gateway/server.mjs:3045`, `:3205`).
3. `hashPrincipalRef` is a plain sha256 of the uid (`lib/agent/delegation.mjs:144-148`). It is a
   PII-avoidance measure, not a secret; equality of derived values is the only property relied on.

---

## 4. Frozen rules (SEC-KN-4b implements exactly these)

### R1 — Server-only proposal authorship

**Canister (`hub/icp/src/hub/Migration.mo`, `hub/icp/src/hub/main.mo`)**

1. Add `created_by : Text` as the **last** field of `Migration.ProposalRecord` (`:154-184`).
2. Introduce `ProposalRecordV7` as a byte-copy of today's `ProposalRecord` (no `created_by`) and
   re-pin `StableStorageV5`, `StableStorageV6`, `StableStorageV7` to `[ProposalRecordV7]`
   (`:199-222`) so the historical layouts stay historically accurate. Re-pinning does not break
   `scripts/verify-canister-migration.mjs` — its checks at `:53-63` and `:76-81` are substring tests.
3. Re-pin the **return type** of the two historical row-map helpers that build complete
   `ProposalRecord` literals to `ProposalRecordV7`: `_proposalBeforeEnrichToCurrent`
   (`Migration.mo:233-265`) and `_proposalV4ToV5` (`Migration.mo:268-300`). Both map *historical*
   layouts to the pre-`created_by` record, so re-pinning is the correct fix — not adding
   `created_by = ""` to them. Without this the literals are type-incomplete and the canister does
   not compile. These plus the create path are the only full-literal sites; every other update uses
   `{ x with … }` (verified by search for `: ProposalRecord` literals — `main.mo:1359` plus the five
   `Array.map` sites at `:1455`, `:1511`, `:1605`, `:1685`, `:1724`).
4. **One-shot migration hook (see §8 gate T4).** Keep the hook domain
   `migration(old : { var storage : StableStorageV7 })` (`:381`) — on-chain state is still V7-shaped
   — and map proposal rows through a new `_proposalV7ToCurrent` that sets `created_by = ""`.
   This hook is **not idempotent**: `Migration.mo:8` records the invariant that the hook must be
   *identity* on `StableStorage` so repeat deploys succeed. Once the upgrade has run, the persisted
   rows carry `created_by` while the declared domain does not, so re-deploying the same WASM fails.
   **MEASURED 2026-07-26 (post-freeze addendum — supersedes the hedge below):** the outcome is a
   **hard upgrade refusal, not silent data loss**. Using `moc 0.16.3` from the dfx 0.30.2 cache:
   `moc --stable-compatible <post-upgrade signature> <this WASM's signature>` exits **1** with
   `Compatibility error [M0216] … the new type of stable variable 'storage' implicitly drops data of
   the previous version … Missing field 'created_by'`, while the **first** upgrade
   (`pre-created_by → this WASM`) exits **0** and is accepted. Consequence for T4: it is not a
   data-loss safeguard but a **deployability restore** — after T1 the canister cannot be upgraded
   with the same WASM at all until the hook returns to identity, so a hotfix window would be blocked.
   The original hedge, retained for provenance: rounds 2 and 3 could not prove from this tree whether
   the repeat deploy would fail compatibility or silently reset every author to `""`, and required T4
   under either outcome. Therefore: **exactly one release may carry this hook**, and the immediately
   following release must restore it to identity on `StableStorage` (the shape at `:381-392` today).
   SEC-KN-4b adds a `TODO(SEC-KN-4c)` comment at the hook and a roadmap row for the restore.
5. Set `created_by` at create (`main.mo:1359-1391`) from `getHeader(req, "X-Actor-Id")`, trimmed.
   **No fallback:** when the header is absent, empty, or longer than 128 characters, store `""` and
   let R2 refuse at apply. Falling back to `userId(req)` would be fail-open to the *wrong* identity —
   `X-User-Id` is `effectiveCanisterUid`, i.e. the workspace **owner**, not the author (G11,
   `hub/bridge/delegation-routes.mjs:68`), so R3(3) would then write the owner's derived principal
   into a consent the owner never authored. That is the same bug shape §3.1 rejects for the approver.
   Truncation is likewise forbidden: propose-time hashing uses the **full** uid
   (`lib/agent/delegation.mjs:761`), so a truncated author would derive a different hash and surface
   as `DELEGATION_PRINCIPAL_REBIND_MISMATCH` for an honest user instead of the intended
   `DELEGATION_AUTHOR_UNVERIFIED`. The request JSON body is **never** consulted (P2 lesson).
6. Emit `created_by` in the single-proposal GET (`main.mo:1130`) and the list GET (`main.mo:1111`).
7. No other route may write the field; `{ x with … }` updates (G15) preserve it as-is.
8. Add matching assertions to `scripts/verify-canister-migration.mjs` (a `created_by : Text;` check,
   a `StableStorageV7 … ProposalRecordV7` pin check, and a check that the two historical row maps
   return `ProposalRecordV7`).

**Self-hosted:** no schema change — `proposed_by` already exists (G13).

### R2 — Author is required at apply (fail closed)

`precheckApprovedDelegationProposal(dataDir, proposal, context)` takes a **required** third argument
`context = { author: string }`.

- Missing / non-object `context`, or an author that is empty after trim → refuse
  `403 DELEGATION_AUTHOR_UNVERIFIED`. There is no default and no fallback to the body.
- Author longer than 128 characters, or containing a character outside `[A-Za-z0-9:_@.\-]` → refuse
  `403 DELEGATION_AUTHOR_UNVERIFIED`. This charset is a **freeze decision, not existing behavior**:
  hosted uids are built as `` `${provider}:${id}` `` (`hub/gateway/server.mjs:208-211`) with no
  charset validation, and the only sanitizer in the tree is a *path* sanitizer that would itself
  mangle a real uid — `String(uid).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128)`
  (`hub/bridge/server.mjs:147-149`). The set above is deliberately a superset of that (it keeps `:`,
  `@`, `.`) so provider-prefixed and email-shaped subjects pass unchanged. Self-hosted authors come
  from `req.user.sub` (`hub/server.mjs:2965`), whose format is not pinned anywhere; if a future
  issuer emits a character outside this set, apply refuses — which is the intended fail-closed
  direction, and the set is widened only by a Thinking amendment, never by the build.
- A proposal object flagged `_knowtation_backup_json_unparseable` (G16) → refuse
  `403 DELEGATION_AUTHOR_UNVERIFIED`.

Because the third argument is required, **every** call site must be updated. This is the complete
list (verified by search — an Auto session must not discover more):

| Call site | Author source |
| --- | --- |
| `hub/server.mjs:3072` (self-hosted approve) | `proposal.proposed_by` |
| `lib/agent/delegation-hosted-proposal.mjs:299` (hosted apply) | canister `proposal.created_by` |
| `test/agent-delegation-e2e.test.mjs:62` | `TEST_USER_ID` |
| `test/agent-delegation-live-gate.test.mjs:80` | `TEST_USER_ID` |
| `test/delegation-hosted-proposal-l1b.test.mjs:287` | `TEST_USER_ID` |
| `test/hub-delegation-self-hosted-route.test.mjs:33-34` | source-regex assertions only — update the expected shape, not the intent |

The author to supply in fixtures is `TEST_USER_ID` (`test/fixtures/agent/delegation-helpers.mjs:14`),
because `TEST_PRINCIPAL_REF = hashPrincipalRef(TEST_USER_ID)` (`:15`) is already what the fixtures put
in record bodies — so R3 passes without changing any expected value. Mocked canister GET rows in
`test/delegation-hosted-proposal-l1b.test.mjs` must additionally carry `created_by: TEST_USER_ID`,
since a mocked row without it now refuses under R2.

Fixture edits are limited to supplying the author and the gate state (R7). No existing assertion may
be deleted or weakened to make a test pass.

**Accepted legacy break (documented, not silent):** canister proposals written before the upgrade
migrate with `created_by = ""` and therefore become un-appliable; they must be re-proposed. This is
safe because the delegation gate defaults to **off** (`lib/agent/delegation.mjs:94-103`), the Pass 2
audit found no live consent index, and the alternative — treating "no recorded author" as
"trust the body" — is exactly the defect being fixed.

### R2.1 — Frozen check order inside `precheckApprovedDelegationProposal`

Order is load-bearing and is frozen exactly as follows. The existing body of the function
(`lib/agent/delegation.mjs:838-877`) keeps its internal logic; the new checks wrap it:

1. `checkDelegationGate(dataDir)` (R7)
2. source / `delegation_meta` shape checks (existing `:838-844`)
3. body JSON parse (existing `:846-851`) and `vaultId` resolution (existing `:853-856`)
4. R2 author verification
5. R5 `org_ref:` rejection
6. R3 / R4 mismatch refusal, then the derived value is written onto the parsed record
7. existing per-kind record validation (`validateAgentIdentityRecord` / `validateConsentRecord`,
   `:859-867`) — now validating the **re-derived** record
8. existing existence checks and `CONFLICT` return (`:861-864`), then the delegate-active check
   (`:869-872`)

Two consequences the build must preserve: the re-derived value is what
`validateConsentRecord` (`lib/agent/delegation.mjs:249`) sees, so a body `principal_ref` that is
**absent, empty after trim, or not a string** is replaced before validation rather than producing a
`400 BAD_REQUEST`. This is **not** a licence to salvage a malformed *non-empty* value: per R3(2) any
non-empty string differing from the derived value refuses with
`403 DELEGATION_PRINCIPAL_REBIND_MISMATCH` whether or not it is well-formed. Loud refusal on
mismatch is the property this phase exists to add and must never be softened to make a test pass. The
`CONFLICT` idempotency shortcut in `applyApprovedDelegationProposalFromCanister`
(`lib/agent/delegation-hosted-proposal.mjs:300-334`) is unreachable for an author-unverified or
rebind-mismatched proposal because steps 4–6 refuse first. The test matrix (§6) pins both.

### R3 — Re-derive the consent principal

For `record_kind: 'delegation_consent'`:

1. `derived = hashPrincipalRef(context.author)`.
2. If `record.principal_ref` is a string that is **non-empty after trim** and `!== derived` → refuse
   `403 DELEGATION_PRINCIPAL_REBIND_MISMATCH`. "After trim" is deliberate: a whitespace-only value
   belongs to the re-derive set in R2.1, not to the mismatch set, so the two sections agree.
3. The applied record's `principal_ref` is **set** to `derived` regardless of what the body carried.

Both steps are required: (2) makes the attack loud and testable; (3) guarantees the persisted record
can never contain a client-authored value even if a future call path skips validation.

### R4 — Re-derive the identity owner

For `record_kind: 'agent_identity'`: same two-step treatment on `owner_ref`
(refuse `403 DELEGATION_OWNER_REBIND_MISMATCH`, then set to `derived`).

### R5 — `org_ref:` authority refs are rejected in v0

- Apply refuses `403 DELEGATION_ORG_REF_UNSUPPORTED` when the body's `principal_ref` or `owner_ref`
  starts with `org_ref:` (closes exploit path A at the front door, before the R3/R4 comparison).
- Mint refuses `403 DELEGATION_CONSENT_PRINCIPAL_INVALID` when a **stored** consent's
  `principal_ref` is not of the form `uid_hash:<64-hex>` (`lib/agent/delegation.mjs:1013` path) —
  protects rows written before this phase.
- `docs/AGENT-DELEGATION-V0-SPEC.md:203`, `:216`, `:245` are amended in the same commit to mark
  `org_ref:` as **reserved, not accepted in v0** — an org principal needs an org-membership
  authority check that does not exist. `isValidOwnerRef` keeps accepting the shape (used by task
  `assigner_ref`, `docs/TASK-STORE-CONTRACT-2G.md:70`); the **delegation** paths reject it.

### R6 — Narrow the propose-time surface

`handleAgentIdentityRegisterProposeRequest` (`lib/agent/delegation.mjs:667-740`) drops `ownerRef`
from its input contract; the owner is always `hashPrincipalRef(input.userId)`. No caller passes it
today (`hub/server.mjs:1843-1852`; `hub/bridge/delegation-routes.mjs:105-118`), so propose-time and
apply-time derivations become provably identical.

### R7 — Apply is gated

`precheckApprovedDelegationProposal` calls `checkDelegationGate(dataDir)` **first** and returns its
refusal unchanged (`403 DELEGATION_POLICY_FORBIDDEN` / `403 DELEGATION_DISABLED`,
`lib/agent/delegation.mjs:527-535`). Closes exploit path D. Existing tests that apply with the gate
off must set the gate on — they may not weaken this check.

### R8 — No cross-partition apply

The hosted apply fetch keeps using the effective partition uid
(`hub/bridge/delegation-routes.mjs:196-200`), so a proposal must exist in the partition being
approved. SEC-KN-4b adds a regression test locking this; it does not change the behavior.

### R9 — Delegation intents stay out of self-apply

Unchanged and re-asserted by test: no delegation intent is ever added to the personal self-apply
class (`lib/hub-proposal-personal-self-apply.mjs`). Approval by a second human is the only gate
before a bearer grant exists. This is not a tuning knob.

### 4.1 Error codes introduced

| Code | Status | Meaning |
| --- | --- | --- |
| `DELEGATION_AUTHOR_UNVERIFIED` | 403 | No usable server-recorded author for this proposal |
| `DELEGATION_PRINCIPAL_REBIND_MISMATCH` | 403 | Body `principal_ref` ≠ author-derived value |
| `DELEGATION_OWNER_REBIND_MISMATCH` | 403 | Body `owner_ref` ≠ author-derived value |
| `DELEGATION_ORG_REF_UNSUPPORTED` | 403 | `org_ref:` authority ref presented to a delegation path |
| `DELEGATION_CONSENT_PRINCIPAL_INVALID` | 403 | Stored consent principal is not `uid_hash:<64-hex>` |

No existing code changes meaning. Refusals never echo the author, the derived hash, or any bearer.

### 4.2 Frozen signature

```js
/**
 * @param {string} dataDir
 * @param {object} proposal
 * @param {{ author: string }} context — server-recorded proposal author; REQUIRED
 */
precheckApprovedDelegationProposal(dataDir, proposal, context)
```

`applyApprovedDelegationProposalFromCanister` reads the author from `proposal.created_by` and passes
it through; its own signature is unchanged. Its `CONFLICT` idempotency shortcut
(`lib/agent/delegation-hosted-proposal.mjs:300-334`) stays reachable **only** after the R2–R5 checks
pass — an author-unverified or rebind-mismatched proposal must never take the "already applied,
idempotent" branch.

---

## 5. Scope

**In scope (SEC-KN-4b, Auto):** `lib/agent/delegation.mjs`,
`lib/agent/delegation-hosted-proposal.mjs`, `hub/server.mjs` (approve call site only),
`hub/icp/src/hub/Migration.mo`, `hub/icp/src/hub/main.mo`, `scripts/verify-canister-migration.mjs`,
`docs/AGENT-DELEGATION-V0-SPEC.md` (R5 amendment), new
`test/sec-kn-4-delegation-principal-binding.test.mjs`, plus the minimum edits to existing delegation
tests needed to supply the required author context and gate state.

**Out of scope (do not touch in 4b):** P12 policy TTL ceiling and P13 `viewer` mint (SEC-KN-5);
P14 constant-time compare (SEC-KN-6); P3 session-bound service tokens (SEC-SEAM-1); the audit-append
principal (§2.1, verified bound); any canister deployment (Tier 3); any posture or gate flip.

---

## 6. Test matrix — seven tiers plus security regression

New file: `test/sec-kn-4-delegation-principal-binding.test.mjs`. Run with `npm test`.
Motoko changes cannot execute under `node --test`; their verification method is stated per row.

| Tier | Required cases |
| --- | --- |
| **unit** | `hashPrincipalRef` determinism for the author; R3 mismatch → `DELEGATION_PRINCIPAL_REBIND_MISMATCH`; R3 match → applied record's `principal_ref` equals derived; R4 same for `owner_ref`; R5 `org_ref:` principal and owner → `DELEGATION_ORG_REF_UNSUPPORTED`; R2 empty / whitespace / oversized / bad-charset / missing-`context` author → `DELEGATION_AUTHOR_UNVERIFIED`; R7 gate off → `DELEGATION_DISABLED`, policy forbidden → `DELEGATION_POLICY_FORBIDDEN` |
| **integration** | Self-hosted approve path passes `proposal.proposed_by` and refuses when it is absent (source assertion on `hub/server.mjs:3072` call shape + handler-level test); hosted path passes canister `created_by` through `applyApprovedDelegationProposalFromCanister`; the `CONFLICT` idempotency branch is unreachable when R2–R5 refuse (R2.1 step order); a body whose `principal_ref` is absent, empty after trim, or not a string is re-derived **before** `validateConsentRecord` and therefore applies rather than returning `400` (R2.1 consequence), while a **non-empty** value differing from the derived one refuses `DELEGATION_PRINCIPAL_REBIND_MISMATCH` whether well-formed or not (R3(2)); source assertions that `created_by` appears in the canister create literal and both GET serializers, that the create path contains **no** `userId(req)` fallback for it (R1.5), that `StableStorageV5/V6/V7` and both historical row maps are pinned to `ProposalRecordV7`, that `_proposalV7ToCurrent` exists, and that the hook carries the `TODO(SEC-KN-4c)` identity-restore marker (R1.4); `npm run canister:verify-migration` exits 0 |
| **e2e** | Full honest path: propose (session A) → approve → apply → mint → grant `principal_ref` equals `hashPrincipalRef(A)` and the bearer is returned once. Full hostile path: proposal body naming principal B, authored by A → apply refuses → **no** consent row is written and mint yields `unknown_consent` |
| **stress** | 200 alternating honest/hostile applies: every hostile one refuses, every honest one applies, no store corruption, no unbounded growth of the consents/identities files |
| **data-integrity** | Refused applies leave `hub_delegation_consents.json` / `hub_delegation_identities.json` byte-identical (no partial write); an applied record's persisted `principal_ref` / `owner_ref` equal the derived values even when the body carried a different one; re-applying an already-applied **`agent_identity`** proposal stays idempotent without mutating the stored principal (`CONFLICT` at `lib/agent/delegation.mjs:863`). **Scope note:** do **not** assert this for `delegation_consent` — that branch (`:865-872`) has no duplicate check and re-apply appends a second row (`:892-897`); see §9 RR6. Do not add a consent duplicate check in 4b, and do not delete this row to make it pass |
| **performance** | Re-derivation adds no measurable cost: 1,000 precheck calls complete within a local budget (assert bounded wall-clock, generous threshold), no per-call filesystem read beyond the existing store loads |
| **security** | **Regression that fails against pre-fix code** — a local `precheckLegacyBodyTrusted` replica of `lib/agent/delegation.mjs:846-877` (same replica pattern as `test/sec-kn-3-mcp-access-role-cap.test.mjs:55-60`) must **accept** the attacker-named principal, while the fixed function refuses it. Also: refusal payloads contain no bearer, no author, no derived hash; `org_ref:` cannot reach a minted grant; an approver ≠ author does **not** become the principal (§3.1 anti-regression); a hosted proposal whose `created_by` is empty refuses instead of binding to the partition owner (R1.5 anti-regression — assert the derived principal is never `hashPrincipalRef(effectiveCanisterUid)`); delegation intents are absent from the self-apply class (R9) |

Every freeze-review or build-verification finding against this spec must cite **file+line**.

---

## 7. Definition of done for SEC-KN-4b

1. R1–R9 implemented exactly as written; no additional behavior changes.
2. All seven tiers green locally via `npm test`, including the security regression that fails against
   the body-trusted replica.
3. `npm run canister:verify-migration` exits 0. `dfx build` for the hub canister if the local
   toolchain resolves; otherwise the compile is recorded **UNVERIFIED** and left to the Tier-3
   pre-deploy path (`scripts/canister-predeploy.sh`) — never claimed as verified.
4. No secrets, no absolute machine paths, and no author/uid values in logs or error payloads.
5. `docs/ROADMAP.md` and `docs/OVERSEER-HANDOVER.md` updated in the closing Muse commit (SD-17).
6. `/build-verification-review` verdict **pass** before the roadmap row flips to DONE.
7. Feature branch only. No merge to Muse `main`, no `muse-mirror` PR, no canister deploy.

---

## 8. Tier 3 gates (not part of SEC-KN-4b)

| Gate | Why it is Tier 3 |
| --- | --- |
| **T1** Canister WASM upgrade installing `created_by` | Live state migration on mainnet; stacks with the undeployed SEC-KN-1 fail-closed change |
| **T2** Any merge to Muse `main` / `muse-mirror` PR | SD-14 |
| **T3** Flipping the delegation gate on | Live capability |
| **T4** Restoring the migration hook to identity on `StableStorage` in the release **immediately after** T1 | The R1.4 hook is deliberately non-idempotent for one deploy. **Measured 2026-07-26:** a repeat deploy is **refused** with `Compatibility error [M0216]` (not a silent reset), so until T4 ships the canister **cannot be upgraded at all** with that WASM — an outage-window hotfix would be blocked. `Migration.mo:8` documents the identity invariant. T4 is a **required follow-up**, not an optional cleanup — track it as SEC-KN-4c |

The canister upgrade and the JavaScript changes must ship together operationally: until the upgrade
installs, hosted `created_by` is absent and R2 refuses every hosted delegation apply. That is the
intended fail-closed posture, and the handover must say so plainly rather than describing hosted
delegation as working.

---

## 9. Residual risks and non-goals (explicitly accepted)

| # | Residual | Why accepted here |
| --- | --- | --- |
| RR1 | Whole model still rests on the canister's gateway-auth header trust (§3.2 item 1) | Owned by SEC-KN-1 / SEC-KN-0, verified separately; duplicating it here would not add a control |
| RR2 | An author removed from a workspace after proposing can still have their proposal applied | Principal binding stays honest (the consent is theirs); membership revocation at apply is a separate policy question, not P4 |
| RR3 | Mint does not require the delegate identity's owner to relate to the consent principal (`lib/agent/delegation.mjs:966-978`) | With R3 the grant principal is always the author; a foreign-owned actor agent gains no authority over anyone else's scope. Recorded for a future delegation-chain phase |
| RR4 | `hashPrincipalRef` is unsalted sha256 of a uid — offline-guessable given a candidate uid | Equality is the only property used; the hash is PII-avoidance, not a secret (§3.2 item 3). Changing it would break every stored record and belongs to a schema-version decision (Tier 2) |
| RR5 | Legacy canister proposals become un-appliable (R2) | Stated as an accepted break, gate is off, no live index |
| RR6 | Re-applying an approved `delegation_consent` proposal appends a duplicate row — the consent branch (`lib/agent/delegation.mjs:865-872`) has no existence check, and the hosted shortcut tests `existing.status === 'active'` (`lib/agent/delegation-hosted-proposal.mjs:317-330`) while stored consents carry `revoked_at` and no `status` field (`delegation.mjs:245-267`, `:493-498`) | **Pre-existing**, not introduced by P4, and not a principal-binding hole: with R3 every duplicate carries the same server-derived principal. Fixing it means either a consent identity key or a `status` projection — a Tier 2 persistence-shape decision, so it stays out of 4b rather than being improvised during a security build |

---

## 10. Ground-truth edge

`SEC-KN-4b` (Auto) may treat sections 3–7 of this document as **ground truth** and must not
re-derive the trust model, re-open R1–R9, or "improve" the design during build. Anything not listed
in §5 as in scope is out of scope; if implementation reveals that a frozen rule cannot be
implemented as written, the build **stops** and returns here for a Thinking amendment rather than
choosing an alternative silently.

---

## 11. Review record

**Status: CLEARED for the `SEC-KN-4b` Auto build.** Round-3 verdict **`pass`** (2026-07-26), operator
decisions D1/D2 **ratified** (§12.1), mechanical gate `pass`. Nothing remains open in an escalating
category. Clearance covers the **code build only** — Tier-3 gates T1–T4 (§8) are declared, excluded
from 4b scope, and **not** authorized by this pass.

Two round-1 findings fell in escalating categories (`security`, `irreversible`), which under the
freeze-review loop must be decided by the operator rather than auto-fixed; both were ratified on an
explicit operator statement on 2026-07-26. **Round 2 verified all eight round-1 amendments hold** and
found no remaining problem in the technical spec — the one blocker it raised was governance: this
session had recorded its own ratification of D1/D2. That was reverted, and ratification now rests on
the operator's own words. Because the round-2 verdict was `blocked`, round 3 reviewed the fully
amended artifact so clearance rests on a reviewer verdict rather than on the authoring session's
judgement that the blocker was gone.

| Round | Reviewer | Verdict | Resolution |
| --- | --- | --- | --- |
| 0 | `ok review --freeze` (kit checklist C1–C8, local provider) | pass | Declaration present, no mechanical findings. Re-run after every amendment |
| 1 | Independent thinking-high reviewer (did not author the artifact) | **blocked** | 8 cited findings; 6 amended in place, 2 escalated to the operator. **F1** BLOCKER completeness — `Migration.mo:233`/`:268` build complete `ProposalRecord` literals and would not compile; amended R1.3 (re-pin their return type to `ProposalRecordV7`, which is more correct than my first fix of adding `created_by = ""`). **F2** BLOCKER **security** → §12 D1 — R1's `X-User-Id` fallback was fail-open to the workspace **owner**; fallback removed in R1.5. **F3** BLOCKER **irreversible** → §12 D2 — the hook stops being idempotent, so a repeat deploy would erase `created_by` (`Migration.mo:8`); one-shot constraint + gate T4 added. **F4** MAJOR — enumerated the 3 unnamed test call sites and the `TEST_USER_ID` author. **F5** MAJOR — added R2.1 frozen check order. **F6** MINOR — my "gateway uid sanitizer parity" claim was false; the only sanitizer (`hub/bridge/server.mjs:147-149`) would mangle a real uid. Charset restated as an explicit freeze decision. **F7** MINOR — truncation replaced with store-empty. **F8** MINOR — exploit path C relabelled not-reachable (all `validateChain` callers pass `requireGrant: true`) |

| 2 | Independent thinking-high reviewer (fresh, re-derived every claim from source) | **blocked** | All 8 round-1 findings confirmed **resolved**, with independent evidence: `Migration.mo:233`/`:268` are private funcs with **zero callers**, so the `ProposalRecordV7` re-pin is type-correct and `scripts/verify-canister-migration.mjs:53-63`/`:76-81` still pass; no `userId(req)` fallback survives and no other canister write path can source `created_by` from a wrong identity (`PROXY_HEADER_ALLOWLIST` at `hub/gateway/server.mjs:1351-1356` blocks client injection; header match is case-insensitive at `main.mo:147-151`); the call-site list is now **exhaustive** (5 callers + 1 source assertion); `TEST_USER_ID` derivation matches the fixtures' existing `principal_ref`; all 6 production `validateChain` callers pass `requireGrant: true`. New findings: **BLOCKER `gates_tier3`** — §12.1 self-ratified the escalated decisions (reverted to UNRATIFIED); **MAJOR** status contradiction between the header and §12.1 (header now defers to §12.1); **MAJOR** R2.1/§6 "malformed" wording contradicted R3(2)'s mismatch refusal (both narrowed to absent/empty/non-string, with an explicit anti-softening note); **MINOR** the idempotency test row only holds for `agent_identity` (scoped, consent duplicate-append recorded as RR6); **MINOR** the repeat-deploy consequence was stated with unprovable certainty (now "fails compatibility **or** silently resets", T4 required either way) |

| 3 | Independent thinking-high reviewer (third fresh reviewer, re-derived from source) | **pass** | All 5 round-2 findings **resolved**. Ratification accepted as legitimate: it rests on a quoted operator **selection** rather than a bare instruction to continue, the recorded option A for D1/D2 matches what R1.5 and R1.4 + T4 actually say, and scope correctly excludes T1–T4. Independently re-verified: the consent branch really has no duplicate check and the hosted `status === 'active'` shortcut can never match a stored consent (which carries only `revoked_at`), so RR6 is accurate; R2.1/§6 no longer leave room to soften R3's mismatch refusal; `created_by` reaches precheck with no unlisted file because the row is spread wholesale (`lib/agent/delegation-hosted-proposal.mjs:132-136`, `lib/canister-proposal-response-parse.mjs:15`); `Text.trim` with `#predicate isAsciiSpace` already exists as a local Motoko idiom (`main.mo:191`). One MINOR raised and **fixed in this revision**: R3(2) said "non-empty string" while R2.1/§6 put empty-**after-trim** in the re-derive set, so a whitespace-only value satisfied both — R3(2) now reads "non-empty after trim". C1–C8 all `pass`; **nothing open in an escalating category** |

Reviewer confirmations worth keeping (independently verified, not my claims): ground-truth rows
G1–G16 hold at the cited lines; the §2.1 "audit-append is already grant-bound" call is correct; the
`ProposalRecordV7` re-pin accurately describes serialized on-chain state and preserves data on the
first upgrade; a client cannot spoof `x-actor-id` because `PROXY_HEADER_ALLOWLIST`
(`hub/gateway/server.mjs:1351-1356`) excludes it; C6 real-money and C7 Tier-3 linkage pass.

## 12. Operator decisions required before SEC-KN-4b (Tier 3 / escalated)

| # | Decision | Recommendation |
| --- | --- | --- |
| **D1** | Ratify the fail-closed author rule (R1.5): a hosted proposal created without `X-Actor-Id` stores an empty author and can never be applied — no fallback to the partition uid. | **Ratify.** The alternative silently names the workspace owner as principal for a body they never wrote. Cost is that any create path not sending `x-actor-id` produces un-appliable delegation proposals; the gateway does send it (`hub/gateway/server.mjs:3045`, `:3205`), and refusing is the correct failure direction for an authority record. |
| **D2** | Ratify the one-shot migration plan (R1.4 + gate T4): ship one release whose hook maps V7 rows and sets `created_by = ""`, then immediately ship a follow-up release restoring the hook to identity on `StableStorage`. | **Ratify, and schedule T4 in the same operator session as T1.** This is the pattern the repo already used for V4→V5 (`Migration.mo:8`). The risk is entirely operational: if the non-identity hook is left in place, a repeat deploy erases the authorship column. If you prefer zero non-idempotent windows, the alternative is a Thinking amendment to store authorship in a side map with a nullable read path — more code, no reliance on deploy discipline. |

### 12.1 Ratification record

**Operator: aaronrene · 2026-07-26 · recorded in session (Thinking, SEC-KN-4a)**

Operator statement, verbatim: *"Button did not work, so here are the other decisions I made. I just
took your recommendations. Please proceed."* — accompanied by screenshots of the decision card with
option **A** highlighted for all three questions. The recommended option was option **A** in each.

| # | Selection | Effect |
| --- | --- | --- |
| **D1** (`security`) | **RATIFIED — option A**: "Ratify fail-closed as specified: store an empty author; apply refuses with `DELEGATION_AUTHOR_UNVERIFIED`" | R1.5 stands as written. No `X-User-Id` fallback, no truncation. A create without `X-Actor-Id` yields an un-appliable delegation proposal — the correct failure direction for an authority record |
| **D2** (`irreversible`) | **RATIFIED — option A**: "Ratify the one-shot hook plus a mandatory follow-up release restoring identity (SEC-KN-4c), scheduled in the same operator session as the upgrade" | R1.4 stands as written. **Exactly one** release may carry the non-identity hook; gate **T4** / roadmap row `SEC-KN-4c` is a required follow-up, to be scheduled in the same operator session as the T1 upgrade |
| Sequencing | **Option A**: record, commit, then run `SEC-KN-4b` as a fresh Auto build from the handover block | 4b may proceed once the freeze review verdict is `pass` (see §11) |

**Scope of this ratification:** it authorizes the `SEC-KN-4b` **code** build only. It does **not**
authorize any live action — T1 (canister WASM upgrade), T2 (merge to `main` / `muse-mirror`),
T3 (delegation gate flip), and T4 (identity restore) all remain Tier 3 and unexecuted, and T4 is now
an accepted obligation rather than an open question.

History (kept as a governance record): an earlier revision of this subsection declared both decisions
"ratified as recommended" after the operator said *"see answers and continue"* while no selection
payload reached the session. Round-2 review flagged that as a `gates_tier3` blocker and it was
reverted to UNRATIFIED. It is now ratified on an **explicit operator statement**, quoted above — the
distinction matters and future sessions must preserve it: a general instruction to proceed is not a
selection, and an authoring session may never ratify its own escalations.
