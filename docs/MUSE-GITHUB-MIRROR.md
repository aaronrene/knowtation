# MuseHub → GitHub mirror (transition bridge)

This repository treats **MuseHub as the canonical version control**. GitHub exists as a **one-way mirror** so existing integrations (Netlify, GitHub Actions, Dependabot-style workflows, collaborators who still use Git) keep working until you retire them.

## Rules

1. **Commit and push only with Muse** to MuseHub for product work (`muse commit`, `muse push`).
2. **Do not push “real” product commits directly to the mirror branch on GitHub.** If someone does, treat the branch as **drifted** until you reset it from Muse (see [Rollback / resync](#rollback--resync)).
3. **Mirror commits** are automation-only: message prefix `mirror: muse <64-hex-commit-id>` so you can audit what Muse revision Netlify built.

## What runs where

| Location | Role |
|----------|------|
| Your machine | Day-to-day edits; `muse` to MuseHub |
| [scripts/muse-export-to-git.sh](../scripts/muse-export-to-git.sh) | Optional local export: Muse snapshot → Git working tree → `git push` |
| [.github/workflows/muse-mirror-to-github.yml](../.github/workflows/muse-mirror-to-github.yml) | CI: clone from MuseHub, export, push to a Git branch |

## Authentication (Muse CLI 0.2.x)

The Muse CLI uses **signing identities** (Ed25519), not a raw JWT in `identity.toml` for wire calls. For **GitHub Actions**, store a PEM private key and handle as repository secrets and map them to environment variables the CLI already supports:

| Secret | Purpose |
|--------|---------|
| `MUSE_AGENT_KEY` | PEM text of the agent (or human) private key used to sign Muse wire requests |
| `MUSE_AGENT_HANDLE` | Handle string associated with that key on the hub |

Generate keys and register with your hub using the Muse CLI on a trusted machine (`muse auth keygen`, `muse auth register` — see Muse docs for your version). **Never** commit PEMs or JWTs into the repo.

## Bootstrap (first time)

GitHub only runs workflows that exist on the **default branch** (usually `main`). To use Actions the first time:

1. Land this workflow and doc on GitHub **once** via whatever path you still use for Git (e.g. merge from an existing `main`, or copy the files into the Git repo and push `main`).
2. Add repository secrets `MUSE_AGENT_KEY` and `MUSE_AGENT_HANDLE`.
3. Run **Actions → Muse mirror to GitHub → Run workflow** with defaults (or adjust inputs).

After that, routine updates can flow **Muse → MuseHub → workflow → Git mirror branch** without touching `main` on GitHub by hand.

## GitHub Actions inputs

Workflow [muse-mirror-to-github.yml](../.github/workflows/muse-mirror-to-github.yml) is triggered manually (`workflow_dispatch`) with:

| Input | Default | Meaning |
|-------|---------|---------|
| `muse_clone_url` | `https://staging.musehub.ai/aaronrene/knowtation` | Full MuseHub repo URL passed to `muse clone` |
| `muse_ref` | `main` | Branch checked out after clone (archive uses that branch tip) |
| `git_mirror_branch` | `chore/muse-mirror` | Branch in the **GitHub** repo receiving the mirror commit |

Adjust defaults when you fork or change owner/slug.

## Netlify / 4Everland verification checklist

Complete these once the workflow has run at least once on `workflow_dispatch`:

1. **Netlify**
   - In the Netlify site, open **Site configuration → Build & deploy → Continuous deployment → Branches and deploy contexts**.
   - Either keep production tied to `main` and add a **Deploy Preview** or **branch deploy** for `chore/muse-mirror`, **or** temporarily set the production branch to `chore/muse-mirror` for a smoke test, then switch back.
   - Run **Trigger deploy → Deploy site** on the branch that received the mirror commit.
   - Confirm the deploy log shows a commit whose message starts with `mirror: muse `.

2. **4Everland (or other static host)**
   - If deployment is manual or from a Git-connected build, point it at the same mirror branch you used above, upload the artifact, or run your existing CLI — whichever matches your existing deployment documentation for that host.

3. **After verification**
   - Decide the long-term mapping: e.g. production stays on `main` and a scheduled or manual workflow **merges** `chore/muse-mirror` into `main` via PR, **or** Netlify builds `chore/muse-mirror` directly. Document that decision for the team.

## Rollback / resync

If GitHub `main` (or the mirror branch) contains commits not derived from Muse:

1. Reset the Git branch to the last good `mirror: muse …` commit, **or**
2. Delete the branch and recreate it from an empty tree, then re-run the mirror workflow, **or**
3. Force-push after regenerating from Muse (coordinate with anyone else using that branch).

MuseHub history is unaffected; you are only fixing the Git **mirror**.

## Limitations

- Each mirror push is a **new Git commit** over the previous tree; Git history will **not** match Muse’s DAG one-to-one.
- Paths and secrets: ensure `.museignore` / deploy ignores keep secrets out of both Muse snapshots and the Git mirror (same as today).

## See also

- [MUSE-UPSTREAM-BRIDGE-ISSUE.md](MUSE-UPSTREAM-BRIDGE-ISSUE.md) — draft text for proposing a first-class `muse` porcelain command upstream.
