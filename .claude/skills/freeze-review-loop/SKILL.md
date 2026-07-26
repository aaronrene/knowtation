# Freeze-review loop skill

Use when a frozen spec (`frozen: true`) must reach **`pass`** before an Auto build phase may start.
Invoke explicitly: **`/freeze-review-loop`** or paste the prompt below. **Not automatic by default**
— the operator or handover must request it.

Complements `cursor/skills/freeze-review/SKILL.md` (single-pass review). This skill runs **bounded
rounds** until `pass`, escalation, or max rounds — without re-pasting the prompt each round.

## Purpose

Prevent dishonest or shallow freeze approvals. A thinking-model reviewer must cite **file+line**
findings; a fixer applies **only** those citations; the reviewer re-checks until clean or stopped.

## When to use

- Roadmap step **`{step}a` (Thinking)** just committed a freeze artifact
- `ok review --freeze <path>` returned `findings` or you need deep review beyond the checklist
- Before clearing **`{step}b` (Auto)** in the handover

## Model

- **Reviewer rounds:** `thinking-high` label — extended thinking / Opus-class in Cursor
- **Fix rounds:** may use Auto for mechanical citation fixes only; reviewer always re-runs thinking

Read `policy/model-labels.yaml` and `.overseer/config.yaml` → `freeze_contract.reviewer`.

## Hard stops (stop loop immediately)

Escalate to human — do **not** auto-fix — when any finding is:

- `security` — auth, scope, secrets, injection
- `irreversible` — data deletion, non-revertible migrations
- `real_money` — billing, live spend
- `gates_tier3` — artifact gates merge, staging push, live flip

Also stop when:

- Verdict is `blocked`
- Round count reaches **max rounds** (default **7**)
- Fixer would need to change scope beyond cited lines (Tier 2 — ask once)

## Loop (execute in one agent session — do not stop after one round)

```text
ROUND = 1
MAX_ROUNDS = 7   # operator may lower to 3 for small specs

while ROUND <= MAX_ROUNDS:

  1. REVIEW (thinking model, independent posture)
     - Read frozen artifact + frozen_inputs it depends on
     - Read docs/OVERSEER-KIT-SPEC.md §6
     - Emit verdict: pass | findings | blocked
     - Every finding: path:line, severity, category, concrete message
     - Run checklist mentally: ground-truth edge, completeness, consistency,
       security, irreversibility, real money, Tier-3 linkage, citation discipline
     - Do NOT trust prior round summaries — re-read files

  2. If pass:
     - Run: ok review --freeze <artifact-path>
     - If CLI pass: stamp ok; update artifact Review-record table; EXIT success

  3. If blocked OR escalating finding:
     - Record in Review-record table; STOP for human

  4. If findings (non-escalating):
     - FIXER: apply minimal edits addressing ONLY cited path:line items
     - No scope expansion; no deleting requirements to greenwash
     - Commit on feature branch (Tier 1)
     - ROUND += 1; continue loop

If ROUND > MAX_ROUNDS:
  - Verdict: blocked (max rounds)
  - STOP for human
```

## CLI between rounds (recommended)

After fixer commits, before next review round:

```bash
./cli/ok review --freeze <artifact-path> --dry-run
```

Checklist gate catches structural gaps; thinking review catches semantic dishonesty.

## Review-record table (required)

Append each round to the artifact's freeze **Review record** section:

| Round | Reviewer | Verdict | Resolution |
| --- | --- | --- | --- |
| N | Freeze-review loop (thinking) | findings | F1 fixed in … |

## Must cite

Uncited findings are **invalid** — discard and re-review. Operator verifies citations, not trust.

## Tier authority

- Feature-branch fixes during loop: **Tier 1**
- Merge to `{{vcs.git.main_branch}}`: **Tier 3** — never part of this loop
- Enabling Cursor Automation for this: **Tier 2** confirm once

## Degrade

If the skill cannot run (no thinking model, context limit): run single-pass `freeze-review` skill +
manual rounds in fresh chats.
