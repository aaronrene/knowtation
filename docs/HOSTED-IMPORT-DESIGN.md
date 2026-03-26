# Hosted import — design (replace gateway 501)

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
