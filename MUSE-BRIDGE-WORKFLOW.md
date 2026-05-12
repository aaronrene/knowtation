# Muse → GitHub Bridge Workflow

**Status:** Live and tested as of 2026-05-12.

---

## The idea in one sentence

All development happens on MuseHub. When ready to deploy, one command bridges Muse to GitHub, and one GitHub merge triggers Netlify.

---

## The flow

```
MuseHub (staging.musehub.ai/aaronrene/knowtation)
  └── Muse main branch  ← all real development lives here
          │
          │  one command (muse bridge git-export)
          ▼
GitHub: muse-mirror branch  ← permanent, always overwritten, never commit here directly
          │
          │  GitHub PR: muse-mirror → main  (you merge this)
          ▼
GitHub: main → Netlify → live site
```

---

## Security hygiene (run before every bridge)

```bash
# In ~/knowtation — check for Node vulnerabilities and fix them
npm audit fix

# If high/critical remain after auto-fix, review manually:
npm audit --audit-level=high
```

GitHub Secret Scanning and push protection are enabled on this repo. Any accidental
credential commit will be blocked at push time.  **Never** hard-code API keys, tokens,
or passwords in source files — use env vars loaded from `config/local.yaml` (gitignored).

---

## Day-to-day steps

### If working directly on Muse main

```bash
# 0. Run security audit first
npm audit fix

# 1. Make changes, commit, push to MuseHub
cd ~/knowtation
muse code add <files>
muse commit -m "your message"
muse push staging main

# 2. Bridge to GitHub
muse bridge git-export \
  --git-dir . \
  --git-branch muse-mirror \
  --git-remote origin \
  --force-push

# 3. Open and merge the GitHub PR
gh pr create --base main --head muse-mirror --title "mirror: <brief description>"
# Then merge it in the GitHub UI (or gh pr merge)
# Netlify deploys automatically on merge.
```

### If working on a Muse feature branch (preferred for larger changes)

```bash
# 1. Create feature branch and do your work
muse code branch feat/my-feature
muse code checkout feat/my-feature
muse code add <files>
muse commit -m "feat: ..."
muse push staging feat/my-feature

# 2. Open a merge proposal on MuseHub and merge it into Muse main
#    Do this on staging.musehub.ai — open a proposal targeting main
#    OR via CLI:
muse hub proposal create \
  --branch feat/my-feature \
  --target main \
  --title "feat: my feature" \
  --repo aaronrene/knowtation

# 3. Once merged into Muse main, bridge to GitHub
muse bridge git-export \
  --git-dir . \
  --git-branch muse-mirror \
  --git-remote origin \
  --force-push

# 4. Open and merge the GitHub PR
gh pr create --base main --head muse-mirror --title "mirror: <brief description>"
# Netlify deploys automatically on merge.
```

---

## Rules

- **Never commit or push directly to GitHub.** Not to `main`, not to any branch. Everything goes through Muse.
- **`muse-mirror` is a permanent branch.** Never delete it, never commit to it manually. The bridge owns it.
- **Always merge to Muse main before bridging.** The bridge reads Muse `HEAD` (main). Feature branches are never bridged directly.
- **One bridge export per deploy.** Run bridge once when Muse main is in the state you want on the live site. Don't run it mid-feature-branch.

---

## Useful commands

```bash
# Check what Muse commits are not yet bridged
muse log --oneline   # see Muse history
git log --oneline origin/muse-mirror -5   # see what was last bridged

# Check exec bits on muse-mirror (should be 100755 for shell scripts)
git fetch origin muse-mirror
git ls-tree origin/muse-mirror -- deploy/paperclip/install.sh

# Check bridge state (last export details)
cat .muse/git-bridge.toml

# See open GitHub PRs
gh pr list
```

---

## When rc8 ships (exec-bit fix)

The `fix_file_modes` exec-bit fix from MuseHub issue #38 was applied manually
to the local rc7 venv (`~/.local/share/muse/venv`) on 2026-05-12.
When `0.2.0rc8` is officially available, run:

```bash
curl -fsSL https://staging.musehub.ai/install.sh | sh
muse --version   # confirm 0.2.0rc8
```

The manual patch will be replaced by the official release automatically.

---

## Why this architecture

- MuseHub gives signed commits, semantic diffs, merge proposals, and code intelligence over the vault.
- GitHub `main` is the Netlify deploy target — all environment variables (Stripe, AWS, etc.) are configured there.
- `muse-mirror` is the clean handoff point between the two systems.
- No Git commits ever happen in this repo except from the bridge. This keeps Git history clean and auditable.
