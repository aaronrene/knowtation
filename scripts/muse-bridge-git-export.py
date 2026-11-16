#!/usr/bin/env python3
"""SIGPIPE-safe wrapper for ``muse bridge git-export``.

Muse's export path runs ``git check-ignore -z --stdin`` with the full
exported path list. When git closes the pipe early, CPython's default
SIGPIPE handler (SIG_DFL) kills the process with exit 141 and no traceback.
That presents as a silent bridge failure after a successful MuseHub land.

This wrapper:

1. Ignores SIGPIPE for the process lifetime (BrokenPipeError instead of death)
2. Re-applies that ignore around every ``subprocess.run`` call
3. Dispatches to the same ``muse.cli.app:main`` entry as the ``muse`` shim

Invoke with the Muse venv interpreter (see ``scripts/muse-bridge-deploy.sh``).
"""

from __future__ import annotations

import signal
import subprocess
import sys


def _ignore_sigpipe() -> None:
    """Keep SIGPIPE ignored even if libraries reset the handler."""
    signal.signal(signal.SIGPIPE, signal.SIG_IGN)


def _install_subprocess_guard() -> None:
    """Re-ignore SIGPIPE immediately before each subprocess.run."""
    real_run = subprocess.run

    def run_guard(*args, **kwargs):  # noqa: ANN002, ANN003
        _ignore_sigpipe()
        return real_run(*args, **kwargs)

    subprocess.run = run_guard  # type: ignore[assignment]


def main(argv: list[str] | None = None) -> int:
    """Run ``muse bridge git-export`` with *argv* (excluding program name)."""
    _ignore_sigpipe()
    _install_subprocess_guard()

    # Import after installing the guard so early import-time subprocesses
    # are also covered; re-ignore after import in case Muse resets handlers.
    from muse.cli.app import main as muse_main

    _ignore_sigpipe()

    args = list(sys.argv[1:] if argv is None else argv)
    sys.argv = ["muse", "bridge", "git-export", *args]
    result = muse_main()
    return int(result or 0)


if __name__ == "__main__":
    raise SystemExit(main())
