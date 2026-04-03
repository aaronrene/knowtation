# AIR Improvements Plan

**AIR** = Attestation, Integrity, and Review. The current implementation is a pre-write /
pre-export hook that calls an optional external endpoint. This document defines five concrete
improvements (A–E) that graduate AIR from a stub into a production-grade audit and integrity
layer for the entire Knowtation platform.

**Branch prefix:** `feature/air-improvements` (or implement A–C on a single branch; D–E each
get their own branch when prioritized).

**Reference:** `lib/air.mjs` (current implementation), [PHASE12-BLOCKCHAIN-PLAN.md](./PHASE12-BLOCKCHAIN-PLAN.md) (introduces `air_id` frontmatter field).

---

## Current State (verified from source)

`lib/air.mjs` exports two functions:

| Function | Trigger | What it does |
|---|---|---|
| `attestBeforeWrite` | CLI `write`, MCP `write_note` | POSTs `{ action, path }` to `config.air.endpoint`; returns `id` or placeholder |
| `attestBeforeExport` | CLI `export`, MCP `export_vault` | POSTs `{ action, source_notes }` to endpoint; returns `id` or placeholder |

**Gaps:**
- The returned `air_id` is never stored back into the note's frontmatter
- The hosted gateway (`hub/gateway/server.mjs`) never calls AIR for hosted writes
- Failure is always non-blocking — a broken endpoint is silently bypassed
- No built-in endpoint ships with the product; users must bring their own
- No blockchain-backed storage of attestations exists

---

## Improvement A — Store `air_id` back into note frontmatter

**Effort:** Small (1–2 hours)
**Branch:** Can be added to any feature branch; ideal on `feature/air-improvements`

### Problem
`attestBeforeWrite` returns an `air_id` string. The caller (CLI `write`, MCP `write_note`)
receives it but immediately discards it. The note being written has no record of its attestation.

### Solution
After `attestBeforeWrite` resolves with a non-null, non-placeholder ID, inject `air_id` into
the note's frontmatter before the actual write completes.

**Files to change:**
- `lib/write.mjs` — `writeNote(config, path, body, frontmatter)`: call `attestBeforeWrite`,
  then merge `{ air_id: <returned id> }` into `frontmatter` before writing the file.
- `mcp/create-server.mjs` — `write_note` tool: remove the separate `attestBeforeWrite` call
  (it moves inside `writeNote`).
- `cli/index.mjs` — `write` command: same removal; `writeNote` handles it.

**Outcome:** Every attested note automatically has `air_id` in its frontmatter. Since Phase 12
already added `air_id` to the keyword search haystack and filter layer, these notes are
immediately searchable by attestation ID.

---

## Improvement B — Wire AIR to the hosted gateway

**Effort:** Small (2–3 hours)
**Branch:** `feature/air-improvements`
**Prerequisite:** Improvement A (so that `air_id` lands in the note before it reaches the canister)

### Problem
`hub/gateway/server.mjs` proxies all note writes to the ICP canister but never calls
`attestBeforeWrite`. Hosted users get zero attestation even if `KNOWTATION_AIR_ENDPOINT` is set.

### Solution
In the gateway's write-note proxy handler (the `POST /api/v1/notes` and `PUT /api/v1/notes/:path`
paths), call `attestBeforeWrite` before forwarding to the canister. Inject the returned
`air_id` into the note body's frontmatter in the request payload.

**Files to change:**
- `hub/gateway/server.mjs` — add `attestBeforeWrite` call in the write proxy path (guarded by
  `process.env.KNOWTATION_AIR_ENDPOINT` being set).
- `hub/gateway/apply-note-provenance.mjs` — extend `mergeHostedNoteBodyForCanister` to accept
  and inject `air_id` alongside existing provenance fields.

**New Netlify env var:** `KNOWTATION_AIR_ENDPOINT` — the attestation endpoint URL. When unset,
gateway writes proceed without attestation (same as today). When set, attestation runs.

---

## Improvement C — Configurable hard-fail mode

**Effort:** Tiny (30 minutes)
**Branch:** `feature/air-improvements`

### Problem
Today, if the AIR endpoint is unreachable or returns an error, `attestBeforeWrite` logs
`'air-placeholder-write'` and **lets the write proceed**. In a production trust model where
AIR is a compliance requirement, this silent bypass is a security hole.

### Solution
Add an `air.required` boolean config option. When `true`, a failed attestation call throws
instead of returning a placeholder, and the write is rejected.

```yaml
# knowtation.config.yaml
air:
  enabled: true
  required: true          # <-- new
  endpoint: https://your-attestation-service.example.com/attest
```

**Files to change:**
- `lib/air.mjs` — check `config.air.required`; throw `AttestationRequiredError` instead of
  returning placeholder when required is true and endpoint fails.
- `lib/config.mjs` — document `air.required` in the config schema/JSDoc.

**Outcome:** Operators who depend on AIR for compliance can enforce it as a hard gate. Default
remains non-blocking (backward compatible).

---

## Improvement D — Built-in lightweight attestation endpoint (Netlify Function)

**Effort:** Medium (1–2 days)
**Branch:** `feature/air-built-in-endpoint`
**Prerequisite:** Improvements A, B, C should ship first

### Problem
There is no attestation service. Users who want AIR must run their own endpoint. This means
AIR is effectively unavailable for the vast majority of users.

### Solution
Ship a Netlify Function (`netlify/functions/attest.mjs`) that serves as a self-contained
attestation endpoint. It:

1. Receives `POST /api/v1/attest` with `{ action, path, content_hash? }`.
2. Generates a signed attestation record: `{ id, action, path, timestamp, content_hash, sig }`.
   - `id` = `air-` + UUID v4 (or nanoid).
   - `sig` = HMAC-SHA256 of `id + action + path + timestamp` using `ATTESTATION_SECRET` env var.
3. Stores the record in **Netlify Blobs** (key = `attestation/<id>`, value = JSON record).
4. Returns `{ id, timestamp }` to the caller.

A separate `GET /api/v1/attest/:id` endpoint allows verification: fetch the record from Blobs,
recompute the HMAC, compare.

**New Netlify env vars:**
- `ATTESTATION_SECRET` — signing secret (required; 32+ chars). Never committed.
- Gateway sets `KNOWTATION_AIR_ENDPOINT=https://knowtation-gateway.netlify.app/api/v1/attest`
  automatically when `ATTESTATION_SECRET` is present.

**Files to add/change:**
- `netlify/functions/attest.mjs` — the attestation function (or add routes to existing gateway).
- `hub/gateway/server.mjs` — add `GET /api/v1/attest/:id` verification route.
- `hub/gateway/server.mjs` — auto-configure `KNOWTATION_AIR_ENDPOINT` to self when
  `ATTESTATION_SECRET` is set and no external endpoint is provided.
- `docs/DEPLOY-HOSTED.md` — document `ATTESTATION_SECRET` setup.

**Security notes:**
- `ATTESTATION_SECRET` must never appear in committed code. `.env.example` entry only.
- HMAC verification prevents spoofed attestation IDs.
- Netlify Blobs are per-site — attestations are scoped to the deployment.
- This is a soft tamper-evidence layer, not a cryptographic proof of non-tampering (that
  requires a blockchain anchor — see Improvement E).

---

## Improvement E — Blockchain-backed attestation on ICP

**Effort:** Large (3–5 days)
**Branch:** `feature/air-icp-attestation`
**Prerequisite:** Improvements A–D must ship first; requires ICP canister development

### Problem
Netlify Blobs are mutable — an operator with access could alter attestation records. For a
tamper-evident audit trail that can be verified by third parties without trusting the operator,
attestations need to be anchored on an immutable ledger.

### Solution
Add an optional ICP canister (`hub/icp/src/attestation/main.mo`) that receives attestation
records and stores them in stable memory with no delete or update capability. Once written,
an attestation is permanent.

**Flow:**
1. Built-in endpoint (Improvement D) writes to both Netlify Blobs (fast) and the ICP
   attestation canister (durable).
2. The canister returns a `block_height` (or a canister-internal sequence number) confirming
   the write.
3. The full attestation record stored in Blobs is enriched with `{ canister_id, block_height }`.
4. Anyone can verify by querying the canister directly: `GET /api/v1/attest/:id/verify`
   calls the canister's `getAttestation(id)` method.

**New frontmatter fields written back to notes:**

```yaml
air_id: air-abc123
air_canister_id: ryjl3-tyaaa-aaaaa-aaaba-cai
air_block_height: 12345678
```

**Files to add/change:**
- `hub/icp/src/attestation/main.mo` — new Motoko canister: `storeAttestation`, `getAttestation`,
  `listAttestations` (admin only). Stable storage only — no delete.
- `netlify/functions/attest.mjs` — after Blobs write, call canister via `@dfinity/agent` and
  enrich the record.
- `hub/gateway/server.mjs` — `GET /api/v1/attest/:id/verify` calls both Blobs and canister and
  returns a `{ verified: true, sources: ['blobs', 'icp'] }` response.
- `docs/DEPLOY-HOSTED.md` — document canister deploy steps for attestation canister.

**Out of scope for this improvement:**
- Token-based incentives for attestation storage
- Public attestation explorer UI
- Cross-chain attestation (Ethereum, etc.)

---

## Build Order Summary

| Improvement | Effort | Ships with | Status |
|---|---|---|---|
| **A** — Store `air_id` in frontmatter | Small | `feature/air-improvements` | ✅ Merged PR #96 (2026-04-03) |
| **B** — Wire gateway writes to AIR | Small | `feature/air-improvements` | ✅ Merged PR #96 (2026-04-03) |
| **C** — Hard-fail mode (`air.required`) | Tiny | `feature/air-improvements` | ✅ Merged PR #96 (2026-04-03) |
| **D** — Built-in Netlify attestation endpoint | Medium | `feature/air-built-in-endpoint` | ✅ Merged PR #97 (2026-04-03) |
| **E** — ICP blockchain anchor | Large | `feature/air-icp-attestation` | ✅ Merged PR #99 (2026-04-03); canister `dejku-syaaa-aaaaa-qgy3q-cai` deployed |

**Recommended sequencing:** A+B+C shipped as a single PR. D next as a standalone feature
(planning pass first — see §D above for full spec). E only when the use case demands it
(likely a specific partner or compliance requirement).

---

## Next Session Prompt for AIR Improvements

```
We are implementing AIR improvements for Knowtation.
Read docs/AIR-IMPROVEMENTS-PLAN.md before touching any code.

Start with Improvements A, B, and C on branch feature/air-improvements.

A: Store air_id back into note frontmatter after attestBeforeWrite resolves.
   - Modify lib/write.mjs — merge air_id into frontmatter before file write.
   - Remove duplicate attestBeforeWrite calls from cli/index.mjs and mcp/create-server.mjs
     (the write path now handles it internally).

B: Wire hosted gateway writes to AIR.
   - Modify hub/gateway/server.mjs — call attestBeforeWrite before proxying note writes.
   - Modify hub/gateway/apply-note-provenance.mjs — inject air_id into the request payload.
   - New env var: KNOWTATION_AIR_ENDPOINT.

C: Add air.required config flag.
   - Modify lib/air.mjs — throw AttestationRequiredError when required=true and call fails.
   - Modify lib/config.mjs — document new field.

After A+B+C are done, commit, push, open PR.
Do NOT start D (built-in endpoint) or E (ICP anchor) in this session — those are separate branches.
```
