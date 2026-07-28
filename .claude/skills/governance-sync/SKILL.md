# Governance sync skill

Use when a session is ending, handover/roadmap may be stale, or the operator runs `/governance-sync`.

## Purpose

Keep `{{docs.roadmap_path}}` and `{{docs.handover_path}}` aligned with true VCS state and phase
truth. This automates the SD-17 obligation — it does not invent new policy.

## Read first

- `{{docs.handover_path}}` — current NEXT block
- `{{docs.roadmap_path}}` — build status table
- `policy/tiers.yaml`, `policy/model-labels.yaml`
- `.overseer/config.yaml` — regime and doc paths

## Workflow (docs-first)

1. Read VCS status via the kit adapter for **`{{vcs.regime}}`** (fail-closed on read errors).
2. Compare docs to reality; list drift (phase status, branch/sha, NEXT prompt staleness).
3. Update `{{docs.roadmap_path}}` first.
4. Regenerate `{{docs.handover_path}}` from updated roadmap + VCS snapshot.
5. Include **`Model:`** on every NEXT block per `policy/model-labels.yaml`.
6. If NEXT is **Thinking → Auto**, emit `{step}a` or `{step}b` only — not both unless `{step}a` incomplete.

## CLI (when K4/K5 land)

```bash
/path/to/overseer-kit/cli/ok governance-sync --dry-run
/path/to/overseer-kit/cli/ok governance-sync
```

**Default: dry-run.** Writes only on explicit non-dry-run; never on `{{vcs.git.main_branch}}`.

## Closing commit

Feature branch only. Message pattern: `governance: sync handover + roadmap (<date>)`. Bundle both docs.

## Hard stops

- No merge to `{{vcs.git.main_branch}}` without Tier 3
- No staging push without Tier 3
- No live posture flips
