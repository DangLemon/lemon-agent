import pytest


@pytest.fixture
def client(_isolate_lemon_home):
    try:
        from starlette.testclient import TestClient
    except ImportError:
        pytest.skip("fastapi/starlette not installed")
    from lemon_cli import web_server

    client = TestClient(web_server.app)
    client.headers[web_server._SESSION_HEADER_NAME] = web_server._SESSION_TOKEN
    return client


def test_raw_config_reports_display_language_absent(client):
    response = client.get("/api/config/raw")

    assert response.status_code == 200
    payload = response.json()
    assert payload["yaml"] == ""
    assert payload["explicit_display_language"] is False


def test_raw_config_reports_display_language_absent_when_display_has_no_language(client):
    from lemon_cli.config import get_config_path

    get_config_path().write_text("display:\n  skin: default\n", encoding="utf-8")

    response = client.get("/api/config/raw")

    assert response.status_code == 200
    payload = response.json()
    assert payload["explicit_display_language"] is False
    assert payload["path"] == str(get_config_path())
    assert payload["yaml"] == "display:\n  skin: default\n"


def test_raw_config_reports_display_language_present(client):
    from lemon_cli.config import get_config_path

    get_config_path().write_text("display:\n  language:\n  skin: default\n", encoding="utf-8")

    response = client.get("/api/config/raw")

    assert response.status_code == 200
    payload = response.json()
    assert payload["explicit_display_language"] is True
    assert payload["path"] == str(get_config_path())
    assert "language:" in payload["yaml"]


def test_raw_config_reports_display_language_for_requested_profile(client):
    from lemon_constants import get_lemon_home
    from lemon_cli.config import get_config_path

    default_config_path = get_config_path()
    default_config_path.write_text("display:\n  language: en\n", encoding="utf-8")

    worker_home = get_lemon_home() / "profiles" / "worker_beta"
    worker_home.mkdir(parents=True)
    worker_config_path = worker_home / "config.yaml"
    worker_config_path.write_text("display:\n  skin: default\n", encoding="utf-8")

    response = client.get("/api/config/raw?profile=worker_beta")

    assert response.status_code == 200
    payload = response.json()
    assert payload["explicit_display_language"] is False
    assert payload["path"] == str(worker_config_path)
    assert payload["yaml"] == "display:\n  skin: default\n"


def test_raw_config_metadata_survives_malformed_yaml(client):
    from lemon_cli.config import get_config_path

    get_config_path().write_text("display: [\n", encoding="utf-8")

    response = client.get("/api/config/raw")

    assert response.status_code == 200
    payload = response.json()
    assert payload["explicit_display_language"] is False
    assert payload["path"] == str(get_config_path())
    assert payload["yaml"] == "display: [\n"
