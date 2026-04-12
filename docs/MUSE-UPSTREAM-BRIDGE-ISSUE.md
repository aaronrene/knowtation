# Draft: upstream Muse feature — `muse bridge git-push` (or equivalent)

Use this as the body of a GitHub issue or RFC on [cgcardona/muse](https://github.com/cgcardona/muse).

---

## Summary

Teams migrating to MuseHub still depend on **Git-hosted CI/CD** (Netlify branch deploys, GitHub Actions, etc.). Today they must run an **export pipeline** themselves: `muse archive` → extract → `git commit` / `git push`.

A **first-class porcelain command** would standardize this, reduce copy-paste errors, and document auth expectations across Muse versions.

## Proposed UX (sketch)

```bash
muse bridge git-export \
  --muse-ref main \
  --git-dir ../knowtation-git \
  --git-branch chore/muse-mirror \
  [--dry-run] [--no-push]
```

Behavior:

1. Resolve `--muse-ref` to a commit id in the **current Muse repo**.
2. Build an archive of the tracked snapshot (same as `muse archive`).
3. Sync into `--git-dir` with a **delete+replace** strategy excluding `.git/`, then `git add -A`.
4. If there are staged changes, commit with message `mirror: muse <full_commit_id>`.
5. Optionally `git push` to `--git-branch`.

## Why upstream

- **Stable CLI contract** (`--json`, exit codes, `--dry-run`) for agents and CI.
- **Auth story in one place**: signing / `MUSE_AGENT_KEY` / future token flows documented next to the command.
- **Optional**: integration with `muse hub` to default clone URL from `origin` remote.

## Reference implementation

Knowtation uses a shell script and GitHub Actions workflow (see this repo’s `scripts/muse-export-to-git.sh` and `.github/workflows/muse-mirror-to-github.yml`). Upstream could reimplement in Python alongside existing porcelain, or ship a thin wrapper that calls the same primitives as `muse archive`.

## Non-goals

- **Bidirectional** sync (Git → Muse) — intentionally out of scope; mirrors are one-way.
- **Lossless** Git DAG replay of Muse history.

## Acceptance criteria (suggestion)

- `muse bridge git-export --dry-run` prints resolved Muse `commit_id` and file count without touching Git.
- Documented requirement for Git working tree (clean vs dirty).
- Machine-readable output flag for CI.

---

_End of draft._
