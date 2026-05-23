---
date: 2026-05-20
status: file-attempted-auth-blocked
issue_number: TBD
repo: gabriel/musehub
url: TBD
title: muse bridge git-export deletes ignored local files when exporting into an existing working tree
labels: [bug, bridge, data-loss, security]
patch_status: proposal-drafted
event_type: discover
tags: [contributions, musehub, bug-report, bridge, git-export, data-loss]
related: [issue-38, issue-39]
---

# Issue XX — `muse bridge git-export` deletes ignored local files

Filed: TBD
Repo: gabriel/musehub
URL: TBD

Discovered while dogfooding the Muse to GitHub bridge for `aaronrene/knowtation`. The local workflow used the documented bridge shape:

```bash
muse bridge git-export \
  --git-dir . \
  --git-branch muse-mirror \
  --git-remote origin \
  --force-push
```

That command deleted local ignored files including `.env` and `config/local.yaml`. The files were not restored because `.museignore` correctly excludes secrets and local data from the Muse snapshot.

## Filing attempt

Attempted to file via:

```bash
muse hub issue create \
  --repo gabriel/musehub \
  --title 'muse bridge git-export deletes ignored local files when exporting into an existing working tree' \
  --body-file /tmp/knowtation-musehub-bridge-delete-ignored-issue.md \
  --label bug \
  --label bridge \
  --label data-loss \
  --label security \
  --json
```

MuseHub returned:

```text
MuseHub API error 401: No registered keys for identity.
```

The web UI at `https://staging.musehub.ai/gabriel/musehub/issues/new` states that issues are filed from the Muse CLI or MCP interface, so the issue body below is ready to submit once the account/key registration problem is fixed.

## Issue body to file

# `muse bridge git-export` deletes ignored local files when exporting into an existing working tree

**Affected component:** `muse/cli/commands/bridge.py::GitExporter.sync_to_git`
**Affected versions:** verified in local `muse 0.2.0rc7` install as of 2026-05-20
**Severity:** Critical — local data loss and secret-management risk
**Reporter:** @aaronrene
**Patch proposal included:** Yes
**Related:** Issue #38 (`git-export` executable-bit stripping), Issue #39 (`muse clone gabriel/muse` blocks normal merge-proposal contribution path)

## Plain-language summary

`muse bridge git-export` currently treats the target git directory as fully disposable. Before it writes the Muse snapshot, it walks the whole target directory and deletes files that are not protected by a small hardcoded exclude list or a caller-supplied `--exclude` pattern.

If a user points `--git-dir` at their normal project checkout, the bridge can delete local ignored files such as `.env`, `config/local.yaml`, local databases, generated indexes, and private data. These are exactly the files that should never be stored in Muse or Git. After deletion, they are not restored because the Muse snapshot intentionally does not contain them.

The bridge should not delete files it does not own by default.

## Technical summary

The installed bridge implementation uses delete-and-replace semantics in `GitExporter.sync_to_git()`:

```python
for p in sorted(git_dir.rglob("*")):
    if not p.is_file():
        continue
    rel = p.relative_to(git_dir).as_posix()
    if _should_skip(rel):
        continue
    p.unlink()
```

`_should_skip()` checks:

- `.git/`
- optional `.muse/` stripping
- caller-supplied `--exclude` patterns
- `_DEFAULT_EXCLUDE_PREFIXES` / `_DEFAULT_EXCLUDE_SUFFIXES`

It does not check:

- `git ls-files`
- `git check-ignore`
- `.gitignore`
- `.museignore`
- a previous bridge export manifest

That means ignored local files are deleted unless users know to pass every sensitive local path through `--exclude`. This is unsafe as a default because the most important local files are the ones users intentionally ignore.

## Reproducer

```bash
set -euo pipefail

tmp=$(mktemp -d)
src="$tmp/src"
mkdir -p "$src/config" "$src/data"
cd "$src"

git init -q
git config user.email "bridge-repro@example.invalid"
git config user.name "Bridge Repro"

muse init --domain code

cat > .gitignore <<'EOF'
.muse/
.env
config/local.yaml
data/
*.sqlite
EOF

cat > .museignore <<'EOF'
[global]
patterns = [
  ".env",
  "config/local.yaml",
  "data/",
  "*.sqlite",
]

[domain.code]
patterns = []
EOF

cat > README.md <<'EOF'
# bridge deletion repro
EOF

cat > .env <<'EOF'
SENTINEL_ONLY=do-not-delete
EOF

cat > config/local.yaml <<'EOF'
sentinel: do-not-delete
EOF

cat > data/local.sqlite <<'EOF'
sentinel-only
EOF

muse code add README.md .gitignore .museignore
muse commit -m "seed bridge repro"

muse bridge git-export --git-dir . --git-branch muse-mirror --git-remote origin --no-push

test -f .env                 # currently fails
test -f config/local.yaml    # currently fails
test -f data/local.sqlite    # currently fails
```

## Real-world impact

This happened twice while dogfooding `aaronrene/knowtation`. The repo uses `.env`, `config/local.yaml`, and `data/` for local secrets, provider keys, indexes, and runtime state. These paths are correctly ignored by Git and Muse:

```toml
"config/local.yaml",
"config/*-local.*",
".env",
".env.*",
"data/",
"*.db",
"*.sqlite",
```

Because the bridge used `--git-dir .`, the destructive delete loop removed those files from the development checkout. This is a data-loss bug and a security bug: the user's safest habit, keeping secrets out of source control, increases the chance those files are not restored after bridge deletion.

## Proposed behavior

Default behavior:

1. The bridge may overwrite files it writes from the current Muse snapshot.
2. The bridge may delete files it wrote during a previous bridge export and that no longer exist in the current Muse snapshot.
3. The bridge must not delete ignored or untracked local files by default.
4. Exact destructive mirror behavior is still available only when the user passes an explicit opt-in such as `--allow-delete-ignored`.

## Proposed patch

The patch has two safety layers.

### Layer 1 — Delete only bridge-owned paths

Persist the previous export manifest as bridge-owned state. The manifest can live in `.muse/git-bridge.toml` or in a sidecar such as `.muse/git-bridge-export-manifest.json`. On each export:

- `owned_before = previous_export_manifest`
- `owned_now = current_snapshot_manifest`
- delete candidates are only `owned_before - owned_now`
- write/overwrite candidates are `owned_now`

This prevents the bridge from deleting arbitrary files that happen to be inside `--git-dir`.

### Layer 2 — Respect ignore rules before unlinking

Before deleting any path, ask Git whether it is ignored and check Muse ignore patterns. If ignored, skip deletion unless `--allow-delete-ignored` was explicitly passed.

Use batched `git check-ignore --stdin` rather than spawning one Git process per file.

### Sketch diff

```diff
diff --git a/muse/cli/commands/bridge.py b/muse/cli/commands/bridge.py
--- a/muse/cli/commands/bridge.py
+++ b/muse/cli/commands/bridge.py
@@
-    def sync_to_git(
-        self,
-        manifest: dict[str, str],
-        excludes: list[str],
-        strip_muse: bool,
-        fix_modes: bool,
-    ) -> int:
-        """Delete all existing files in ``git_dir`` then write every file from *manifest*."""
+    def sync_to_git(
+        self,
+        manifest: dict[str, str],
+        excludes: list[str],
+        strip_muse: bool,
+        fix_modes: bool,
+        previous_export_manifest: set[str] | None = None,
+        allow_delete_ignored: bool = False,
+    ) -> int:
+        """Synchronise bridge-owned files into ``git_dir``.
+
+        By default, deletion is limited to files written by a previous bridge
+        export. Ignored local files are never deleted unless
+        ``allow_delete_ignored`` is explicitly true.
+        """
@@
-        # 1. Delete existing tracked files (skip .git/ and excluded paths)
-        for p in sorted(git_dir.rglob("*")):
-            if not p.is_file():
-                continue
-            rel = p.relative_to(git_dir).as_posix()
-            if _should_skip(rel):
-                continue
-            p.unlink()
+        previous_paths = set(previous_export_manifest or [])
+        current_paths = set(manifest)
+        delete_candidates = previous_paths - current_paths
+        ignored_paths = _git_check_ignored(git_dir, delete_candidates)
+
+        for rel in sorted(delete_candidates):
+            if _should_skip(rel):
+                continue
+            if rel in ignored_paths and not allow_delete_ignored:
+                continue
+            p = git_dir / rel
+            if not p.exists() or not p.is_file():
+                continue
+            _assert_inside_git_dir(git_dir, p)
+            p.unlink()
@@
         if fix_modes:
             self.fix_file_modes(manifest)
 
         return files_written
+
+def _git_check_ignored(git_dir: pathlib.Path, paths: Iterable[str]) -> set[str]:
+    """Return repo-relative paths ignored by Git, using one batched process."""
+    path_list = sorted(set(paths))
+    if not path_list:
+        return set()
+    proc = subprocess.run(
+        ["git", "-C", str(git_dir), "check-ignore", "--stdin"],
+        input="\n".join(path_list) + "\n",
+        text=True,
+        capture_output=True,
+        check=False,
+    )
+    if proc.returncode not in (0, 1):
+        return set()
+    return {line.strip() for line in proc.stdout.splitlines() if line.strip()}
@@
     p.add_argument(
+        "--allow-delete-ignored",
+        action="store_true",
+        default=False,
+        help="Allow git-export to delete gitignored files in --git-dir. Dangerous; intended only for disposable exact mirror directories.",
+    )
```

The concrete merge proposal should wire `previous_export_manifest` through bridge state read/write. If the previous manifest is absent, the safe migration behavior is to delete nothing except files that are overwritten by the current manifest. That avoids a first-run surprise for existing users.

## 7-tier upstream test suite

New upstream file: `tests/cli/commands/test_bridge_protects_ignored.py`

```python
"""Tests for safe deletion behavior in muse bridge git-export.

Coverage tiers:
1. unit
2. integration
3. end-to-end
4. stress
5. data-integrity
6. performance
7. security
"""

from __future__ import annotations

import os
import stat
import subprocess
import time
from pathlib import Path

import pytest


def run(cmd: list[str], cwd: Path, **kwargs) -> subprocess.CompletedProcess[str]:
    return subprocess.run(cmd, cwd=cwd, text=True, capture_output=True, check=True, **kwargs)


def init_git(path: Path) -> None:
    run(["git", "init", "-q"], path)
    run(["git", "config", "user.email", "bridge-test@example.invalid"], path)
    run(["git", "config", "user.name", "Bridge Test"], path)


def test_unit_git_check_ignored_batches_paths(tmp_path: Path) -> None:
    init_git(tmp_path)
    (tmp_path / ".gitignore").write_text(".env\nconfig/local.yaml\ndata/\n", encoding="utf-8")
    run(["git", "add", ".gitignore"], tmp_path)
    run(["git", "commit", "-m", "ignore rules"], tmp_path)

    from muse.cli.commands.bridge import _git_check_ignored

    ignored = _git_check_ignored(tmp_path, [".env", "config/local.yaml", "README.md"])
    assert ignored == {".env", "config/local.yaml"}


def test_integration_ignored_env_survives_sync(tmp_path: Path) -> None:
    git_dir = tmp_path / "git"
    git_dir.mkdir()
    init_git(git_dir)
    (git_dir / ".gitignore").write_text(".env\n", encoding="utf-8")
    (git_dir / ".env").write_text("SENTINEL=1\n", encoding="utf-8")
    (git_dir / "old.txt").write_text("old\n", encoding="utf-8")
    run(["git", "add", ".gitignore", "old.txt"], git_dir)
    run(["git", "commit", "-m", "seed"], git_dir)

    from muse.cli.commands.bridge import GitExporter

    exporter = GitExporter(root=tmp_path, git_dir=git_dir, git_branch="main", git_remote="origin")
    exporter.sync_to_git(
        manifest={"new.txt": "sha256:fake"},
        excludes=[],
        strip_muse=True,
        fix_modes=False,
        previous_export_manifest={"old.txt"},
        allow_delete_ignored=False,
    )
    assert (git_dir / ".env").exists()
    assert not (git_dir / "old.txt").exists()


def test_e2e_same_dir_export_preserves_ignored_local_files(tmp_path: Path) -> None:
    repo = tmp_path / "repo"
    repo.mkdir()
    init_git(repo)
    run(["muse", "init", "--domain", "code"], repo)
    (repo / ".gitignore").write_text(".muse/\n.env\nconfig/local.yaml\ndata/\n", encoding="utf-8")
    (repo / ".museignore").write_text(
        '[global]\npatterns = [".env", "config/local.yaml", "data/"]\n[domain.code]\npatterns = []\n',
        encoding="utf-8",
    )
    (repo / "config").mkdir()
    (repo / "data").mkdir()
    (repo / "README.md").write_text("# safe bridge\n", encoding="utf-8")
    (repo / ".env").write_text("SENTINEL=1\n", encoding="utf-8")
    (repo / "config" / "local.yaml").write_text("sentinel: 1\n", encoding="utf-8")
    (repo / "data" / "local.sqlite").write_text("sentinel\n", encoding="utf-8")
    run(["muse", "code", "add", "README.md", ".gitignore", ".museignore"], repo)
    run(["muse", "commit", "-m", "seed"], repo)

    run(["muse", "bridge", "git-export", "--git-dir", ".", "--git-branch", "muse-mirror", "--no-push"], repo)

    assert (repo / ".env").exists()
    assert (repo / "config" / "local.yaml").exists()
    assert (repo / "data" / "local.sqlite").exists()


def test_stress_ignored_files_survive_large_tree(tmp_path: Path) -> None:
    init_git(tmp_path)
    (tmp_path / ".gitignore").write_text("ignored/\n", encoding="utf-8")
    ignored_dir = tmp_path / "ignored"
    ignored_dir.mkdir()
    for i in range(500):
        (ignored_dir / f"secret-{i}.txt").write_text("sentinel\n", encoding="utf-8")
    previous = {f"old-{i}.txt" for i in range(5000)}
    for rel in previous:
        (tmp_path / rel).write_text("old\n", encoding="utf-8")

    from muse.cli.commands.bridge import GitExporter

    exporter = GitExporter(root=tmp_path, git_dir=tmp_path, git_branch="main", git_remote="origin")
    start = time.perf_counter()
    exporter.sync_to_git(
        manifest={},
        excludes=[],
        strip_muse=True,
        fix_modes=False,
        previous_export_manifest=previous,
        allow_delete_ignored=False,
    )
    elapsed = time.perf_counter() - start

    assert all((ignored_dir / f"secret-{i}.txt").exists() for i in range(500))
    assert elapsed < 5


def test_data_integrity_previous_manifest_round_trips(tmp_path: Path) -> None:
    from muse.cli.commands.bridge import read_bridge_state, write_bridge_state

    state = {"last_export": {"export_manifest": ["README.md", "scripts/run.sh"]}}
    write_bridge_state(tmp_path, state)
    loaded = read_bridge_state(tmp_path)
    assert loaded["last_export"]["export_manifest"] == ["README.md", "scripts/run.sh"]


def test_performance_check_ignore_single_process(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    calls = []

    def fake_run(*args, **kwargs):
        calls.append(args[0])
        return subprocess.CompletedProcess(args[0], 1, "", "")

    monkeypatch.setattr(subprocess, "run", fake_run)
    from muse.cli.commands.bridge import _git_check_ignored

    _git_check_ignored(tmp_path, [f"file-{i}.txt" for i in range(1000)])
    assert len(calls) == 1
    assert calls[0][:4] == ["git", "-C", str(tmp_path), "check-ignore"]


def test_security_path_traversal_and_symlink_are_not_deleted(tmp_path: Path) -> None:
    init_git(tmp_path)
    outside = tmp_path.parent / "outside-secret.txt"
    outside.write_text("do not delete\n", encoding="utf-8")
    (tmp_path / "link").symlink_to(outside)

    from muse.cli.commands.bridge import GitExporter

    exporter = GitExporter(root=tmp_path, git_dir=tmp_path, git_branch="main", git_remote="origin")
    exporter.sync_to_git(
        manifest={},
        excludes=[],
        strip_muse=True,
        fix_modes=False,
        previous_export_manifest={"../outside-secret.txt", "link"},
        allow_delete_ignored=True,
    )
    assert outside.exists()
```

## Docs proposal

Add a Muse docs section titled **Safe Git bridge workflow**:

````md
## Safe Git bridge workflow

`muse bridge git-export` writes a Muse snapshot into a Git repository. For GitHub deployment workflows, use a permanent mirror branch and a dedicated mirror checkout.

Recommended branch:

- `muse-mirror` (the CLI default)

Recommended local checkout:

- `.muse/mirror/` for a project-local disposable checkout, or
- `~/.local/share/muse-bridge/<repo>/` for shared automation hosts.

Example:

```bash
git clone --single-branch --branch muse-mirror <git-remote-url> .muse/mirror
muse bridge git-export \
  --git-dir .muse/mirror \
  --git-branch muse-mirror \
  --git-remote origin \
  --force-push
```

Do not point `--git-dir` at a development checkout unless you understand the deletion model. Current and future bridge versions preserve ignored local files by default, but a dedicated mirror checkout keeps deployment state separate from private local state.
````

## Migration and compatibility

- Existing users with disposable mirror directories keep the same workflow.
- Existing users with `--git-dir .` stop losing local ignored files after the patch.
- First patched run with no previous export manifest should delete nothing except paths overwritten by the current snapshot.
- Users who require exact destructive mirror behavior can opt in with `--allow-delete-ignored`.

## Local mitigation already applied to Knowtation

Knowtation now exports into `.muse/mirror/` through `scripts/muse-bridge-deploy.sh`. The smoke test `scripts/test-muse-bridge-safety.sh` passed locally on 2026-05-20:

```text
PASS: Muse bridge safety smoke test preserved local ignored files and executable mode.
```
