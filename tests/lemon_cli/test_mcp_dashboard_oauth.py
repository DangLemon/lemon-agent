"""Dashboard HTTP contract for hosted MCP OAuth."""

from unittest.mock import patch

import pytest
import lemon_cli.web_server_mcp as _web_server_mcp
import lemon_cli.web_server_profiles as _web_server_profiles


def _client():
    from starlette.testclient import TestClient

    from lemon_cli.web_server import app, _SESSION_HEADER_NAME, _SESSION_TOKEN

    client = TestClient(app)
    client.headers[_SESSION_HEADER_NAME] = _SESSION_TOKEN
    return client


@pytest.fixture(autouse=True)
def _clear_flows():
    from lemon_cli import web_server

    _web_server_mcp._mcp_oauth_flows.clear()
    web_server.app.state.auth_required = False
    yield
    _web_server_mcp._mcp_oauth_flows.clear()
    web_server.app.state.auth_required = False


def test_hosted_auth_start_returns_public_authorization_url(monkeypatch):
    from lemon_cli import web_server

    client = _client()
    client.post(
        "/api/mcp/servers",
        json={"name": "reports", "url": "https://mcp.example/mcp", "auth": "oauth"},
    )

    def fake_worker(flow, cfg):
        import asyncio

        asyncio.run(
            flow.publish_authorization_url("https://idp.example/authorize?state=s1")
        )

    monkeypatch.setattr(_web_server_mcp, "_run_dashboard_mcp_oauth", fake_worker)
    with patch(
        "lemon_cli.dashboard_auth.prefix.resolve_public_url",
        return_value="https://agent.example",
    ):
        response = client.post("/api/mcp/servers/reports/auth")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "authorization_required"
    assert body["authorization_url"] == "https://idp.example/authorize?state=s1"
    flow = _web_server_mcp._mcp_oauth_flows[body["flow_id"]]
    assert flow.redirect_uri == "https://agent.example/api/mcp/oauth/callback/reports"


def test_hosted_callback_bypasses_gated_cookie_auth(monkeypatch):
    import asyncio

    from starlette.testclient import TestClient

    from lemon_cli import web_server
    from tools.mcp_dashboard_oauth import DashboardOAuthFlow

    flow = DashboardOAuthFlow(
        flow_id="flow-gated",
        server_name="reports",
        profile=None,
        lemon_home="/tmp/lemon-test",
        redirect_uri="https://agent.example/api/mcp/oauth/callback/reports",
    )
    asyncio.run(
        flow.publish_authorization_url("https://idp.example/authorize?state=expected")
    )
    _web_server_mcp._mcp_oauth_flows[flow.flow_id] = flow
    monkeypatch.setattr(web_server.app.state, "auth_required", True, raising=False)

    response = TestClient(web_server.app).get(
        "/api/mcp/oauth/callback/reports?code=abc&state=expected"
    )

    assert response.status_code == 200
    assert flow._callback == ("abc", "expected")


def test_hosted_auth_allows_same_server_name_in_different_profiles(
    tmp_path, monkeypatch
):
    from lemon_cli import web_server
    from tools.mcp_dashboard_oauth import DashboardOAuthFlow

    profile_home = tmp_path / "profiles" / "work"
    profile_home.mkdir(parents=True)
    monkeypatch.setattr(
        _web_server_profiles, "_resolve_profile_dir", lambda _name: profile_home
    )

    existing = DashboardOAuthFlow(
        flow_id="existing-default",
        server_name="reports",
        profile=None,
        lemon_home=str(tmp_path / "default"),
        redirect_uri="https://agent.example/callback/existing",
    )
    _web_server_mcp._mcp_oauth_flows[existing.flow_id] = existing

    def fake_worker(flow, cfg):
        import asyncio

        asyncio.run(
            flow.publish_authorization_url("https://idp.example/authorize?state=work")
        )

    with (
        patch(
            "lemon_cli.mcp_config._get_mcp_servers",
            return_value={"reports": {"url": "https://mcp.example"}},
        ),
        patch.object(_web_server_mcp, "_run_dashboard_mcp_oauth", fake_worker),
    ):
        response = _client().post("/api/mcp/servers/reports/auth?profile=work")

    assert response.status_code != 409


def test_flow_status_does_not_expose_authorization_code():
    from lemon_cli import web_server
    from tools.mcp_dashboard_oauth import DashboardOAuthFlow

    flow = DashboardOAuthFlow(
        flow_id="flow-status",
        server_name="reports",
        profile=None,
        lemon_home="/tmp/lemon-test",
        redirect_uri="https://agent.example/api/mcp/oauth/callback/flow-status",
    )
    flow.authorization_url = "https://idp.example/authorize"
    flow.status = "approved"
    flow._callback = ("secret-code", "secret-state")
    _web_server_mcp._mcp_oauth_flows[flow.flow_id] = flow

    response = _client().get("/api/mcp/oauth/flows/flow-status")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "approved"
    assert "secret-code" not in response.text
    assert "secret-state" not in response.text


def test_custom_http_loopback_auth_returns_desktop_transport_and_relay(monkeypatch):
    client = _client()
    client.put(
        "/api/mcp/servers",
        json={
            "servers": {
                "amazon-ads": {
                    "url": "https://mcp.example/mcp",
                    "auth": "oauth",
                    "oauth": {"redirect_uri": "http://localhost:8000/auth/callback"},
                }
            }
        },
    )

    def fake_worker(flow, cfg):
        import asyncio

        asyncio.run(
            flow.publish_authorization_url(
                "https://idp.example/authorize?state=expected"
            )
        )
        try:
            asyncio.run(flow.wait_for_callback(timeout=5))
            flow.mark_approved()
        except Exception as exc:
            flow.mark_error(str(exc))
        finally:
            flow.mark_worker_done()

    monkeypatch.setattr(_web_server_mcp, "_run_dashboard_mcp_oauth", fake_worker)

    response = client.post("/api/mcp/servers/amazon-ads/auth", json={"supports_desktop_loopback": True})

    assert response.status_code == 200
    body = response.json()
    assert body["callback_transport"] == "desktop_loopback"
    assert body["callback_redirect_uri"] == "http://localhost:8000/auth/callback"
    assert body["callback_expected_state"] == "expected"

    wrong = client.post(
        f"/api/mcp/oauth/flows/{body['flow_id']}/callback",
        json={"code": "bad", "state": "wrong"},
    )
    assert wrong.status_code == 400

    relay = client.post(
        f"/api/mcp/oauth/flows/{body['flow_id']}/callback",
        json={"code": "abc", "state": "expected"},
    )
    assert relay.status_code == 200
    assert relay.json() == {"ok": True, "flow_id": body["flow_id"]}

    replay = client.post(
        f"/api/mcp/oauth/flows/{body['flow_id']}/callback",
        json={"code": "abc", "state": "expected"},
    )
    assert replay.status_code == 409

    flow = _web_server_mcp._mcp_oauth_flows[body["flow_id"]]
    assert flow._worker_done.wait(timeout=5)

    status = client.get(f"/api/mcp/oauth/flows/{body['flow_id']}")
    assert status.status_code == 200
    assert status.json()["status"] == "approved"


def test_custom_https_redirect_keeps_backend_transport(monkeypatch):
    client = _client()
    client.put(
        "/api/mcp/servers",
        json={
            "servers": {
                "reports-https": {
                    "url": "https://mcp.example/mcp",
                    "auth": "oauth",
                    "oauth": {"redirect_uri": "https://oauth.example.ts.net/callback"},
                }
            }
        },
    )

    def fake_worker(flow, cfg):
        import asyncio

        asyncio.run(
            flow.publish_authorization_url(
                "https://idp.example/authorize?state=https-state"
            )
        )

    monkeypatch.setattr(_web_server_mcp, "_run_dashboard_mcp_oauth", fake_worker)

    response = client.post("/api/mcp/servers/reports-https/auth")

    assert response.status_code == 200
    body = response.json()
    assert body["callback_transport"] == "backend"
    assert body["callback_redirect_uri"] is None
    assert body["callback_expected_state"] is None


def test_custom_loopback_redirect_without_desktop_capability_returns_actionable_400():
    client = _client()
    client.put(
        "/api/mcp/servers",
        json={
            "servers": {
                "browser-loopback": {
                    "url": "https://mcp.example/mcp",
                    "auth": "oauth",
                    "oauth": {"redirect_uri": "http://localhost:8000/auth/callback"},
                }
            }
        },
    )

    response = client.post("/api/mcp/servers/browser-loopback/auth")

    assert response.status_code == 400
    assert "Desktop loopback" in response.json()["detail"]


def test_configured_canonical_loopback_callback_keeps_backend_transport(monkeypatch):
    client = _client()
    canonical = "http://testserver/api/mcp/oauth/callback/canonical-loopback"
    client.put(
        "/api/mcp/servers",
        json={
            "servers": {
                "canonical-loopback": {
                    "url": "https://mcp.example/mcp",
                    "auth": "oauth",
                    "oauth": {"redirect_uri": canonical},
                }
            }
        },
    )

    def fake_worker(flow, cfg):
        import asyncio

        asyncio.run(flow.publish_authorization_url("https://idp.example/authorize?state=canonical"))

    monkeypatch.setattr(_web_server_mcp, "_run_dashboard_mcp_oauth", fake_worker)

    response = client.post("/api/mcp/servers/canonical-loopback/auth")

    assert response.status_code == 200
    body = response.json()
    assert body["callback_transport"] == "backend"
    assert body["callback_redirect_uri"] is None
    flow = _web_server_mcp._mcp_oauth_flows[body["flow_id"]]
    assert flow.redirect_uri == canonical


def test_custom_loopback_redirect_rejects_unsupported_uri():
    client = _client()
    client.put(
        "/api/mcp/servers",
        json={
            "servers": {
                "bad-loopback": {
                    "url": "https://mcp.example/mcp",
                    "auth": "oauth",
                    "oauth": {
                        "redirect_uri": "http://user:pass@localhost:8000/auth/callback"
                    },
                }
            }
        },
    )

    response = client.post("/api/mcp/servers/bad-loopback/auth")

    assert response.status_code == 400
    assert "redirect_uri" in response.json()["detail"]


def test_custom_loopback_redirect_rejects_malformed_port():
    client = _client()
    client.put(
        "/api/mcp/servers",
        json={
            "servers": {
                "bad-port": {
                    "url": "https://mcp.example/mcp",
                    "auth": "oauth",
                    "oauth": {"redirect_uri": "http://localhost:bad/auth/callback"},
                }
            }
        },
    )

    response = client.post("/api/mcp/servers/bad-port/auth", json={"supports_desktop_loopback": True})

    assert response.status_code == 400
    assert "redirect_uri" in response.json()["detail"]
