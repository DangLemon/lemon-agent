from types import SimpleNamespace

import pytest

from lemon_constants import get_lemon_home
from agent.codex_responses_adapter import _normalize_codex_response
from agent.provider_artifacts import materialize_provider_citations


def test_final_container_file_citation_survives_response_normalization():
    citation = SimpleNamespace(
        type="container_file_citation",
        container_id="cntr_safe_123",
        file_id="file_safe_456",
        filename="report.zip",
        start_index=12,
        end_index=31,
    )
    response = SimpleNamespace(
        status="completed",
        output=[
            SimpleNamespace(
                type="message",
                role="assistant",
                status="completed",
                phase="final_answer",
                id="msg_final_123",
                content=[
                    SimpleNamespace(
                        type="output_text",
                        text="Report ready for download.",
                        annotations=[citation],
                    )
                ],
            )
        ],
    )

    assistant_message, finish_reason = _normalize_codex_response(response)

    assert finish_reason == "stop"
    assert assistant_message.content == "Report ready for download."
    assert assistant_message.provider_artifact_citations == [{
        "container_id": "cntr_safe_123", "file_id": "file_safe_456", "filename": "report.zip",
    }]


def test_final_container_file_citation_accepts_mapping_annotations():
    response = SimpleNamespace(
        status="completed",
        output=[SimpleNamespace(
            type="message", role="assistant", status="completed", phase="final_answer",
            content=[SimpleNamespace(
                type="output_text", text="Done.", annotations=[{
                    "type": "container_file_citation", "container_id": "cntr_789", "file_id": "file_012",
                    "filename": "data.csv", "start_index": 0, "end_index": 4,
                }],
            )],
        )],
    )

    assistant_message, _ = _normalize_codex_response(response)

    assert assistant_message.content == "Done."
    assert assistant_message.provider_artifact_citations == [{
        "container_id": "cntr_789", "file_id": "file_012", "filename": "data.csv",
    }]


def test_only_well_formed_deduplicated_final_citations_survive():
    response = SimpleNamespace(
        status="completed",
        output=[
            SimpleNamespace(
                type="message", role="assistant", status="completed", phase="commentary",
                content=[SimpleNamespace(type="output_text", annotations=[SimpleNamespace(
                    type="container_file_citation", container_id="cntr_1", file_id="file_1", filename="early.zip",
                )])],
            ),
            SimpleNamespace(
                type="message", role="assistant", status="completed", phase="final_answer",
                content=[SimpleNamespace(type="output_text", annotations=[
                    SimpleNamespace(type="container_file_citation", container_id="cntr_1", file_id="file_1", filename="ok.zip"),
                    SimpleNamespace(type="container_file_citation", container_id="cntr_1", file_id="file_1", filename="ok.zip"),
                    SimpleNamespace(type="container_file_citation", container_id="../bad", file_id="file_2", filename="bad.zip"),
                    SimpleNamespace(type="container_file_citation", container_id="cntr_1", file_id="", filename="bad2.zip"),
                    SimpleNamespace(type="url_citation", url="https://example.invalid/file.zip"),
                ])],
            ),
        ],
    )

    assistant_message, _ = _normalize_codex_response(response)

    assert assistant_message.provider_artifact_citations == [{
        "container_id": "cntr_1", "file_id": "file_1", "filename": "ok.zip",
    }]


def test_materializer_streams_only_when_runtime_is_direct_openai_api_key(tmp_path, monkeypatch):
    calls = []

    class Response:
        response = SimpleNamespace(headers={"content-type": "application/zip"})
        def __enter__(self): return self
        def __exit__(self, *_args): pass
        def iter_bytes(self, chunk_size=1): return iter([b"zip", b"-payload"])

    class Content:
        def retrieve(self, **kwargs):
            calls.append(kwargs)
            return Response()

    client = SimpleNamespace(with_streaming_response=SimpleNamespace(containers=SimpleNamespace(
        files=SimpleNamespace(content=SimpleNamespace(retrieve=Content().retrieve)))))
    monkeypatch.setenv("LEMON_HOME", str(tmp_path))
    monkeypatch.setattr("lemon_cli.profiles.get_active_profile_name", lambda: "custom")
    citations = [{"container_id": "cntr_1", "file_id": "file_2", "filename": "report.zip"}]

    refs = materialize_provider_citations(
        SimpleNamespace(provider="openai-api", api_mode="codex_responses", base_url="https://api.openai.com/v1",
                        api_key="direct-key", client=client), citations,
    )

    assert len(refs) == 1
    assert calls == [{"container_id": "cntr_1", "file_id": "file_2", "timeout": 60}]
    assert (get_lemon_home() / "cache" / "provider-artifacts" / refs[0].artifact_id).read_bytes() == b"zip-payload"


@pytest.mark.parametrize("provider,base_url,api_key", [
    ("openai-codex", "https://chatgpt.com/backend-api/codex", "oauth-secret"),
    ("openai-api", "https://api.openai.com.attacker.invalid/v1", "direct-key"),
    ("openai-api", "https://proxy.example/v1", "direct-key"),
])
def test_materializer_makes_no_request_for_unsupported_runtime(tmp_path, monkeypatch, provider, base_url, api_key):
    calls = []
    client = SimpleNamespace(with_streaming_response=SimpleNamespace(containers=SimpleNamespace(
        files=SimpleNamespace(content=SimpleNamespace(retrieve=lambda **kw: calls.append(kw))))))
    monkeypatch.setenv("LEMON_HOME", str(tmp_path))
    monkeypatch.setattr("lemon_cli.profiles.get_active_profile_name", lambda: "custom")

    refs = materialize_provider_citations(
        SimpleNamespace(provider=provider, api_mode="codex_responses", base_url=base_url, api_key=api_key, client=client),
        [{"container_id": "cntr_1", "file_id": "file_2", "filename": "report.zip"}],
    )

    assert refs == []
    assert calls == []
