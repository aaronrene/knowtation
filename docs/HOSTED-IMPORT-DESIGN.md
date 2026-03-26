# Hosted import — design (replace gateway 501)

**Priority:** This is the **next hosted product gate** — ship **before** **Stripe subscriptions and billing enforcement** (users must be able to **import** into the cloud vault first). **Implementation branch:** `feature/hosted-import-parity`. **Plan:** [IMPLEMENTATION-PLAN.md](./IMPLEMENTATION-PLAN.md) strategic sequencing.

Self-hosted Hub runs [`hub/server.mjs`](../hub/server.mjs) `POST /api/v1/import`: multipart upload, optional ZIP extract, `runImport`, provenance merge, facets cache invalidation. Hosted uses [`hub/gateway/server.mjs`](../hub/gateway/server.mjs), which currently returns **501** for the same route so the UI does not 404.

## Goals

- Same **semantics** as self-hosted: `source_type` + file (or extracted tree), optional `project`, `output_dir`, `tags`.
- **Vault writes** end up in the user’s canonical store (canister-backed paths and/or bridge-side index), consistent with multi-vault (`X-Vault-Id`) and access control.

## Constraints

- The **ICP canister** does not implement multipart import. Full parity requires a **gateway or bridge** component that can:
  - Accept multipart uploads (size limits, virus scanning policy TBD by operator).
  - Resolve **vault root** for `(userId, vault_id)` the same way as other Hub write paths.
  - Run **`runImport`** (or equivalent) in an environment that has **temporary disk** for extract + processing.
  - Persist resulting Markdown notes to the same storage the rest of hosted Hub uses.
  - Trigger or schedule **re-index** for that vault when appropriate.

## Options (pick before implementation)

| Approach | Pros | Cons |
|----------|------|------|
| **A. Bridge worker** | Reuses Node `runImport`; matches self-hosted code path | Requires bridge deployment, secrets (e.g. `OPENAI_API_KEY` for transcription), temp storage quotas |
| **B. Gateway-only with ephemeral FS** | Single deploy unit if Netlify (or similar) allows large enough temp + dependencies | Cold starts, timeouts, package size (ffmpeg not in scope today), Whisper still needs API |
| **C. Async job queue** | Better for large ZIPs / video | More moving parts (queue, worker, status API) |

## Recommended sequencing

1. Document **max upload size** and **allowed `source_type`** on hosted (mirror [`IMPORT_SOURCE_TYPES`](../lib/import-source-types.mjs)).
2. Implement **small-file path first** (markdown, JSON, small CSV) without transcription on hosted if API keys are not to be held server-side; or require **user-supplied** OpenAI key in settings (product decision).
3. Keep **501** until storage and indexing contract match; update [PARITY-PLAN.md](./PARITY-PLAN.md) and [STATUS-HOSTED-AND-PLANS.md](./STATUS-HOSTED-AND-PLANS.md) when shipped.

## Security

- Authenticate and authorize like other `POST` routes (`X-User-Id` / JWT, vault scope, editor role).
- **Do not** log raw upload contents; redact paths in logs if they contain PII.
- Validate `source_type` against the shared allowlist only.

---

## Hosted workers (recommended production shape)

**Problem:** Netlify Functions (and similar) have **short timeouts** and **small request bodies**. Video upload + Whisper in one HTTP request will fail or hit “Failed to fetch” in the browser.

**Pattern:** Treat import like other heavy work you already run on the **bridge** (`POST /api/v1/index`, `POST /api/v1/search`), not inside the canister.

### A. Gateway

- When **`BRIDGE_URL`** is set, register **`POST /api/v1/import`** (and **`OPTIONS`**, same lesson as `vault/sync`) **before** the catch-all canister proxy — mirror [`hub/gateway/server.mjs`](../hub/gateway/server.mjs) routes for search/index.
- Forward **multipart** body + `Authorization` + `X-Vault-Id` to **`BRIDGE_URL/api/v1/import`** (stream or re-forward; avoid buffering entire video in the gateway if possible).
- When **`BRIDGE_URL`** is unset, keep **501** JSON so the UI never 404s.

### B. Bridge — two tiers

| Tier | Use case | Behavior |
|------|----------|----------|
| **Sync (small)** | Markdown, JSON, CSV, small ZIP | Accept multipart, write temp file, call existing **`runImport`** from [`lib/import.mjs`](../lib/import.mjs), then **write each note to the canister** via the same API the Hub uses (`POST /api/v1/notes` per note or batch if you add it). Return **`{ imported, count }`** like self-hosted. |
| **Async (large / transcribe)** | Video, audio, huge ZIP | **202 Accepted** with **`{ job_id, status_url }`**. Persist upload to **object storage** (S3/R2/blob store you already use for bridge), enqueue a **job**; a **worker** process (long-lived Node on a VM, Railway/Fly, Cloud Run with long timeout, or a queue consumer) runs `importAudio` / `importVideo` / extract ZIP, then writes notes to the canister. Hub polls **`GET /api/v1/import/jobs/:id`** or you add a toast when done. |

Workers do **not** have to be Netlify-specific: any runtime that can hold **`OPENAI_API_KEY`**, run Node, and call the canister is fine.

### C. CORS / preflight

- Register **`OPTIONS`** for **`/api/v1/import`** on the gateway (and bridge if the browser calls the bridge directly — prefer **gateway-only** so one CORS surface).

### D. Limits (product + ops)

- **Max upload size** per tier (e.g. 5 MB sync, 500 MB async with storage).
- **Allowed `source_type`** on hosted (you may disable `notion` until secrets are per-user, etc.) — mirror [`lib/import-source-types.mjs`](../lib/import-source-types.mjs).

---

## Cost monitoring + billing (align with existing credits)

You already meter **search**, **index**, **note_write** in [`hub/gateway/billing-middleware.mjs`](../hub/gateway/billing-middleware.mjs) and [`hub/gateway/billing-constants.mjs`](../hub/gateway/billing-constants.mjs).

**Add operations** (names illustrative):

| Operation key | When to charge | Notes |
|---------------|----------------|--------|
| `import_small` | After successful **sync** import (per request or per MB) | Covers CPU + temp storage + canister writes |
| `import_transcribe` | After Whisper succeeds (flat per job **or** scaled by **audio minutes** read from file metadata) | Pass through model from **OpenAI usage dashboard** + margin |
| `import_job_start` | Optional: small hold when **202** accepted | Prevents abuse on async path |

**Implementation order:**

1. **`BILLING_SHADOW_LOG`** — log `import_*` with `user_id`, `source_type`, `bytes`, `duration_estimate` (no charge).
2. **`COST_CENTS` + `COST_BREAKDOWN`** — user-visible prices in billing summary.
3. **`BILLING_ENFORCE`** — call **`runBillingGate`** on gateway **before** proxying import to bridge (same as search/index).

**OpenAI:** Use a **platform** API key on the worker; attribute cost internally via **usage logs** (shadow → enforce). Optional later: **customer BYOK** (store encrypted key per user) — higher compliance overhead.

**Cross-check:** Update [HOSTED-CREDITS-DESIGN.md](./HOSTED-CREDITS-DESIGN.md) table in §3 when `import_*` ships.

---

## Implementation checklist (engineering)

1. Bridge: `POST /api/v1/import` + `OPTIONS` — auth JWT, `resolveHostedBridgeContext`, temp dir, multipart parser (multer or busboy), `runImport` for sync path.
2. Bridge → canister: reuse export/index patterns; **write notes** with effective `X-User-Id` + `X-Vault-Id`.
3. Gateway: replace 501 stub with **conditional proxy** to bridge when `BRIDGE_URL` set; billing gate + CORS.
4. Hub UI (optional): show **501** / **402** messages clearly; for async, show **job status** polling.
5. Worker (phase 2): queue + processor + object storage for blobs.
6. Docs: PARITY-PLAN + STATUS-HOSTED when live.
