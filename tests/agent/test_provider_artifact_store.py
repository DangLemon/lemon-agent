import hashlib

import pytest

from agent.provider_artifacts import ProviderArtifactStore, ProviderArtifactError


def test_store_round_trips_immutable_artifact_and_expires_after_thirty_days(tmp_path):
    now = [1_000.0]
    store = ProviderArtifactStore(tmp_path / "default", clock=lambda: now[0])
    other_profile = ProviderArtifactStore(tmp_path / "research", clock=lambda: now[0])
    default_again = ProviderArtifactStore(tmp_path / "default", clock=lambda: now[0])

    ref = store.store(b"zip-payload", filename="report.zip", content_type="application/zip")

    restart = ProviderArtifactStore(tmp_path / "default", clock=lambda: now[0])
    restored_ref = type(ref).from_dict(ref.to_dict())

    assert restored_ref == ref
    assert restart.read(ref.artifact_id, ref=restored_ref) == b"zip-payload"
    assert len(ref.artifact_id) == 32
    assert ref.filename == "report.zip"
    assert ref.size_bytes == 11
    assert ref.sha256 == hashlib.sha256(b"zip-payload").hexdigest()
    assert store.read(ref.artifact_id, ref=ref) == b"zip-payload"
    with pytest.raises(ProviderArtifactError):
        other_profile.read(ref.artifact_id, ref=ref)
    assert default_again.read(ref.artifact_id, ref=ref) == b"zip-payload"

    now[0] += 30 * 24 * 60 * 60 + 1
    with pytest.raises(ProviderArtifactError):
        store.read(ref.artifact_id, ref=ref)
    assert store.prune_expired({ref.artifact_id: ref.expires_at}) == 1
    assert not (store.root / ref.artifact_id).exists()


def test_store_stream_enforces_cap_and_removes_partial_object(tmp_path):
    store = ProviderArtifactStore(tmp_path, max_bytes=3)

    with pytest.raises(ProviderArtifactError):
        store.store_stream(iter([b"ab", b"cd"]), filename="report.zip", content_type="application/zip")

    assert sorted(path.name for path in tmp_path.iterdir()) == [".store.lock", "lemon_test"]


def test_store_caps_bytes_and_sanitizes_untrusted_filename(tmp_path):
    store = ProviderArtifactStore(tmp_path, max_bytes=3)

    with pytest.raises(ProviderArtifactError):
        store.store(b"four", filename="report.zip", content_type="application/zip")
    ref = store.store(b"abc", filename="../report.zip", content_type="application/zip")

    assert ref.filename == "report.zip"
    assert sorted(path.name for path in tmp_path.iterdir()) == sorted({".store.lock", "lemon_test", ref.artifact_id})
