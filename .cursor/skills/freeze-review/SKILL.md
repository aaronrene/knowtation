# Freeze-step review skill

Use when a phase output is declared `frozen: true` and downstream phases consume it as ground truth
without re-deriving (SD-3 Thinking → Auto boundary; OVERSEER-KIT-SPEC §6).

## Purpose

Review frozen specs and contracts **before** Auto build phases depend on them. Default path is
automated review with **file + line citations** for every finding; human escalation only for
security, irreversibility, real money, or Tier-3 gates.

## Read first

- `docs/OVERSEER-KIT-SPEC.md` §6 — Freeze-Contract review policy
- `policy/freeze-contract.schema.yaml` (K5) — phase output declarations
- `.overseer/config.yaml` → `freeze_contract.human_escalation`

## When to run

- Roadmap step marked **Thinking → Auto** and `{step}a` contract artifacts are Muse/Git committed
- Any artifact listed as `frozen: true` in a phase freeze block
- Before Tier 3 action consumes a frozen artifact (merge, staging push, live flip)
- Ad-hoc / side research via **`/check-ok`** (scaffolds `docs/reviews/` then this gate)

## Review checklist

1. **Ground-truth edge:** does a later phase treat this output as truth without re-deriving?
2. **Completeness:** interfaces, fail-closed rules, test matrix present?
3. **Security:** injection surfaces, secrets, scope leaks?
4. **Irreversibility / real money:** migrations, deletes, billing?
5. **Tier 3 linkage:** does this artifact gate merge, staging, or live gates?

## Verdicts

| Verdict | Meaning |
| --- | --- |
| `pass` | No blocking findings; record review stamp |
| `findings` | Cited list; resolve or escalate per config |
| `blocked` | Human required before downstream Auto build |

## CLI (when K5 lands)

```bash
/path/to/overseer-kit/cli/ok review --freeze <path> --dry-run
/path/to/overseer-kit/cli/ok review --freeze <path>
```

## Multi-round loop (optional)

For bounded review → fix → re-review until `pass`, use **`cursor/skills/freeze-review-loop/SKILL.md`**
(`/freeze-review-loop`). Not automatic — invoke when a frozen spec must clear before `{step}b` Auto build.

## After Auto build (honesty gate)

Freeze review guards the **spec**. **`cursor/skills/build-verification-review/SKILL.md`**
(`/build-verification-review`) guards the **implementation** — run before marking the phase DONE.
Manual/opt-in today; required by SD-3 discipline even when not enforced by CLI.

## Escalate to human when

- `security` — auth, scope, secrets, injection
- `irreversible` — data deletion, non-revertible migrations
- `real_money` — billing, live model spend
- `gates_tier3` — artifact gates merge, staging push, or live flip

Everything else: agent resolves or reports without a human stop.

## Must cite

Every finding **must** include `path:line` so the operator can verify — never trust uncited review output.
