"""Incremental AX tree diff for computer_use captures (Phase 2 Codex-parity).

Caches the last element fingerprint per (session, app, window) and formats a
compact added/removed/changed summary so re-captures cost fewer tokens than a
full tree dump. Indices remain those of the *current* snapshot — always prefer
``element_token`` when present for stale-safe clicks.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Sequence, Tuple


@dataclass(frozen=True)
class ElementFp:
    """Stable-enough fingerprint of one AX/SOM element for diffing."""

    index: int
    role: str
    label: str
    token: Optional[str] = None


@dataclass
class TreeDiff:
    """Diff between two element lists for the same window."""

    added: List[ElementFp]
    removed: List[ElementFp]
    changed: List[Tuple[ElementFp, ElementFp]]  # (prev, curr)
    unchanged: int

    @property
    def empty(self) -> bool:
        return not self.added and not self.removed and not self.changed

    def stats(self) -> Dict[str, int]:
        return {
            "added": len(self.added),
            "removed": len(self.removed),
            "changed": len(self.changed),
            "unchanged": self.unchanged,
        }


def fingerprint_element(e: Any, *, max_label: int = 80) -> ElementFp:
    """Build a fingerprint from a ``UIElement`` or element dict."""
    if isinstance(e, dict):
        idx = int(e.get("index") if e.get("index") is not None else e.get("element_index") or 0)
        role = str(e.get("role") or "")
        label = str(e.get("label") or "")
        token = e.get("element_token")
    else:
        idx = int(getattr(e, "index", 0) or 0)
        role = str(getattr(e, "role", "") or "")
        label = str(getattr(e, "label", "") or "")
        token = getattr(e, "element_token", None)
    label = label.replace("\n", " ")
    if len(label) > max_label:
        label = label[:max_label]
    tok = token if isinstance(token, str) and token else None
    return ElementFp(index=idx, role=role, label=label, token=tok)


def fingerprint_elements(elements: Sequence[Any], *, max_label: int = 80) -> List[ElementFp]:
    return [fingerprint_element(e, max_label=max_label) for e in elements]


def diff_trees(prev: Sequence[ElementFp], curr: Sequence[ElementFp]) -> TreeDiff:
    """Diff two fingerprint lists for the same window.

    cua-driver mints a fresh ``snapshot_id`` on every capture, so full
    ``element_token`` values (``s########:row``) always churn — they are for
    *action* addressing, not tree identity. Matching is therefore structural:

    1. same index + same role → same slot (label delta = changed)
    2. else first unused prev with same (role, label) → unchanged (reorder)
    3. else → added; unmatched prev → removed
    """
    prev_by_idx = {fp.index: fp for fp in prev}
    unmatched_prev: List[ElementFp] = list(prev)
    added: List[ElementFp] = []
    changed: List[Tuple[ElementFp, ElementFp]] = []
    unchanged = 0

    for c in curr:
        p = prev_by_idx.get(c.index)
        if p is not None and p.role == c.role and p in unmatched_prev:
            unmatched_prev.remove(p)
            if p.label != c.label:
                changed.append((p, c))
            else:
                unchanged += 1
            continue
        twin = next((q for q in unmatched_prev if q.role == c.role and q.label == c.label), None)
        if twin is not None:
            unmatched_prev.remove(twin)
            unchanged += 1
            continue
        added.append(c)

    return TreeDiff(added=added, removed=list(unmatched_prev), changed=changed, unchanged=unchanged)


def format_tree_diff(diff: TreeDiff, *, max_lines: int = 40) -> str:
    """Human-readable diff block for capture summaries."""
    if diff.empty:
        return f"tree_diff: unchanged ({diff.unchanged} element(s))"
    lines = [
        f"tree_diff: +{len(diff.added)} -{len(diff.removed)} ~{len(diff.changed)} "
        f"(unchanged {diff.unchanged})"
    ]
    budget = max_lines

    def _line(prefix: str, fp: ElementFp) -> str:
        label = fp.label.replace("\n", " ")[:60]
        tok = f" token={fp.token}" if fp.token else ""
        return f"  {prefix} #{fp.index} {fp.role} {label!r}{tok}"

    for fp in diff.added:
        if budget <= 0:
            break
        lines.append(_line("+", fp))
        budget -= 1
    for fp in diff.removed:
        if budget <= 0:
            break
        lines.append(_line("-", fp))
        budget -= 1
    for old, new in diff.changed:
        if budget <= 0:
            break
        lines.append(
            f"  ~ #{old.index}→#{new.index} {old.role}/{new.role} "
            f"{old.label[:40]!r} → {new.label[:40]!r}"
            + (f" token={new.token}" if new.token else "")
        )
        budget -= 1
    shown = len(lines) - 1
    total = len(diff.added) + len(diff.removed) + len(diff.changed)
    if shown < total:
        lines.append(f"  ... +{total - shown} more diff rows")
    return "\n".join(lines)


def cache_key(session_id: str, *, app: str = "", window_id: Any = None,
              window_title: str = "") -> str:
    """Stable cache key for one resident tree slot."""
    wid = "" if window_id is None else str(window_id)
    return f"{session_id or ''}|{app or ''}|{wid}|{window_title or ''}"
