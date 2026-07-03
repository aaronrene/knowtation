# Overseer Handover — Knowtation (Phase 8 P1b)

Status: **Living artifact — Knowtation cross-repo handover for Phase 8 P1b offline-locked auth.**

Scooling overseer handoff lives in `scooling/docs/OVERSEER-HANDOVER.md`. Update **both** when P1b
milestones land.

---

## Next step at a glance (2026-07-02)

| | |
| --- | --- |
| **P1b-a spec** | **DONE** — `docs/PHASE-8-P1B-OFFLINE-LOCKED-AUTH-SPEC.md` (681 lines, frozen) |
| **P1b-b build** | **DONE** — code + seven-tier tests (29/29 green); merged to `main` (PR #254) |
| **P1b-c flag flip** | **CONSUMED** — `OFFLINE_LOCKED_AUTH_CODE_SHIPPED = true`; 29/29 green |
| **2F-b-a contract** | **DONE** — `docs/ATTACHMENT-STORE-CONTRACT-2F-b.md` frozen (2026-07-02) |
| **2F-b-b build** | **DONE + MERGED** — read-only attachment list/get; Muse `main` @ `sha256:a602cc7…` (code); handover @ `sha256:03c8fc1d…`; GitHub [PR #256](https://github.com/aaronrene/knowtation/pull/256) @ `5116edf` |
| **Branch** | Merged to Muse `main` and GitHub `main` (2026-07-02) |
| **Posture** | Read-only attachments v0; no consent-toggle writes; no Scooling posture flips |
| **Next (Knowtation)** | Optional: `node scripts/verify-attachment-read-smoke.mjs` against local Hub |
| **Next (Scooling)** | **2F-b-d-a** — external link + attach contract (Thinking) → see `scooling/docs/OVERSEER-HANDOVER.md` **PRIMARY — 2F-b-d-a** |

---

## Attachment gates (Scooling Phase 2F-b unblock)

| | |
| --- | --- |
| **2F-b-a contract** | **FROZEN** (2026-07-02, Thinking) — `docs/ATTACHMENT-STORE-CONTRACT-2F-b.md` |
| **2F-b-b build** | **DONE + MERGED** (2026-07-02, Auto) — Muse `main` @ `sha256:a602cc7…`; GitHub [PR #256](https://github.com/aaronrene/knowtation/pull/256) |
| **What landed** | Derived attachment index (`vault_file`/`mist_blob`/`embedded_url`), `hub_attachment_store.json` overlay (read-only), `listAttachments`/`getAttachment`, scope inherited from owning note, `*ForClient` projections, CLI/MCP/Hub REST parity, OpenAPI, seven-tier tests (28/28), `scripts/verify-attachment-read-smoke.mjs` |
| **Consumer** | Scooling `src/adapters/mediaLibraryAdapter.ts` — **`MEDIA_LIVE_READ_AUTHORIZED` live** (2F-b-c-c MERGED 2026-07-02); external link + attach gates remain hard-`false` |
| **Follow-on gates** | `ATTACHMENT_POLICY_WRITES_AUTHORIZED` (consent toggles) · OCR derived-artifact gate · hosted gateway proxy |

---

## Verified snapshot (2F-b-b)

| Deliverable | Location |
| --- | --- |
| Derivation walk | `lib/attachments/derive.mjs`; re-export `mcp/resources/listing.mjs` |
| Read store | `lib/attachments/attachment-store.mjs` |
| Policy overlay file | `lib/attachments/attachment-store-file.mjs` → `hub_attachment_store.json` |
| Shared handlers | `lib/attachments/attachment-handlers.mjs` |
| Hub REST (self-hosted) | `GET /api/v1/attachments`, `GET /api/v1/attachments/:id` in `hub/server.mjs` |
| CLI | `knowtation attachment list\|get` in `cli/index.mjs` |
| MCP | `mcp/tools/attachment.mjs` — `attachment_list`, `attachment_get`; ACL in `hub/gateway/mcp-tool-acl.mjs` |
| OpenAPI | `docs/openapi.yaml` — Attachments tag + schemas |
| Tests | `test/attachment-store-*.test.mjs`, `test/attachment-list-get-parity-integration.test.mjs` — **28/28 PASS** |
| Hosted smoke | `scripts/verify-attachment-read-smoke.mjs` |

**Test command:**

```bash
node --test test/attachment-store-*.test.mjs test/attachment-list-get-parity-*.test.mjs
node scripts/verify-attachment-read-smoke.mjs   # requires local self-hosted Hub + JWT
```

---

## Verified snapshot (P1b-c)

| Deliverable | Location |
| --- | --- |
| Credential store + Argon2id | `hub/lib/local-auth.mjs` |
| Feature flag (shipped) | `hub/lib/local-auth-feature-flag.mjs` — `OFFLINE_LOCKED_AUTH_CODE_SHIPPED = true` |
| Bootstrap (setup token + CLI) | `hub/lib/local-auth-bootstrap.mjs`, `hub/lib/local-auth-cli.mjs` |
| Hub routes | `hub/lib/local-auth-routes.mjs`; wired in `hub/server.mjs`, `hub/gateway/server.mjs` |
| CLI | `knowtation auth generate-setup-token \| bootstrap-admin \| token` |
| Breached-password check | `hub/lib/breached-passwords.mjs` + `hub/lib/breached-passwords-sha1.txt` (~2k hashes; loader ready for expansion) |
| Tests | `test/{unit,integration,e2e,stress,data-integrity,performance,security}/phase8-p1b-*.test.mjs` — **29/29 PASS** (post flip) |

---

## Change log

| Date | Event |
| --- | --- |
| 2026-07-02 | **Handover sync** — Muse `main` @ `sha256:03c8fc1d…`; Scooling 2F-b-c-c MERGED; Scooling next = **2F-b-d-a** |
| 2026-07-02 | **Scooling 2F-b-c-c MERGED** — `MEDIA_LIVE_READ_AUTHORIZED` live; GitHub [PR #132](https://github.com/aaronrene/scooling/pull/132); Scooling next = **2F-b-d-a** (external link + attach contract) |
| 2026-07-02 | **2F-b-b MERGED** — Muse `main` @ `sha256:a602cc7…`; GitHub [PR #256](https://github.com/aaronrene/knowtation/pull/256) @ `5116edf`; Scooling 2F-b-c unblocked |
| 2026-07-02 | **2F-b-b attachment store build DONE** — read-only list/get + overlay + triple-surface parity + seven-tier tests (28/28) on `feat/phase-2f-b-attachment-store`; unblocks Scooling Phase 2F-b live wire (Tier 3) |
| 2026-07-02 | **2F-b-b build prompt drafted** — self-contained PRIMARY next-chat prompt (Auto) added; no PR for the docs-only contract (SD-11) — it rides to `main` bundled with the 2F-b-b code+tests |
| 2026-07-02 | **Attachment gates 2F-b-a contract FROZEN** — `docs/ATTACHMENT-STORE-CONTRACT-2F-b.md` on `feat/attachment-store-contract-2f-b`; unblocks Scooling Phase 2F-b; contract only, no code, no posture flip |
| 2026-07-01 | P1b-c **MERGED** — `OFFLINE_LOCKED_AUTH_CODE_SHIPPED = true`; Muse `sha256:537d4407…`; GitHub PR #255 @ `6976eef` |
| 2026-07-01 | P1b-c flag flip — 29/29 green on `feat/phase-8-p1b-c-offline-locked-auth-flag-flip` (Tier 3 authorized) |
| 2026-07-01 | P1b-a spec frozen on `feat/phase-8-p1b-offline-locked-auth-spec` (Muse `4aaa6f7`) |
| 2026-07-01 | P1b-b Auto build complete — inert libs + 29 tests; bundled for Tier 3 merge |
