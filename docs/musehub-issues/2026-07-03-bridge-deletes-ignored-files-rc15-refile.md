---
date: 2026-07-03
status: ready-to-file
issue_number: TBD
repo: gabriel/musehub
url: TBD
title: "[RE-FILE] muse bridge git-export/import deletes ignored local files (.env, config/local.yaml) — still present in 0.2.0rc15"
labels: [bug, bridge, data-loss, security]
patch_status: proposal-drafted
event_type: rediscover
supersedes: docs/musehub-issues/2026-05-20-issue-XX-bridge-deletes-ignored-files.md
tags: [musehub, bug-report, bridge, git-export, git-import, data-loss, rc15]
---

# [RE-FILE] `muse bridge` deletes ignored local files — still present in `0.2.0rc15`

This re-files the 2026-05-20 report
(`docs/musehub-issues/2026-05-20-issue-XX-bridge-deletes-ignored-files.md`), which could not be
submitted upstream (`MuseHub API error 401: No registered keys for identity`). **The full root-cause
analysis, proposed two-layer patch, sketch diff, and 7-tier upstream test suite live in that original
document — this file adds fresh confirmation and the re-file instructions.**

## Why re-file now

A **second production incident** occurred (~2026-07-02, `aaronrene/knowtation`): `.env` and
`config/local.yaml` were deleted again and had to be recreated from backup. Investigation on
2026-07-03 confirmed the upstream bug is **unchanged through `muse 0.2.0rc15`** and that RC14/RC15
neither introduced nor fixed it.

## Evidence gathered 2026-07-03 (Muse `0.2.0rc15`)

| Test | Result | Meaning |
| --- | --- | --- |
| `scripts/test-muse-bridge-safety.sh` (isolated `--git-dir .muse/mirror` + `--exclude`) | **PASS** | The safe wrapper still protects ignored files under rc15. |
| `muse checkout` / `checkout -b` / `code add .` against ignored `.env`, `config/local.yaml` (throwaway repo) | **files SURVIVED** | Everyday commands are safe; they are **not** the deleter. |
| Shell history | contains `muse bridge git-export --git-dir . --git-branch muse-mirror --git-remote origin --force-push` | The destructive raw form was run by hand against the dev tree. |
| `.env` / `config/local.yaml` mtime | recreated `2026-07-02 16:20` | Confirms the recent deletion + manual recovery. |

**Conclusion (verified fact, not inference):** the deletions are caused solely by running
`muse bridge git-export` (or `git-import`) with `--git-dir` pointed at a working tree. Muse's
`GitExporter.sync_to_git` deletes every file under the target that is not on a hardcoded/`--exclude`
list, **without consulting `git check-ignore`, `.gitignore`, or `.museignore`**. Ignored secrets are
therefore deleted and are unrecoverable (they were never in the snapshot).

## Reproduction (throwaway repo — safe)

```bash
tmp=$(mktemp -d); cd "$tmp"; git init -q
muse init --domain code
printf '.muse/\n.env\nconfig/local.yaml\n' > .gitignore
printf '[global]\npatterns=[".env","config/local.yaml"]\n[domain.code]\npatterns=[]\n' > .museignore
mkdir config; echo v1 > tracked.txt
muse code add tracked.txt .gitignore .museignore; muse commit -m seed
git checkout -b muse-mirror -q; git commit --allow-empty -qm seed; git checkout -q main || git checkout -qb main
echo 'SECRET=keep' > .env; echo 'x: keep' > config/local.yaml
muse bridge git-export --git-dir . --git-branch muse-mirror --git-remote origin --no-push
ls .env config/local.yaml   # EXPECTED (post-fix): both still exist. ACTUAL (rc15): both deleted.
```

## Requested fix (see original doc for full patch + tests)

1. **Delete only bridge-owned paths** — persist the previous export manifest; delete candidates are
   `owned_before − owned_now`, never arbitrary files inside `--git-dir`.
2. **Respect ignore rules before unlinking** — batched `git check-ignore --stdin` (and `.museignore`);
   skip ignored paths unless the caller passes an explicit `--allow-delete-ignored`.
3. Ship the 7-tier test `tests/cli/commands/test_bridge_protects_ignored.py` from the original draft.

**Severity:** Critical — silent local data loss + secret-management risk. **Affected:**
`muse/cli/commands/bridge.py::GitExporter.sync_to_git`. **Verified in:** `0.2.0rc7` (original) and
`0.2.0rc15` (this re-file).

## How to file (once identity/key registration is fixed)

```bash
muse hub issue create \
  --repo gabriel/musehub \
  --title 'muse bridge git-export/import deletes ignored local files (.env, config/local.yaml) — still present in 0.2.0rc15' \
  --body-file docs/musehub-issues/2026-07-03-bridge-deletes-ignored-files-rc15-refile.md \
  --label bug --label bridge --label data-loss --label security \
  --json
```

If the `401: No registered keys for identity` block persists, register the CLI signing key for the
account first (`muse auth` / key registration), then retry. Until filed upstream, the local guardrails
(`scripts/muse-bridge-deploy.sh`, `scripts/muse-local-setup.sh`, the `~/.zshrc` guard, and branch
protection) are the mitigation — see the vault note `areas/muse-ops/muse-local-hygiene.md`.
