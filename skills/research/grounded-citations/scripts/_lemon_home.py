"""Resolve LEMON_HOME for standalone skill scripts.

Skill scripts may run outside the Lemon AI process (system Python, nix env,
CI) where ``lemon_constants`` is not importable.  This module provides the
same ``get_lemon_home()`` contract without requiring it on ``sys.path``.

When ``lemon_constants`` IS available it is used directly so profile
resolution and any future enhancements are picked up automatically.
"""

from __future__ import annotations

import os
from pathlib import Path

try:
    from lemon_constants import get_lemon_home as get_lemon_home
except (ModuleNotFoundError, ImportError):

    def get_lemon_home() -> Path:
        """Return the Lemon AI home directory (default: ``~/.lemon-ai``)."""
        val = os.environ.get("LEMON_HOME", "").strip()
        return Path(val) if val else Path.home() / ".lemon-ai"
