from types import SimpleNamespace

from tui_gateway.prompt_turn import _complete_turn_payload


def test_completed_turn_payload_carries_provider_artifacts_only_on_success(monkeypatch):
    monkeypatch.setattr("tui_gateway.prompt_turn._get_usage", lambda _agent: {}, raising=False)
    monkeypatch.setattr("tui_gateway.prompt_turn.render_message", lambda _text, _cols: None, raising=False)
    monkeypatch.setattr("tui_gateway.prompt_turn._clear_inflight_turn", lambda _session: None, raising=False)
    monkeypatch.setattr("tui_gateway.prompt_turn._fail_inflight_turn", lambda *_args, **_kwargs: None, raising=False)
    monkeypatch.setattr("tui_gateway.prompt_turn._turn_failure_detail", lambda *_args: "failure", raising=False)
    refs = [{"id": "0" * 32, "filename": "safe.zip"}]
    agent = SimpleNamespace(provider="openai-api", model="gpt-5.4")
    session = {"history_lock": __import__("threading").Lock()}
    st = SimpleNamespace(result={"final_response": "Done", "provider_artifacts": refs}, agent=agent,
                         receipt_committed=False, error_retained=False, marker_key=None,
                         terminal_callback=None, prompt_text="prompt")

    payload, _raw, status = _complete_turn_payload(session, st, None, 80)

    assert status == "complete"
    assert payload["artifacts"] == refs


def test_failed_turn_payload_does_not_expose_provider_artifacts(monkeypatch):
    monkeypatch.setattr("tui_gateway.prompt_turn._get_usage", lambda _agent: {}, raising=False)
    monkeypatch.setattr("tui_gateway.prompt_turn.render_message", lambda _text, _cols: None, raising=False)
    monkeypatch.setattr("tui_gateway.prompt_turn._clear_inflight_turn", lambda _session: None, raising=False)
    monkeypatch.setattr("tui_gateway.prompt_turn._fail_inflight_turn", lambda *_args, **_kwargs: None, raising=False)
    monkeypatch.setattr("tui_gateway.prompt_turn._turn_failure_detail", lambda *_args: "failure", raising=False)
    refs = [{"id": "0" * 32, "filename": "safe.zip"}]
    agent = SimpleNamespace(provider="openai-api", model="gpt-5.4")
    session = {"history_lock": __import__("threading").Lock()}
    st = SimpleNamespace(result={"final_response": "failure", "failed": True, "error": "failure",
                                 "provider_artifacts": refs}, agent=agent,
                         receipt_committed=False, error_retained=False, marker_key=None,
                         terminal_callback=None, prompt_text="prompt")

    payload, _raw, _status = _complete_turn_payload(session, st, None, 80)

    assert "artifacts" not in payload
