# Plan: extend proposal Enrich (full metadata recommendations)

**Status:** Planning / design (implementation on branch `feature/enrich`).  
**Related:** [HUB-PROPOSAL-LLM-FEATURES.md](./HUB-PROPOSAL-LLM-FEATURES.md) (current Enrich: summary + `suggested_labels`), [PROPOSAL-LLM-NEXT-SESSION.md](./PROPOSAL-LLM-NEXT-SESSION.md), [SPEC.md](./SPEC.md) §2 (frontmatter), [INTENTION-AND-TEMPORAL.md](./INTENTION-AND-TEMPORAL.md).

## Problem

Today **Enrich** (`POST /api/v1/proposals/:id/enrich`) asks the model for JSON shaped roughly as:

- `summary` (stored in proposal assistant notes)
- `suggested_labels` (tag-like strings)

Reviewers still manually decide **project**, **causal / entity / episode** fields, **title**, **follows** links, and other frontmatter that the vault and filters already understand. We want Enrich to **recommend as much of that metadata as is reasonable** from the proposed body + path + existing proposal fields, so humans can approve with fewer guesswork and agents get structured hints aligned with `list-notes` / search filters.

## Goals

1. **Expand LLM output** beyond summary + tags to a **structured “suggested frontmatter”** object covering vault-relevant fields (see table below).
2. **Stay advisory** — same security model as today: recommendations are **not** authorization; merge/approve still applies canonical rules and human choice.
3. **Normalize** outputs to **SPEC** rules (slug normalization for `project`, tags, `causal_chain_id`, `entity`, `episode_id` per [SPEC.md](./SPEC.md) §1–2 and `lib/vault.mjs`).
4. **Parity** — self-hosted Node Hub, hosted gateway + canister storage, and Hub UI should all understand the expanded shape (migration/versioning as needed).

## Target fields (v1 recommendation set)

Prioritize fields that **already drive** list, search, calendar, and graph behavior. Omit or mark “future” for reserved / payment / provenance keys the model must not invent.

| Field | Type (suggested) | Notes |
|--------|------------------|--------|
| `title` | string | Short note title if distinct from first heading. |
| `project` | string (slug) | Effective project; normalize like CLI `--project`. |
| `tags` | string[] | Same semantics as `suggested_labels` today; may merge or alias. |
| `date` | string | ISO date if inferable from content (optional). |
| `source` | string | Only if clearly stated in body (optional). |
| `intent` | string | Short intent line; may duplicate/supplement proposal `intent`. |
| `description` / `summary` | string | Keep summary for backwards compatibility; map to assistant display. |
| `follows` | string \| string[] | Vault-relative path(s) if model infers continuation links. |
| `causal_chain_id` | string | Single chain slug. |
| `entity` | string \| string[] | Entity slugs. |
| `episode_id` | string | Episode slug. |

**Explicitly out of scope for model suggestion (human or system only):**

- `knowtation_*`, `author_kind`, `proposal_id`, approval timestamps, AIR ids.
- `kind: approval_log` and anything under `approvals/` workflow.
- Blockchain / wallet reserved keys ([SPEC.md](./SPEC.md) §2.3 “reserved”) unless product later opts in.

**Nice-to-have (v2):** `state_snapshot`, `compression`, or other INTENTION-AND-TEMPORAL extras if we document stable shapes first.

## API and storage (directional)

1. **LLM JSON schema** — Versioned envelope, e.g. `{ "enrich_version": 1, "summary": "...", "suggested_labels": [], "suggested_frontmatter": { ... } }` so old clients ignore unknown keys and we can migrate.
2. **Persistence** — Either extend Motoko `ProposalRecord` with a new `Text` blob (`assistant_suggested_metadata_json`) or pack into existing assistant fields with strict JSON parsing on read. Prefer **one JSON column** to avoid many stable-field migrations on the canister.
3. **Hub UI** — Show grouped recommendations (Identity: title/project/tags; Graph: chain/entity/episode/follows; Narrative: summary/intent). Actions: copy JSON, or “Apply as starting frontmatter” on approve preview (does not bypass review).
4. **Validation layer** — Server-side: strip unknown keys, normalize slugs, clamp string lengths, reject non-string/array shapes before persist.

## Implementation order (suggested)

1. **Docs + JSON schema** in repo (this file + OpenAPI/HUB-API appendix when implemented).
2. **Self-hosted** `hub/server.mjs` enrich handler: new prompt, parse, validate, store on file-backed proposals.
3. **Hub UI** read-only display of `suggested_frontmatter`.
4. **Canister + Migration.mo** + gateway `proposal-enrich-hosted.mjs` + deploy notes.
5. **Optional:** merge assist — pre-fill editor frontmatter from suggestions on “Edit before approve” (if such a flow exists).

## Testing

- Fixture proposals with rich body text; assert normalized slugs and omitted forbidden keys.
- Golden JSON tests for parser (no network in CI).
- Hosted smoke: one enrich call after canister upgrade with migration.

## Non-goals

- Auto-approve based on Enrich output.
- Replacing **review hints** (plain text) or merging the two jobs into one without product review.
- Full RAG over the vault inside enrich v1 (optional context: “top 3 `list-notes` paths” could be a later enhancement).
