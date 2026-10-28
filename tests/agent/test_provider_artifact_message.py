from types import SimpleNamespace

from agent.chat_completion_helpers import build_assistant_message


def test_final_assistant_row_carries_provider_artifact_display_metadata():
    citations = [{"container_id": "cntr_test", "file_id": "file_test", "filename": "safe.zip"}]
    assistant_message = SimpleNamespace(
        content="The file is ready.",
        tool_calls=None,
        reasoning=None,
        reasoning_content=None,
        reasoning_details=None,
        provider_artifact_citations=citations,
    )
    agent = SimpleNamespace(
        _extract_reasoning=lambda _msg: None,
        _needs_thinking_reasoning_pad=lambda: False,
        _strip_think_blocks=lambda text: text,
    )

    message = build_assistant_message(agent, assistant_message, "stop")

    assert message["content"] == "The file is ready."
    assert message["display_metadata"]["provider_artifact_citations"] == citations
