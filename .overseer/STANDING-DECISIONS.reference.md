# Standing Decisions (ADR log) — knowtation

Status: **Append-only decision log.** Each entry is decided once; supersede with a new entry rather
than rewriting history. Other docs point here rather than re-deriving the decision.

**Authoritative location in this repo:** `docs/CROSS-REPO-COORDINATION.md`

---

## How to use this log

| Rule | Detail |
| --- | --- |
| **Tier 2 decisions** | Record here after recommend-and-confirm (see `policy/tiers.yaml`) |
| **Append-only** | Never edit or delete past rows; add SD-N+1 to supersede |
| **Cross-link** | Reference `SD-N` from roadmap, handover, and specs — do not copy rationale inline |
| **Scope** | Name affected repos/systems in **Scope of effect** |

---

## Decision authority (summary)

Full table: `policy/tiers.yaml` and `docs/CROSS-REPO-COORDINATION.md` (when present).

| Tier | Behavior |
| --- | --- |
| **1 — Standing defaults** | Reversible, local, no live/external effect → **just do it** |
| **2 — Recommend-and-confirm** | Real trade-offs → propose + one yes/no → record here |
| **3 — Hard gates** | Irreversible / live / cost / security → **always stop for operator authorization** |

---

## Standing Decisions table (append below)

| ID | Date | Decision | Rationale | Scope of effect |
| --- | --- | --- | --- | --- |
| **SD-1** | <YYYY-MM-DD> | **Feature-branch commits (docs or code) are pre-authorized (Tier 1).** Push-to-staging remains Tier 3. Merge-to-`main` is Tier 3 by default; **SD-21** carves finish-mode land hygiene after BV `pass`. | Commits on a branch are reversible and make work durable; uncommitted dirty trees are the riskier state. | knowtation; all feature-branch work |
| **SD-3** | <YYYY-MM-DD> | **Model-split handover prompts:** steps marked **Thinking → Auto** emit **`{step}a` (Thinking)** then **`{step}b` (Auto)** in `docs/OVERSEER-HANDOVER.md`. Single-model steps stay one prompt. | Opus on boilerplate wastes cost; Auto on security boundaries risks mistakes. | `docs/OVERSEER-HANDOVER.md`; `docs/ROADMAP.md` |
| **SD-17** | <YYYY-MM-DD> | **Governance sync is a hard prerequisite for session complete.** Closing commit bundles code/tests + `docs/ROADMAP.md` + `docs/OVERSEER-HANDOVER.md`. Routine VCS hygiene (feature-branch commit/push/PR-open) is Tier 1. | Prevents stale handover/roadmap drift and over-cautious "ask before commit" friction. | knowtation; see `policy/tiers.yaml` |
| **SD-21** | 2026-07-29 | **Finish-mode land hygiene after BV `pass` is Tier 1.** When build-verification is `pass`, the feature is complete, and the diff has no live posture/env flip, secrets, real money, or Delegation write env: agents just do Muse merge/cherry-pick → `main` → muse-bridge → green `muse-mirror`→GitHub `main` (SD-14 only). Still forbidden: `git push origin main`, feature→GitHub-`main`, staging push, blind `--auto` merge. | Removes false land-ask friction; keeps SD-14 + live/security gates. | `policy/tiers.yaml`; muse+git-mirror consumers |

<!-- Append new SD-N rows above this line. Kit ships format only — contents are repo-specific. -->

---

## Model-split protocol pointer (SD-3)

When a roadmap step's **Model** column contains **`→`**, the handover block follows:

| Piece | Naming | Model | Delivers | Must NOT do |
| --- | --- | --- | --- | --- |
| **Part a** | `{step}a` | **Thinking** | Contract, fail-closed rules, seven-tier test matrix | Implementation beyond types/contracts |
| **Part b** | `{step}b` | **Auto** | Mechanical impl to the frozen contract; run tests | Redesign the contract; widen scope |

**Regeneration:** if `{step}a` is not done → handover lists `{step}a` only; if done → `{step}b` only.

See `policy/model-labels.yaml` for allowed labels.
