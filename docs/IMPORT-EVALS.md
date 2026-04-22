# Import evals vs retrieval evals vs proposal evaluation

Keep these **separate** so work does not backtrack.

## 1. Import / ingest QA (eval v1) — **now**

- **Question:** Did this importer produce notes with the expected **frontmatter** (`source`, `source_id`, `date`, `title` where applicable) and body?
- **How:** Golden fixtures under `test/fixtures/import/` plus `test/import-importers-golden.test.mjs` and `test/import-source-types.test.mjs`.
- **Scope:** Deterministic importers in [`lib/importers/`](../lib/importers/). Notion (live API), audio/video (Whisper), and hosted multipart are exercised manually or in integration environments; see [IMPORT-MANUAL-CHECKLIST.md](./IMPORT-MANUAL-CHECKLIST.md).
- **Optional fields** (`causal_chain_id`, `episode_id`, `entity`, `follows`): assert in goldens **only when** an importer is defined to set them; otherwise treat as a **product** extension, not a regression in the base import phase.

## 2. Retrieval / RAG evals (eval v2) — **later**

- **Question:** For a query, do we retrieve the **right notes** (and optionally the right **order** for causal chains)?
- **Spec reserve:** [INTENTION-AND-TEMPORAL.md](./INTENTION-AND-TEMPORAL.md) §7 and [SPEC.md](./SPEC.md) (`knowtation eval`, eval set format TBD).
- **Dependency:** Stable index + labeled query set over **real** vault content (often after imports). Do **not** conflate with import goldens.

## 3. Governance / proposal evaluation — **later**

- **Question:** Should this **proposal** merge (policy, safety, quality)?
- **Doc:** Lifecycle and `kn1_` concurrency: [PROPOSAL-LIFECYCLE.md](./PROPOSAL-LIFECYCLE.md). Requires canister/gateway alignment for any new `evaluation_status` fields.
- **Import today** writes **directly** to the vault (self-hosted Hub), not through the proposal queue. Agent/human grading (e.g. A–F) belongs here if imports are routed through proposals or a staging inbox—**product decision first**.

## Summary

| Layer | Tests / tooling | When |
|-------|-----------------|------|
| Import QA | Fixture goldens + manual checklist | With import phase |
| Retrieval | Future `knowtation eval` + eval sets | After index/search baselines |
| Proposal eval | Lifecycle + Hub/canister | After Option B+ spec |
