# Muse to GitHub Bridge Workflow

**Status:** Safe local workflow active as of 2026-05-20.

## Plain Summary

All product work lives in MuseHub. When the code is ready to deploy, run one bridge command through the safe deploy script. The script exports Muse into an isolated mirror checkout under `.muse/mirror/`, pushes the permanent `muse-mirror` branch to GitHub, and opens or updates the GitHub PR to `main`.

Never run `muse bridge git-export --git-dir .` from the development checkout. The installed bridge deletes files in the target directory before rewriting the Muse snapshot. If the target is the development checkout, local ignored files such as `.env`, `config/local.yaml`, and `data/` can be deleted.

## Technical Summary

The bridge target is now a disposable git checkout at `.muse/mirror/`, not the development tree. The destructive `GitExporter.sync_to_git()` delete-and-replace loop can only touch files inside that isolated checkout. The GitHub branch remains `muse-mirror`; only the local `--git-dir` changed.

## Flow

```text
MuseHub staging repo
  -> Muse main branch
  -> scripts/muse-bridge-deploy.sh
  -> .muse/mirror/ local mirror checkout
  -> GitHub origin/muse-mirror
  -> GitHub PR muse-mirror to main
  -> Netlify deploy from main
```

## Day-to-Day Steps

### Directly on Muse main

```bash
cd ~/knowtation

muse code add <files>
muse commit -m "your message"
muse push staging main

./scripts/muse-bridge-deploy.sh "mirror: brief description"
```

### From a Muse feature branch

```bash
cd ~/knowtation

muse code branch feat/my-feature
muse code checkout feat/my-feature
muse code add <files>
muse commit -m "feat: my feature"
muse push staging feat/my-feature

muse hub proposal create \
  --branch feat/my-feature \
  --target main \
  --title "feat: my feature" \
  --repo aaronrene/knowtation
```

After the Muse proposal is merged into Muse main:

```bash
./scripts/muse-bridge-deploy.sh "mirror: feat my feature"
```

## Why This Is Safe

- `.muse/mirror/` is ignored by Git and Muse, so it is local bridge state only.
- `.env`, `config/local.yaml`, and `data/` stay in the development checkout, outside the bridge target.
- The deploy script creates non-secret sentinel files before export and fails if any sentinel disappears.
- The deploy script uses extra `--exclude` rules as defense in depth.
- The script intentionally avoids a broad `--exclude '.env.*'` because this bridge version would also skip `.env.example`.

## Rules

- **Never run `muse bridge git-export --git-dir .` in this repo.**
- **Never commit or push directly to GitHub `main`.** Work goes through Muse, then the bridge PR.
- **`muse-mirror` is permanent.** Do not delete it and do not hand-edit it.
- **Always merge to Muse main before bridging.** Feature branches are reviewed and merged in Muse first.
- **Never commit `.env`, `config/local.yaml`, `data/`, private keys, tokens, or local databases.**

## Security Hygiene

The deploy script runs `npm audit fix` and blocks the bridge if high or critical Node vulnerabilities remain. It may create a Muse commit for audit-generated package changes before exporting.

GitHub Secret Scanning and push protection are enabled, but the primary protection is still local discipline: use environment variables and ignored local config files for secrets. Do not hard-code credentials, private keys, IP allowlists, or provider tokens in source files.

## Useful Commands

```bash
# Verify the mirror checkout exists and is on the mirror branch.
git -C .muse/mirror status --short --branch

# Recreate the isolated mirror checkout if it is ever corrupted.
rm -rf .muse/mirror
git clone --single-branch --branch muse-mirror \
  https://github.com/aaronrene/knowtation.git .muse/mirror

# Check bridge state without printing secret files.
python3 - <<'PY'
from pathlib import Path
print(Path(".muse/git-bridge.toml").read_text())
PY

# Check executable bits on the mirror branch.
git fetch origin muse-mirror
git ls-tree origin/muse-mirror -- deploy/paperclip/install.sh

# Run the safety smoke test.
./scripts/test-muse-bridge-safety.sh
```

## If `--git-dir .` Deleted Local Files

Stop and do not run the bridge again from the development checkout. Recreate `.env` from `.env.example`, recreate `config/local.yaml` from your private backup or settings notes, and restore `data/` from your local backup if needed. Do not recover secrets by pasting them into chat, issues, or docs.

After recovery, run:

```bash
./scripts/test-muse-bridge-safety.sh
```

Then use only:

```bash
./scripts/muse-bridge-deploy.sh "mirror: brief description"
```

## Upstream Follow-Up

The local workflow is safe, but the permanent fix belongs in Muse itself. The bridge should not delete ignored or untracked local files by default. The upstream proposal is:

- Delete only files the previous bridge export wrote.
- Respect `git check-ignore` and `.museignore` before any deletion.
- Add an explicit destructive opt-in flag for exact disposable mirrors.
- Document the permanent `muse-mirror` branch plus isolated mirror checkout workflow for developers who use MuseHub and GitHub together.
