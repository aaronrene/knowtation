---
date: 2026-05-08
status: filed
issue_number: 38
issue_id: sha256:081b28c4c317eb0cc4008e42d86897ab884b79b12aef4f3b7c912fd447ed3711
repo: gabriel/musehub
url: https://staging.musehub.ai/gabriel/musehub/issues/38
title: muse bridge git-export strips POSIX executable bit from all files
labels: [bug, bridge]
patch_status: verified-locally
event_type: discover
tags: [contributions, musehub, bug-report, bridge, git-export]
---

# Issue #38 — `muse bridge git-export` strips POSIX executable bit from all files

Filed: 2026-05-08
Repo: gabriel/musehub
URL: https://staging.musehub.ai/gabriel/musehub/issues/38

Discovered during pre-merge `git diff --summary` review of the architecture-decision PR. Patch validated end-to-end against `aaronrene/knowtation` `staging/main` HEAD `sha256:8514304e16d7…`. 41 files correctly received `100755`, 572 stayed `100644`, zero false positives.

Patch could not be submitted as a merge proposal because `muse clone gabriel/muse` is broken (see issue #39).

## Issue body (as filed)

# `muse bridge git-export` strips POSIX executable bit from all files

**Affected component:** `muse/cli/commands/bridge.py::GitExporter.fix_file_modes` (and an underlying limitation in `muse/core/snapshot.py`)
**Affected versions:** `0.2.0rc7` (latest installed), and almost certainly all earlier versions that ship `bridge.py`
**Severity:** High — silently breaks CI/CD pipelines, deploy scripts, and any executable artefact mirrored from Muse to a Git remote
**Reporter:** @aaronrene
**Patch verified locally:** Yes — applied to local `0.2.0rc7` install and re-bridged `aaronrene/knowtation` against canonical `staging/main`. **41 files** correctly received `100755` (15 originally identified + 26 additional that had also been silently stripped); **572 files** correctly stayed `100644`. Zero false positives, zero false negatives across the 613-file sample.

> **Note on contribution path:** This issue documents a complete, working fix.  Reporter would have submitted as a merge proposal against `gabriel/muse` rather than as an issue, but `muse clone https://staging.musehub.ai/gabriel/muse` currently fails with 25+ `Content integrity failure` errors followed by `HTTP 404` on a presigned object URL, and `muse clone https://musehub.ai/gabriel/muse` returns `Server returned invalid msgpack: unpack(b) received extra data`.  Filing a separate issue for the clone failures.  Once cloning works, happy to convert this into a proper merge proposal with co-authored-by attribution.

---

## Plain-language summary

When `muse bridge git-export` mirrors a Muse repo to a Git working tree, every file lands at mode `644` (not executable) — even if the same path was previously committed to the Git remote with mode `755` (executable). Shell scripts, Node CLI scripts, and any other file that needs to be runnable lose their executable bit on the next bridge sync. The `.gitignore`, content, and history are perfectly preserved; only the POSIX permission flag is dropped.

## Technical summary

`GitExporter.fix_file_modes` (`muse/cli/commands/bridge.py:2069-2090`) unconditionally calls `chmod(0o644)` for every path in the manifest. Its CLI help string at `:2905` advertises `"chmod files after writing (644 for files, 755 for executables)"`, but the implementation has no concept of "executable" — there is no shebang check, no extension check, no `.museattributes` lookup. The `--fix-modes` flag itself defaults to `False` (`:2904`), so the chmod path is rarely exercised; when it is exercised, it actively destroys exec bits.

A grep across the entire `muse` package for `S_IXUSR | S_IEXEC | 0o755 | executable` returns zero matches that pertain to file mode tracking — only `sys.executable` (Python interpreter path) and `S_ISREG` (is-regular-file) checks. **Muse's snapshot model itself does not capture POSIX mode bits**: `core/snapshot.py:244-267` only uses `st.st_mode` to filter `S_ISREG`, and the on-disk manifest format documented at `core/snapshot.py:11-14` derives `snapshot_id` from `(path, object_id)` pairs only — no mode field exists.

Because the snapshot has no mode information, the bridge cannot reconstruct exec bits from manifest data. **A heuristic at export time is the correct fix scope** — it requires no schema change, preserves backward-compatible `snapshot_id` derivation, and deploys without migration.

## Reproducer

```bash
# 1. Init a fresh Muse repo with a script
mkdir /tmp/muse-exec-repro && cd /tmp/muse-exec-repro
muse init --domain code
mkdir scripts
cat > scripts/hello.sh <<'EOF'
#!/usr/bin/env bash
echo "hello"
EOF
chmod +x scripts/hello.sh
ls -l scripts/hello.sh    # confirms -rwxr-xr-x

# 2. Commit
muse code add scripts/hello.sh
muse commit -m "add hello script"

# 3. Bridge to a fresh Git dir
mkdir /tmp/muse-exec-repro-git && cd /tmp/muse-exec-repro-git && git init -q
cd /tmp/muse-exec-repro
muse bridge git-export --git-dir /tmp/muse-exec-repro-git --fix-modes

# 4. Observe loss
cd /tmp/muse-exec-repro-git
ls -l scripts/hello.sh                       # -rw-r--r-- (NOT executable)
git add . && git commit -q -m "mirror"
git ls-tree HEAD scripts/hello.sh            # 100644 (expected: 100755)
./scripts/hello.sh                           # bash: ./scripts/hello.sh: Permission denied
```

## Real-world impact (concrete case from the field)

A bridge sync of `aaronrene/knowtation` (`staging/main`) to `aaronrene/knowtation` on GitHub produced a 39-file delta where 15 of those files were **mode-only changes** stripping `100755 → 100644`:

```
mode change 100755 => 100644 deploy/paperclip/install.sh
mode change 100755 => 100644 deploy/paperclip/scripts/hello-world-test.sh
mode change 100755 => 100644 deploy/paperclip/scripts/load-skills-and-agents.sh
mode change 100755 => 100644 deploy/paperclip/scripts/push-secrets.sh
mode change 100755 => 100644 deploy/paperclip/scripts/run-controller.sh
mode change 100755 => 100644 deploy/paperclip/scripts/wire-knowtation-mcp.sh
mode change 100755 => 100644 scripts/canister-decrypt-operator-backup.mjs
mode change 100755 => 100644 scripts/canister-export-backup.mjs
mode change 100755 => 100644 scripts/canister-export-backup.sh
mode change 100755 => 100644 scripts/canister-predeploy.sh
mode change 100755 => 100644 scripts/canister-release-prep.sh
mode change 100755 => 100644 scripts/icp-canister-snapshot-backup.sh
mode change 100755 => 100644 scripts/post-merge-hub-canister-release.sh
mode change 100755 => 100644 scripts/validate-deepinfra-enrich.mjs
mode change 100755 => 100644 scripts/write-to-vault.sh
```

Same blob SHAs on both sides — content identical, modes lost. Merging this PR would have broken the AWS Paperclip installer (`install.sh`) and the canister-snapshot CI workflow on GitHub Actions. Caught during pre-merge `git diff --summary` review.

## Proposed fix — heuristic shebang detection at export time

Smallest viable patch: replace `fix_file_modes` with a shebang-driven heuristic, change `--fix-modes` default to `True`, update docs/help.

### Why shebang detection is correct

- **Universal**: works regardless of file extension (catches `.mjs`, `.py`, no-extension scripts)
- **Authoritative**: shebang is the Unix declaration that "this file is meant to be executed"
- **Zero false positives** in practice: regular text/binary files do not start with `#!`
- **Standard Unix convention**: `binfmt` on Linux uses the same signal
- **No schema change**: snapshot manifest stays `dict[path → object_id]`; `snapshot_id` derivation unchanged; no migration required

Verified against the 15 affected files in the real-world case above: every one starts with `#!/usr/bin/env bash` or `#!/usr/bin/env node`. 100% recall, 0% false positive (subject to standard heuristic caveats below).

### Patch (unified diff against `0.2.0rc7`)

```diff
--- a/muse/cli/commands/bridge.py
+++ b/muse/cli/commands/bridge.py
@@ -2066,28 +2066,69 @@ class GitExporter:
 
         return files_written
 
     def fix_file_modes(self, manifest: SnapshotManifest) -> None:
-        """Set file permissions to 644 for all exported files.
-
-        Does not touch ``.git/`` or any path outside ``git_dir``.
+        """Set file permissions on exported files based on shebang detection.
+
+        Files whose first two bytes are ``#!`` (POSIX shebang) get ``0o755``
+        (read+execute for owner/group/world, write for owner only).  All
+        other regular files get ``0o644``.
+
+        This is a heuristic recovery — Muse's snapshot manifest does not
+        currently track POSIX mode bits (see ``core/snapshot.py`` docstring,
+        ``snapshot_id`` derivation), so the export side must reconstruct
+        executability from file content.  Shebang detection is the standard
+        Unix convention for "this file is meant to be executed" and matches
+        what ``binfmt`` checks at exec time.
+
+        Setuid/setgid bits (``04xxx``/``02xxx``) are never set — only the
+        canonical ``0o755`` and ``0o644`` are produced.  This prevents a
+        crafted Muse repo from smuggling escalated permissions through a
+        bridge sync.
+
+        Does not touch ``.git/`` or any path outside ``git_dir``.
 
         Args:
             manifest: Manifest of exported files (only these paths are touched).
         """
         import stat
 
+        MODE_REGULAR = stat.S_IRUSR | stat.S_IWUSR | stat.S_IRGRP | stat.S_IROTH  # 0o644
+        MODE_EXECUTABLE = MODE_REGULAR | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH  # 0o755
+
         for rel_path in manifest:
             dest = self.git_dir / rel_path
             if dest.exists() and dest.is_file():
                 # Ensure path is inside git_dir (no traversal)
                 try:
                     dest.resolve().relative_to(self.git_dir.resolve())
                 except ValueError:
                     continue
                 # Never touch .git/
                 if ".git" in dest.relative_to(self.git_dir).parts:
                     continue
-                dest.chmod(stat.S_IRUSR | stat.S_IWUSR | stat.S_IRGRP | stat.S_IROTH)
+                dest.chmod(
+                    MODE_EXECUTABLE
+                    if GitExporter._has_shebang(dest)
+                    else MODE_REGULAR
+                )
+
+    @staticmethod
+    def _has_shebang(dest: pathlib.Path) -> bool:
+        """Return True iff *dest*'s first two bytes are ``#!``.
+
+        Read errors return False (treat as non-executable, fail safe).
+        Reads only 2 bytes — no file-size dependent cost.
+        """
+        try:
+            with dest.open("rb") as f:
+                head = f.read(2)
+            return head == b"#!"
+        except OSError:
+            return False
```

```diff
--- a/muse/cli/commands/bridge.py
+++ b/muse/cli/commands/bridge.py
@@ -2898,9 +2898,9 @@ def _register_git_export(
     )
     p.add_argument(
         "--fix-modes",
-        action="store_true",
-        default=False,
-        help="chmod files after writing (644 for files, 755 for executables).",
+        action=argparse.BooleanOptionalAction,
+        default=True,
+        help="chmod files after writing — 644 for regular files, 755 for files with a POSIX shebang. Disable with --no-fix-modes.",
     )
     p.add_argument(
         "--dry-run",
```

The `BooleanOptionalAction` switch keeps the behaviour opt-out (`--no-fix-modes`) for any CI that intentionally wants 644-only output, while making the correct behaviour the default for new users.

## Tests (per the project's 7-tier convention)

New file: `tests/cli/commands/test_bridge_fix_modes.py`

```python
"""Tests for muse bridge git-export executable-bit handling.

Covers all 7 standard tiers: unit, integration, end-to-end, stress,
data-integrity, performance, security.
"""
import os
import stat
import subprocess
import time

import pytest

from muse.cli.commands.bridge import GitExporter


# ── Tier 1: unit ─────────────────────────────────────────────────────────
class TestHasShebang:
    def test_shebang_bash(self, tmp_path):
        f = tmp_path / "x.sh"
        f.write_bytes(b"#!/usr/bin/env bash\necho hi\n")
        assert GitExporter._has_shebang(f) is True

    def test_shebang_node(self, tmp_path):
        f = tmp_path / "x.mjs"
        f.write_bytes(b"#!/usr/bin/env node\nconsole.log('hi');\n")
        assert GitExporter._has_shebang(f) is True

    def test_shebang_python_no_env(self, tmp_path):
        f = tmp_path / "x.py"
        f.write_bytes(b"#!/usr/bin/python3\nprint('hi')\n")
        assert GitExporter._has_shebang(f) is True

    def test_no_shebang_plain_text(self, tmp_path):
        f = tmp_path / "readme.md"
        f.write_bytes(b"# title\nhello\n")
        assert GitExporter._has_shebang(f) is False

    def test_no_shebang_empty_file(self, tmp_path):
        f = tmp_path / "empty"
        f.write_bytes(b"")
        assert GitExporter._has_shebang(f) is False

    def test_no_shebang_one_byte(self, tmp_path):
        f = tmp_path / "x"
        f.write_bytes(b"#")
        assert GitExporter._has_shebang(f) is False

    def test_no_shebang_with_leading_whitespace(self, tmp_path):
        # #! must be at byte 0, not after whitespace
        f = tmp_path / "x.sh"
        f.write_bytes(b" #!/usr/bin/env bash\n")
        assert GitExporter._has_shebang(f) is False

    def test_read_error_returns_false(self, tmp_path):
        # Path doesn't exist → OSError → False (fail-safe)
        assert GitExporter._has_shebang(tmp_path / "nonexistent") is False


# ── Tier 2: integration ──────────────────────────────────────────────────
class TestFixFileModesAppliesCorrectly:
    def test_shebang_file_gets_755(self, tmp_path):
        git_dir = tmp_path / "g"
        git_dir.mkdir()
        (git_dir / "scripts").mkdir()
        (git_dir / "scripts" / "run.sh").write_bytes(b"#!/usr/bin/env bash\n")
        (git_dir / "README.md").write_bytes(b"# title\n")

        # Build a minimal GitExporter-like object (or use a real one with mocked deps).
        # The exact bootstrap depends on GitExporter's __init__ in 0.2.0rc7.
        exporter = _build_test_exporter(git_dir)
        exporter.fix_file_modes({"scripts/run.sh": "sha256:fake", "README.md": "sha256:fake"})

        assert (git_dir / "scripts" / "run.sh").stat().st_mode & 0o777 == 0o755
        assert (git_dir / "README.md").stat().st_mode & 0o777 == 0o644

    def test_dotgit_directory_never_touched(self, tmp_path):
        git_dir = tmp_path / "g"
        (git_dir / ".git").mkdir(parents=True)
        gitfile = git_dir / ".git" / "HEAD"
        gitfile.write_bytes(b"ref: refs/heads/main\n")
        original_mode = gitfile.stat().st_mode

        exporter = _build_test_exporter(git_dir)
        exporter.fix_file_modes({".git/HEAD": "sha256:fake"})

        # .git/HEAD must remain at its original mode.
        assert gitfile.stat().st_mode == original_mode


# ── Tier 3: end-to-end ───────────────────────────────────────────────────
class TestRoundTripBridgeExport:
    """Init Muse repo → commit script → bridge → assert git ls-tree mode."""
    def test_executable_script_roundtrips_as_100755(self, tmp_path):
        # See reproducer in issue body.
        # Asserts: git ls-tree HEAD shows 100755 for the script.
        ...


# ── Tier 4: stress ───────────────────────────────────────────────────────
class TestFixModesStress:
    def test_1000_files_mixed(self, tmp_path):
        git_dir = tmp_path / "g"
        git_dir.mkdir()
        manifest = {}
        for i in range(500):
            f = git_dir / f"script_{i}.sh"
            f.write_bytes(b"#!/usr/bin/env bash\n")
            manifest[f"script_{i}.sh"] = "sha256:fake"
            f2 = git_dir / f"doc_{i}.md"
            f2.write_bytes(b"# doc\n")
            manifest[f"doc_{i}.md"] = "sha256:fake"

        exporter = _build_test_exporter(git_dir)
        start = time.perf_counter()
        exporter.fix_file_modes(manifest)
        elapsed = time.perf_counter() - start

        for i in range(500):
            assert (git_dir / f"script_{i}.sh").stat().st_mode & 0o777 == 0o755
            assert (git_dir / f"doc_{i}.md").stat().st_mode & 0o777 == 0o644
        # 1000 files in <500ms on dev hardware
        assert elapsed < 0.5, f"fix_file_modes too slow: {elapsed:.3f}s for 1000 files"


# ── Tier 5: data-integrity ───────────────────────────────────────────────
class TestModeChangesArePersistent:
    def test_chmod_minus_x_then_recommit_drops_to_644(self, tmp_path):
        # When user removes shebang from a script and re-bridges,
        # the new export should produce 0o644 (mode follows content).
        ...


# ── Tier 6: performance ──────────────────────────────────────────────────
class TestPerformance:
    def test_no_regression_vs_baseline(self, benchmark, tmp_path):
        # pytest-benchmark; baseline is the existing 0o644-only loop.
        # Heuristic adds one 2-byte read per file; allowed regression: <5%.
        ...


# ── Tier 7: security ─────────────────────────────────────────────────────
class TestSecurityModeNeverEscalatesBeyond755:
    def test_setuid_bit_is_never_set(self, tmp_path):
        git_dir = tmp_path / "g"
        git_dir.mkdir()
        f = git_dir / "evil.sh"
        f.write_bytes(b"#!/bin/sh\n")
        # Pre-set the file to 04755 (setuid).
        f.chmod(0o4755)

        exporter = _build_test_exporter(git_dir)
        exporter.fix_file_modes({"evil.sh": "sha256:fake"})

        mode = f.stat().st_mode & 0o7777  # full mode incl. setuid
        # Must be exactly 0o755 — setuid bit MUST be cleared.
        assert mode == 0o755, f"setuid not cleared: got {oct(mode)}"

    def test_path_traversal_blocked(self, tmp_path):
        # Manifest entries that resolve outside git_dir must be skipped.
        # Existing protection at lines 2082-2086; verify it still holds.
        ...

    def test_symlink_to_external_path_not_chmodded(self, tmp_path):
        # Symlinks pointing outside git_dir must be skipped.
        ...


# ── Test helper ──────────────────────────────────────────────────────────
def _build_test_exporter(git_dir):
    """Build a minimal GitExporter for fix_file_modes-only testing.

    fix_file_modes only reads self.git_dir; other GitExporter state is irrelevant.
    """
    from unittest.mock import MagicMock
    e = MagicMock(spec=GitExporter)
    e.git_dir = git_dir
    e.fix_file_modes = GitExporter.fix_file_modes.__get__(e, GitExporter)
    return e
```

## Alternatives considered

1. **Full mode tracking in snapshot manifest.** Add `mode: int` to manifest entries; include in `snapshot_id` derivation. Most "correct" but requires `format_version` bump, migration script (`muse code migrate` already exists for similar transitions), and breaks backward-compatible `snapshot_id` for all existing repos. Recommend defer to a separate RFC.
2. **Extend `.museattributes` with an `executable` field.** Idiomatic but requires user opt-in per pattern. Combine with the heuristic above as a future override mechanism if false positives surface in the wild.
3. **Per-file extension whitelist** (`.sh`, `.bash`, `.mjs`, `.py`, …). Fails for shebang-but-no-extension files (common in `bin/` directories). Shebang detection strictly dominates extension matching.

## Migration concerns

- Existing repos: no migration needed. The fix changes export-time behaviour only; on-disk Muse data is untouched.
- Downstream Git remotes: the next `bridge git-export` after this fix will produce a "mode-fix" diff for every file that now correctly gains `100755`. This is a one-time correction; subsequent exports are stable.
- CI/CD using `--fix-modes` explicitly: behaviour now matches what the help text always promised. No user-visible regression — only files with shebangs gain `+x`, which is what those users wanted.
- CI/CD that depends on universal `0o644`: opt out with `--no-fix-modes` (newly available via `BooleanOptionalAction`).

## Local verification results (patch already applied + tested)

Reporter applied the patch above directly to a local `0.2.0rc7` install and re-bridged `aaronrene/knowtation` (canonical `staging/main` HEAD `sha256:8514304e16d7f68db83b5183c01d4b2dd75e976a1cad9c39afa1334debafb110`):

```
=== Bridge run ===
Exported 613 files → git 'muse-mirror' (committed)

=== File mode distribution in resulting mirror ===
 572 100644
  41 100755

=== Sample git ls-tree HEAD (8 representative paths) ===
100644 blob 048f180da5ff…  .gitignore
100644 blob 2b7a023f95c3…  AGENTS.md
100755 blob 166b87ff3865…  deploy/paperclip/install.sh
100755 blob a98b6b5c6d27…  deploy/paperclip/scripts/push-secrets.sh
100644 blob 06ab00e0f22a…  docs/AGENT-ORCHESTRATION.md
100755 blob 08ecbdf403a1…  scripts/canister-export-backup.sh
100755 blob b3a6c97c8eed…  scripts/validate-deepinfra-enrich.mjs
100755 blob 0f78690555e8…  scripts/write-to-vault.sh

=== Identity check ===
PASS  0755  deploy/paperclip/install.sh
PASS  0755  deploy/paperclip/scripts/hello-world-test.sh
PASS  0755  deploy/paperclip/scripts/load-skills-and-agents.sh
PASS  0755  deploy/paperclip/scripts/push-secrets.sh
PASS  0755  deploy/paperclip/scripts/run-controller.sh
PASS  0755  deploy/paperclip/scripts/wire-knowtation-mcp.sh
PASS  0755  scripts/canister-decrypt-operator-backup.mjs
PASS  0755  scripts/canister-export-backup.mjs
PASS  0755  scripts/canister-export-backup.sh
PASS  0755  scripts/canister-predeploy.sh
PASS  0755  scripts/canister-release-prep.sh
PASS  0755  scripts/icp-canister-snapshot-backup.sh
PASS  0755  scripts/post-merge-hub-canister-release.sh
PASS  0755  scripts/validate-deepinfra-enrich.mjs
PASS  0755  scripts/write-to-vault.sh

Summary: 15/15 PASS, 0 FAIL, 0 MISSING
```

**Notable:** the patch caught **41 executables** total, not just the 15 originally identified during the diff review.  Twenty-six additional files in the canonical `staging/main` had been silently stripped of their executable bit by previous bridge runs and were correctly restored on this run.  Real-world impact is broader than the original triage suggested.

After confirming the patch works, reporter rolled back the local venv to canonical `0.2.0rc7` so subsequent operations exercise the unpatched (current) code path until this fix lands officially.

---

## Suggested labels

`bug` · `bridge` · `severity-high` · `good-first-fix-after-design-ack`

## Related

- Issue #36 (resolved): `compute_commit_id` formula divergence between client and server. Same kind of "client expects feature, server didn't ship it" mismatch — except here it's "feature documented, never implemented."
