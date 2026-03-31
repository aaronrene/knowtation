# Plan: extend proposal Enrich (full metadata recommendations)

**Status:** Implemented in repo (shared lib, Node Hub, canister V5, gateway, Hub UI).  
**Related:** [HUB-PROPOSAL-LLM-FEATURES.md](./HUB-PROPOSAL-LLM-FEATURES.md), [HUB-API.md](./HUB-API.md) § proposals, [SPEC.md](./SPEC.md) §2, [INTENTION-AND-TEMPORAL.md](./INTENTION-AND-TEMPORAL.md), [DEPLOY-HOSTED.md](./DEPLOY-HOSTED.md) (canister order).

## Problem (resolved)

Enrich previously returned only a short summary and `suggested_labels`. Reviewers still inferred **project**, **causal / entity / episode** fields, **title**, **follows**, and other frontmatter manually.

## Goals (met)

1. **Expand LLM output** to a structured **`suggested_frontmatter`** object (SPEC §2.1 + §2.3 allow-list in code).
2. **Stay advisory** — recommendations are not authorization; approve still applies vault rules and human choice.
3. **Normalize** via [lib/proposal-enrich-llm.mjs](../lib/proposal-enrich-llm.mjs) (slugs, tags, paths; forbidden keys stripped).
4. **Parity** — same parsing and caps on self-hosted Node ([hub/server.mjs](../hub/server.mjs)), hosted gateway ([hub/gateway/proposal-enrich-hosted.mjs](../hub/gateway/proposal-enrich-hosted.mjs)), and canister persistence ([hub/icp/src/hub/main.mo](../hub/icp/src/hub/main.mo)).

## Wire format

### LLM envelope (model output)

The model is asked for JSON only, with:

- `enrich_version`: **2** (see `ENRICH_VERSION` in `lib/proposal-enrich-llm.mjs`).
- `summary`: string (stored in `assistant_notes`).
- `suggested_labels`: string array (stored as today; also overlaps tag-like hints).
- `suggested_frontmatter`: object with **only** allow-listed keys (see `SUGGESTED_FRONTMATTER_KEYS` in the same module).

Older models returning only `summary` + `suggested_labels` still parse; `suggested_frontmatter` defaults to `{}`.

### Persistence

| Surface | Field |
|--------|--------|
| Node proposals file | `assistant_suggested_frontmatter` (object); cleared on re-enrich when the normalized object is empty (`in` check in [hub/proposals-store.mjs](../hub/proposals-store.mjs)). |
| Canister `ProposalRecord` | `assistant_suggested_frontmatter_json` (`Text`), default `"{}"`; POST enrich trims to **14000** characters (aligned with `ENRICH_SUGGESTED_FRONTMATTER_MAX_JSON_CHARS`). |
| **GET /proposals/:id** | `assistant_suggested_frontmatter` as **embedded JSON object** (same pattern as `suggested_labels` array inlining on the canister). |

### Gateway → canister POST body (hosted enrich)

`assistant_notes`, `assistant_model`, `suggested_labels_json`, **`assistant_suggested_frontmatter_json`** (JSON string of normalized object).

## Migration

- **V5 field** (`assistant_suggested_frontmatter_json`): first upgrade from **V4** stable layout used a migration whose input was **`StableStorageV4`** (see git history if you need that WASM for a canister still on V4-only storage).
- **Repeat deploys** after mainnet already stores **`StableStorage`** (V5): the actor hook is **identity** on **`StableStorage`** so `dfx deploy` matches on-chain types. See [Migration.mo](../hub/icp/src/hub/Migration.mo) module comment.
- Canisters **not** yet on V4 must deploy an intermediate build that runs the **V4** enrich migration first; see comments at top of `Migration.mo`.

## Hub UI

[web/hub/hub.js](../web/hub/hub.js): existing Assistant block unchanged; **Suggested frontmatter** table + **Copy JSON** when `assistant_suggested_frontmatter` has keys.

## Non-goals (unchanged)

- Auto-approve based on Enrich output.
- Implicit merge of suggestions into the vault on approve (operators copy or edit manually unless a future feature adds an explicit apply step).
- Full RAG over the vault inside enrich v1.

## Testing

- Unit: `node --test test/proposal-enrich-llm.test.mjs`.
- Static migration contract: `node scripts/verify-canister-migration.mjs`.
- Upgrade: V4→V5 preserves existing `assistant_notes` / `suggested_labels_json`; new field empty until enrich runs again.
