import pytest

from lemon_cli import web_server, web_server_sessions
from lemon_cli.web_routers import files as files_router

pytest.importorskip("starlette.testclient")
from starlette.testclient import TestClient


@pytest.fixture
def client(monkeypatch):
    previous_auth_required = getattr(web_server.app.state, "auth_required", None)
    web_server.app.state.auth_required = False
    test_client = TestClient(web_server.app)
    test_client.headers[web_server._SESSION_HEADER_NAME] = web_server._SESSION_TOKEN
    try:
        yield test_client
    finally:
        if previous_auth_required is None:
            try:
                delattr(web_server.app.state, "auth_required")
            except AttributeError:
                pass
        else:
            web_server.app.state.auth_required = previous_auth_required


def test_provider_artifact_download_requires_descriptor_in_session_lineage(client, monkeypatch, tmp_path):
    from agent.provider_artifacts import ProviderArtifactStore

    monkeypatch.setenv("LEMON_HOME", str(tmp_path / "profile-default"))
    store = ProviderArtifactStore(tmp_path / "profile-default" / "cache" / "provider-artifacts")
    ref = store.store(b"zip-payload", filename="report.zip", content_type="application/zip")
    db = _FakeSessionDb([ref.to_dict()])
    monkeypatch.setattr(files_router, "_provider_artifact_store_for_profile", lambda profile: store)
    monkeypatch.setattr(web_server_sessions, "_open_session_db_for_profile", lambda profile, read_only: db)
    monkeypatch.setattr("lemon_cli.profiles.get_profile_dir", lambda profile: tmp_path / "profile-default")
    monkeypatch.setattr("lemon_cli.web_server_cron._cron_profile_home", lambda profile: (profile or "default", tmp_path / "profile-default"))

    allowed = client.get("/api/provider-artifacts/" + ref.artifact_id, params={"session_id": "session-a"})
    denied = client.get("/api/provider-artifacts/" + ref.artifact_id, params={"session_id": "session-b"})

    assert allowed.status_code == 200
    assert allowed.content == b"zip-payload"
    assert allowed.headers["content-disposition"].endswith('filename="report.zip"')
    assert allowed.headers["x-content-type-options"] == "nosniff"
    assert denied.status_code == 404


def test_provider_artifact_download_requires_auth(client, tmp_path):
    client.headers.clear()
    response = client.get("/api/provider-artifacts/0123456789abcdef0123456789abcdef", params={"session_id": "s"})

    assert response.status_code == 401


class _FakeSessionDb:
    def __init__(self, refs):
        self.refs = refs

    def resolve_session_id(self, session_id):
        return session_id

    def get_resume_conversations(self, session_id):
        metadata = {"provider_artifacts": self.refs} if session_id == "session-a" else {}
        return [], [{"role": "assistant", "content": "Done", "display_metadata": metadata}]

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        pass

    def close(self):
        pass
