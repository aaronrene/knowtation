# Knowtation — agent instructions

## Version control (read first)

This repo uses **Muse** for the canonical history on **MuseHub (staging)** and **Git** for **GitHub** (PRs, CI, mirrors).

| Intent | Tooling |
|--------|---------|
| **Default** — ship product changes to MuseHub | `muse status` → `muse code add …` → `muse commit -m "…"` → `muse push staging <branch>` |
| **GitHub-only** — PR, branch protection, Actions | `git add` / `git commit` / `git push` when the user or task says Git is the target |

- Staging remote name: **`staging`** (`aaronrene/knowtation` on `staging.musehub.ai`).
- **`.museignore`** governs Muse snapshots; keep it aligned with **`.gitignore`** for secrets and local data (`config/local.yaml`, `data/`, etc.).
- If the user says "commit" without specifying **Muse** or **Git**, **prefer Muse** for this tree or ask once.

## GitHub mirror workflow — MANDATORY, no exceptions

**NEVER push directly to `main` on GitHub.** Every Muse merge to local `main` must be mirrored to GitHub via a PR from the `muse-mirror` branch. This is what preserves the PR audit trail (PR #NNN links, diff view, review threads).

**Required steps every time code lands on Muse `main`:**

```bash
# 1. After: muse checkout main && muse merge feat/<branch>
git add -A && git commit -m "mirror: muse <sha-before>..<sha-after> (<description>)"
git checkout -B muse-mirror          # reset muse-mirror branch to current HEAD
git push origin muse-mirror --force  # push mirror branch to GitHub

# 2. Open a PR from muse-mirror → main
gh pr create --base main --head muse-mirror \
  --title "mirror: <description>" \
  --body "Muse mirror — <muse-sha-range>"

# 3. Merge the PR (merge commit, not squash or rebase)
gh pr merge --merge
```

**Hard stops — if you are about to run either of these, STOP:**
- `git push origin main` — use muse-mirror instead
- `git push origin HEAD` while on `main` — use muse-mirror instead

**Why this rule exists:** The GitHub PR history is the permanent, human-readable audit record. PRs #226, #227, … are proof that every change was reviewed before landing. Pushing directly to `main` skips that record entirely and is not recoverable after the fact.

## Knowtation product (MCP / CLI / vault)

Orchestration, MCP vs CLI, retrieval, and write-back: **[docs/AGENT-ORCHESTRATION.md](docs/AGENT-ORCHESTRATION.md)**. One-page surface overview: **[docs/AGENT-INTEGRATION.md](docs/AGENT-INTEGRATION.md)**.

**Private vaults:** outside the repo or only via ignored `config/local.yaml` — not under in-repo `vault/` if remotes may be public.

## Tests and quality

Follow project conventions in **[CONTRIBUTING.md](CONTRIBUTING.md)** and existing test layout under `test/`. Do not commit secrets or gitignored paths.
