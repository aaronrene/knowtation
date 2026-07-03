---
title: Muse local hygiene — canonical guardrails for all Muse-as-source-of-truth repos
date: 2026-07-03
project: knowtation
tags: [muse, musehub, bridge, hygiene, data-loss, secrets, git, skip-worktree, cross-repo, sd-hygiene]
revision: 1
last_review: 2026-07-03
editor: aaronrene
challenged_count: 3
status: locked
depends_on:
  - MUSE-BRIDGE-WORKFLOW.md
  - scripts/muse-bridge-deploy.sh
  - scripts/muse-local-setup.sh
  - docs/musehub-issues/2026-07-03-bridge-deletes-ignored-files-rc15-refile.md
---

# Muse local hygiene — canonical guardrails (all repos)

**Scope.** This note is the single source of truth for working safely with **Muse as the canonical
VCS** across every repo that mirrors to GitHub (Knowtation, Scooling, MuseHub, and any future repo).
Muse is canonical; GitHub `origin/main` is the audit mirror reached only via `muse-mirror` PRs.

> One-line rule: **never point a Muse bridge command at your working tree, and never trust a diverged
> local git `main`.**

---

## 1. The data-loss trap: `muse bridge --git-dir .` (CRITICAL)

`muse bridge git-export` (and `git-import`) treat the target git directory as **disposable**: they
walk it and delete every file not on an exclude list, **without honoring `.gitignore` or
`.museignore`**. Pointing `--git-dir` at your real checkout therefore **permanently deletes local
ignored files** — `.env`, `config/local.yaml`, `data/`, local databases — which are exactly the files
Muse/Git intentionally do not store, so they are **not recoverable** from history.

- **Verified still present in `muse 0.2.0rc15`** (2026-07-03). This is an unfixed upstream bug, first
  reported 2026-05-20 against `rc7`. RC14/RC15 did **not** change it either way.
- **Confirmed real-world cause of two Knowtation incidents** (2026-05-20 and ~2026-07-02): the raw
  command `muse bridge git-export --git-dir . --git-branch muse-mirror --git-remote origin --force-push`
  was run by hand against the dev tree, bypassing the safe wrapper.

### Do this instead — always

```bash
# The ONLY approved way to mirror Muse → GitHub. Exports into an isolated .muse/mirror checkout,
# runs dev-tree sentinels, and opens/updates the muse-mirror PR.
./scripts/muse-bridge-deploy.sh "mirror: <brief description>"
```

**Never** run `muse bridge git-export --git-dir .` or `muse bridge git-import .` from a working tree.

### Verified-safe operations (do NOT delete ignored files under rc15)

- `muse checkout <branch>` / `muse checkout -b <branch>` (branch switching, both directions)
- `muse code add .` / `muse commit`
- The isolated bridge in `scripts/muse-bridge-deploy.sh` (proven by `scripts/test-muse-bridge-safety.sh`)

---

## 2. Volatile `.muse/` files dirty git and block checkouts

Muse rewrites its own bookkeeping files (`.muse/HEAD`, `.muse/config.toml`, `.muse/symlogs/**`,
`.muse/logs/**`) on every `muse checkout`/`muse commit`. Because those files were committed into git
before the `.gitignore` rules existed, git sees them as perpetually "modified", which **blocks
`git checkout`** and creates noise that has led to botched reconciliations.

**Fix (per clone, local-only, reversible with `--no-skip-worktree`):**

```bash
git ls-files .muse/ | grep -Ev '^\.muse/harmony/' \
  | while IFS= read -r f; do git update-index --skip-worktree "$f"; done
```

`scripts/muse-local-setup.sh` runs this for you (and verifies secret protection). Run it once on any
fresh clone.

> A permanent fix would untrack these from Muse's own snapshot (the bridge exports them today), but
> that touches Muse self-tracking and needs verified Muse-internals analysis first — **deferred**.

---

## 3. Optional machine-wide guard against the dangerous command

Add to `~/.zshrc` so the destructive form is refused in **every** repo, regardless of who types it:

```bash
muse() {
  if [[ "$1 $2" == "bridge git-export" || "$1 $2" == "bridge git-import" ]]; then
    for a in "$@"; do
      if [[ "$a" == "." || "$a" == "$PWD" ]]; then
        echo "BLOCKED: 'muse $1 $2 --git-dir .' deletes ignored files (.env, config/local.yaml)." >&2
        echo "Use ./scripts/muse-bridge-deploy.sh instead." >&2
        return 1
      fi
    done
  fi
  command muse "$@"
}
```

---

## 4. Local git `main` is only a mirror checkout

Muse `main` is truth; `origin/main` is its audit mirror; **local git `main` is disposable**. After any
merge, reconcile before branching new work so feature branches start from canonical:

```bash
git fetch origin && git checkout main && git reset --hard origin/main
```

Never commit directly to local git `main` — that is what creates divergence. GitHub branch protection
(required checks on `main`) is enabled to backstop this.

---

## 5. Recovery if ignored files were already deleted

Stop; do not run the bridge again from the dev tree. Recreate `.env` from `.env.example`, restore
`config/local.yaml` and `data/` from a **private backup** (never paste secrets into chat/issues/docs),
then run `./scripts/test-muse-bridge-safety.sh` and use only `./scripts/muse-bridge-deploy.sh`.

---

## Related

- Upstream issue for permanent fix: `docs/musehub-issues/2026-07-03-bridge-deletes-ignored-files-rc15-refile.md`
- Workflow runbook: `MUSE-BRIDGE-WORKFLOW.md`
- Safe deploy script: `scripts/muse-bridge-deploy.sh`; setup: `scripts/muse-local-setup.sh`; safety test: `scripts/test-muse-bridge-safety.sh`
