import asyncio

import pytest
from starlette.responses import StreamingResponse

from lemon_cli.web_routers.files import _ProviderArtifactStreamingResponse


@pytest.mark.asyncio
async def test_provider_artifact_response_closes_handle_if_start_fails(tmp_path, monkeypatch):
    path = tmp_path / "artifact"
    path.write_bytes(b"payload")
    handle = path.open("rb")
    response = _ProviderArtifactStreamingResponse(handle, content=b"payload", media_type="application/zip")

    async def fail_before_body(*_args):
        raise RuntimeError("client disconnected")

    monkeypatch.setattr(StreamingResponse, "__call__", fail_before_body)
    with pytest.raises(RuntimeError, match="client disconnected"):
        await response({}, None, None)

    assert handle.closed


@pytest.mark.asyncio
async def test_provider_artifact_response_closes_handle_on_task_cancellation(tmp_path, monkeypatch):
    path = tmp_path / "artifact"
    path.write_bytes(b"payload")
    handle = path.open("rb")
    response = _ProviderArtifactStreamingResponse(handle, content=b"payload", media_type="application/zip")

    async def cancel_super_call(*_args):
        raise asyncio.CancelledError

    monkeypatch.setattr(StreamingResponse, "__call__", cancel_super_call)
    with pytest.raises(asyncio.CancelledError):
        await response({}, None, None)

    assert handle.closed
    assert response.body_iterator.ag_frame is None
