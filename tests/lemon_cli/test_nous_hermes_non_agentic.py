"""Tests for the Nous-Hermes-3/4 non-agentic warning detector.

The detector must not confuse product branding with provider-owned model IDs.
``is_nous_lemon_non_agentic`` only matches the actual Nous Research
Hermes-3 / Hermes-4 chat family.
"""

from __future__ import annotations

import pytest

from lemon_cli.model_switch import (
    _LEMON_MODEL_WARNING,
    _check_lemon_model_warning,
    is_nous_lemon_non_agentic,
)


@pytest.mark.parametrize(
    "model_name",
    [
        "NousResearch/Hermes-3-Llama-3.1-70B",
        "NousResearch/Hermes-3-Llama-3.1-405B",
        "hermes-3",
        "Hermes-3",
        "hermes-4",
        "hermes-4-405b",
        "openrouter/nousresearch/hermes-4-405b",
        "hermes-3.1",
    ],
)
def test_matches_real_nous_lemon_chat_models(model_name: str) -> None:
    assert is_nous_lemon_non_agentic(model_name), (
        f"expected {model_name!r} to be flagged as Nous Hermes 3/4"
    )
    assert _check_lemon_model_warning(model_name) == _LEMON_MODEL_WARNING


