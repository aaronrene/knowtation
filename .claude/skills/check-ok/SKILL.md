---
name: check-ok
description: >-
  Check OK — ad-hoc honesty check for any work (roadmap or side research).
  Scaffolds a side-check freeze if needed, then runs the same freeze-review and
  optional build-verification path used by every Overseer consumer. Works in
  Cursor, Claude Code, and via CLI for Copilot / any assistant.
---

# Check OK

Use when the operator says **Check OK**, **check ok**, **Check if OK**, or
**`/check-ok`** — for roadmap phases **or** side research that is **not** on the
ROADMAP. Does **not** open a new `docs.lanes` entry.

## Purpose

Same twin honesty gates as roadmap re-review loops:

| Gate | When | Tool |
| --- | --- | --- |
| **Freeze review** | Spec / Thinking output ready (`frozen: true`) | This skill → `/freeze-review` / `/freeze-review-loop` + `ok review --freeze` / `ok check-ok` |
| **Build verification** | Implementation claims done | `/build-verification-review` |

Engine is kit-owned (`tools/freeze_reviewer/` + `cli/commands/review.py`) — identical in
Scooling, Knowtation, VideoFactory, and any repo after `ok sync`.

## Where this skill is installed

| Runtime | Path after `ok sync` | How to invoke |
| --- | --- | --- |
| **Cursor** | `.cursor/skills/check-ok/` | Type `Check OK` or `/check-ok` |
| **Claude Code** | `.claude/skills/check-ok/` | Type `Check OK` or `/check-ok` |
| **Copilot / any chat** | N/A (no native skills) | Paste `docs/CHECK-OK.md` **or** run CLI below |
| **Any terminal** | CLI in kit | `ok check-ok …` |

## How the operator runs it

**Chat (Cursor or Claude Code):** type `Check OK` or invoke `/check-ok`.

**Terminal (works everywhere — Copilot, ChatGPT paste sessions, no IDE skills):**

```bash
ok check-ok --topic "my-side-research" --dry-run
ok check-ok --path docs/reviews/2026-07-17-my-side-research.md
ok check-ok --path docs/archive/phases/PHASE-FOO.md   # existing freeze artifact
```

(`ok check-if-ok` is a deprecated synonym for the same command.)

Chat does the **semantic** thinking-model review. Terminal runs the **mechanical** checklist
gate (same as `ok review --freeze`).

## Workflow (execute in this session)

1. **Identify the artifact**
   - If the operator names a freeze/spec path → use it.
   - Else if a PHASE / side-check doc already exists for the work → use it.
   - Else scaffold under `docs/reviews/<YYYY-MM-DD>-<slug>.md` via:

     ```bash
     ok check-ok --topic "<short-slug>" --scaffold-only
     ```

     Or create the file by hand using the template in this skill directory
     (`SIDE-CHECK-TEMPLATE.md`).

2. **Fill scope** — intent, interfaces, fail-closed rules, seven-tier test matrix, what
   must not change. Commit on a feature branch (Tier 1).

3. **Freeze review (beginning gate)** — Model: `thinking-high`
   - Follow the freeze-review skill (or freeze-review-loop for rounds).
   - Run mechanical gate:

     ```bash
     ok check-ok --path <artifact> --dry-run
     ok check-ok --path <artifact>          # stamps on pass when configured
     ```

     (`ok review --freeze <artifact>` is equivalent — same engine.)

4. **If Auto / code landed — build verification (end gate)**
   - Follow the build-verification-review skill.
   - Do **not** claim DONE / “shipped” without `pass`.

5. **Report** — verdict `pass` | `findings` | `blocked`; every finding needs `path:line`.
   Append the Review-record table on the artifact.

## Thinking sessions (always-on)

When the session Model is **Thinking** (or Thinking → Auto):

- **End of Thinking / before Auto:** freeze review must reach `pass` (step 3).
- **After Auto / implementation:** build verification must reach `pass` (step 4).

See the always-on rule `check-ok-thinking.mdc` (Cursor) and `AGENTS.md` § Check OK (all tools).

## Hard stops

Escalate to human — do not greenwash — for:

- `security` · `irreversible` · `real_money` · `gates_tier3`

Never open a new governance **lane** for a one-off check. Never merge to
`{{vcs.git.main_branch}}` as part of this skill (Tier 3).

## Read first

- `docs/CHECK-OK.md` — portable paste prompt (any assistant)
- `docs/OVERSEER-KIT-SPEC.md` §6
- freeze-review + build-verification-review skills (same footprint)
- `.overseer/config.yaml` → `freeze_contract`
