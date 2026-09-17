"""Resolve LEMON_HOME for standalone skill scripts.

Skill scripts may run outside the Lemon AI process (e.g. system Python,
nix env, CI) where ``lemon_constants`` is not importable.  This module
provides the same ``get_lemon_home()`` and ``display_lemon_home()``
contracts as ``lemon_constants`` without requiring it on ``sys.path``.

When ``lemon_constants`` IS available it is used directly so that any
future enhancements (profile resolution, Docker detection, etc.) are
picked up automatically.  The fallback path replicates the core logic
from ``lemon_constants.py`` using only the stdlib.

All scripts under ``google-workspace/scripts/`` should import from here
instead of duplicating the ``LEMON_HOME = Path(os.getenv(...))`` pattern.
"""

from __future__ import annotations

import os
from pathlib import Path

try:
    from lemon_constants import display_lemon_home as display_lemon_home
    from lemon_constants import get_lemon_home as get_lemon_home
except (ModuleNotFoundError, ImportError):

    def get_lemon_home() -> Path:
        """Return the Lemon AI home directory (default: ~/.lemon-ai).

        Mirrors ``lemon_constants.get_lemon_home()``."""
        val = os.environ.get("LEMON_HOME", "").strip()
        return Path(val) if val else Path.home() / ".lemon-ai"

    def display_lemon_home() -> str:
        """Return a user-friendly ``~/``-shortened display string.

        Mirrors ``lemon_constants.display_lemon_home()``."""
        home = get_lemon_home()
        try:
            return "~/" + home.relative_to(Path.home()).as_posix()
        except ValueError:
            return str(home)
