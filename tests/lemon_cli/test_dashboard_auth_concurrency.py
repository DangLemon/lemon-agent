"""Dashboard auth concurrency invariants."""
from __future__ import annotations

import asyncio
import threading
import time

import httpx
import pytest

from lemon_cli import web_server
from lemon_cli.dashboard_auth import DashboardAuthProvider, LoginStart, Session, TokenPrincipal
from lemon_cli.dashboard_auth import clear_providers, register_provider
from lemon_cli.dashboard_auth import token_auth
from lemon_cli.dashboard_auth.cookies import SESSION_AT_COOKIE, SESSION_RT_COOKIE


class _SlowVerifyProvider(DashboardAuthProvider):
    name = "slow-verify"
    display_name = "Slow Verify"
    supports_token = True

    def __init__(self) -> None:
        self.started = threading.Event()
        self.release = threading.Event()
        self.finished = threading.Event()

    def start_login(self, *, redirect_uri: str) -> LoginStart:
        return LoginStart(redirect_url=redirect_uri, cookie_payload={})

    def complete_login(self, *, code: str, state: str, code_verifier: str, redirect_uri: str) -> Session:
        return _session(self.name, access_token="valid-at", refresh_token="rt")

    def verify_session(self, *, access_token: str) -> Session | None:
        self.started.set()
        # The public request releases this provider. On unfixed code the loop
        # cannot make that request until this bounded safety wait expires.
        self.release.wait(6.0)
        self.finished.set()
        if access_token != "valid-at":
            return None
        return _session(self.name, access_token=access_token, refresh_token="")

    def verify_token(self, *, token: str) -> TokenPrincipal | None:
        session = self.verify_session(access_token=token)
        return None if session is None else TokenPrincipal(session.user_id, self.name, ())

    def refresh_session(self, *, refresh_token: str) -> Session:
        return _session(self.name, access_token="valid-at", refresh_token="rotated-rt")

    def revoke_session(self, *, refresh_token: str) -> None:
        return None


class _RotatingRefreshProvider(DashboardAuthProvider):
    name = "rotating"
    display_name = "Rotating Refresh"

    def __init__(self) -> None:
        self.calls: list[str] = []
        self._lock = threading.Lock()

    def start_login(self, *, redirect_uri: str) -> LoginStart:
        return LoginStart(redirect_url=redirect_uri, cookie_payload={})

    def complete_login(self, *, code: str, state: str, code_verifier: str, redirect_uri: str) -> Session:
        return _session(self.name, access_token="valid-at", refresh_token="initial-rt")

    def verify_session(self, *, access_token: str) -> Session | None:
        return None

    def refresh_session(self, *, refresh_token: str) -> Session:
        time.sleep(2.1)
        with self._lock:
            self.calls.append(refresh_token)
            if self.calls.count(refresh_token) > 1:
                from lemon_cli.dashboard_auth.base import RefreshExpiredError

                raise RefreshExpiredError("refresh token reuse detected")
        return _session(self.name, access_token="rotated-at", refresh_token="rotated-rt")

    def revoke_session(self, *, refresh_token: str) -> None:
        return None


def _session(provider: str, *, access_token: str, refresh_token: str) -> Session:
    return Session(
        user_id="user-1",
        email="user@example.test",
        display_name="User One",
        org_id="org-1",
        provider=provider,
        expires_at=int(time.time()) + 3600,
        access_token=access_token,
        refresh_token=refresh_token,
    )


@pytest.fixture(autouse=True)
def _gated_dashboard_state():
    clear_providers()
    prev_host = getattr(web_server.app.state, "bound_host", None)
    prev_port = getattr(web_server.app.state, "bound_port", None)
    prev_required = getattr(web_server.app.state, "auth_required", None)
    web_server.app.state.bound_host = "127.0.0.1"
    web_server.app.state.bound_port = 80
    web_server.app.state.auth_required = True
    yield
    clear_providers()
    web_server.app.state.bound_host = prev_host
    web_server.app.state.bound_port = prev_port
    web_server.app.state.auth_required = prev_required


@pytest.mark.asyncio
@pytest.mark.parametrize("auth_kind", ["bearer", "cookie", "service"])
async def test_session_verify_runs_off_event_loop(auth_kind, monkeypatch):
    provider = _SlowVerifyProvider()
    register_provider(provider)
    if auth_kind == "service":
        monkeypatch.setattr(token_auth, "_token_routes", {"/api/sessions"})
    headers = (
        {"Cookie": f"{SESSION_AT_COOKIE}=valid-at"}
        if auth_kind == "cookie" else {"Authorization": "Bearer valid-at"}
    )
    transport = httpx.ASGITransport(app=web_server.app)
    async with httpx.AsyncClient(transport=transport, base_url="http://127.0.0.1") as client:
        request_task = asyncio.create_task(
            client.get("/api/sessions?limit=1", headers=headers)
        )
        try:
            assert await asyncio.to_thread(provider.started.wait, 3.0)
            status_response = await asyncio.wait_for(client.get("/api/status"), timeout=3.0)
            assert status_response.status_code == 200
            assert not provider.finished.is_set(), "public request must finish while provider I/O is pending"
        finally:
            provider.release.set()
            response = await request_task
    assert response.status_code == 200


@pytest.mark.asyncio
async def test_parallel_rotating_refresh_reuses_inflight_result():
    provider = _RotatingRefreshProvider()
    register_provider(provider)
    cookies = f"{SESSION_RT_COOKIE}=initial-rt; lemon_session_provider={provider.name}"
    transport = httpx.ASGITransport(app=web_server.app)
    async with httpx.AsyncClient(transport=transport, base_url="http://127.0.0.1") as client:
        responses = await asyncio.gather(*[
            client.get("/api/sessions?limit=1", headers={"Cookie": cookies}) for _ in range(2)
        ])

    assert [response.status_code for response in responses] == [200, 200]
    assert provider.calls == ["initial-rt"]
    for response in responses:
        set_cookies = response.headers.get_list("set-cookie")
        assert any(SESSION_RT_COOKIE in cookie and "rotated-rt" in cookie for cookie in set_cookies)
        assert not any(SESSION_RT_COOKIE in cookie and "Max-Age=0" in cookie for cookie in set_cookies)
