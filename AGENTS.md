# Knowtation — agent instructions

## Version control (read first)

This repo uses **Muse** for the canonical history on **MuseHub (staging)** and **Git** for **GitHub** (PRs, CI, mirrors).

| Intent | Tooling |
|--------|---------|
| **Default** — ship product changes to MuseHub | `muse status` → `muse code add …` → `muse commit -m "…"` → `muse push staging <branch>` |
| **GitHub-only** — PR, branch protection, Actions | `git add` / `git commit` / `git push` when the user or task says Git is the target |

- Staging remote name: **`staging`** (`aaronrene/knowtation` on `staging.musehub.ai`).
- **`.museignore`** governs Muse snapshots; keep it aligned with **`.gitignore`** for secrets and local data (`config/local.yaml`, `data/`, etc.).
- If the user says “commit” without specifying **Muse** or **Git**, **prefer Muse** for this tree or ask once.

## Knowtation product (MCP / CLI / vault)

Orchestration, MCP vs CLI, retrieval, and write-back: **[docs/AGENT-ORCHESTRATION.md](docs/AGENT-ORCHESTRATION.md)**. One-page surface overview: **[docs/AGENT-INTEGRATION.md](docs/AGENT-INTEGRATION.md)**.

**Private vaults:** outside the repo or only via ignored `config/local.yaml` — not under in-repo `vault/` if remotes may be public.

## Tests and quality

Follow project conventions in **[CONTRIBUTING.md](CONTRIBUTING.md)** and existing test layout under `test/`. Do not commit secrets or gitignored paths.
