from types import SimpleNamespace

from agent.provider_artifacts import materialize_provider_citations
from lemon_cli.web_routers.files import _provider_artifact_store_for_profile


def test_custom_home_materialization_and_download_resolve_the_same_store(tmp_path, monkeypatch):
    custom_home = tmp_path / "custom-home"
    monkeypatch.setenv("LEMON_HOME", str(custom_home))
    monkeypatch.setattr("lemon_cli.profiles.get_active_profile_name", lambda: "custom")
    monkeypatch.setattr("lemon_cli.config.get_lemon_home", lambda: custom_home)
    monkeypatch.setattr("lemon_cli.web_routers.files.get_lemon_home", lambda: custom_home)

    class Response:
        response = SimpleNamespace(headers={"content-type": "application/zip"})

        def __enter__(self): return self
        def __exit__(self, *_args): pass
        def iter_bytes(self, chunk_size=1): return iter([b"zip"])

    client = SimpleNamespace(with_streaming_response=SimpleNamespace(containers=SimpleNamespace(
        files=SimpleNamespace(content=SimpleNamespace(retrieve=lambda **_kwargs: Response())))))
    agent = SimpleNamespace(
        provider="openai-api", api_mode="codex_responses", base_url="https://api.openai.com/v1",
        api_key="test-key", client=client,
    )
    refs = materialize_provider_citations(
        agent, [{"container_id": "cntr_1", "file_id": "file_1", "filename": "report.zip"}],
    )

    assert len(refs) == 1
    store = _provider_artifact_store_for_profile("custom")
    assert store.read(refs[0].artifact_id, ref=refs[0]) == b"zip"
