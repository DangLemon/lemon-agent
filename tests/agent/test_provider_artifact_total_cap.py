import time

import pytest

from agent.provider_artifacts import ProviderArtifactError, ProviderArtifactStore


def test_store_prunes_expired_artifacts_before_enforcing_total_cap(tmp_path):
    now = [time.time()]
    store = ProviderArtifactStore(tmp_path, max_bytes=4, max_total_bytes=4, ttl_seconds=10, clock=lambda: now[0])
    store.store(b"1234", filename="old.txt", content_type="text/plain")
    now[0] += 11

    assert store.store(b"5678", filename="new.txt", content_type="text/plain").size_bytes == 4
    assert len([path for path in tmp_path.iterdir() if len(path.name) == 32]) == 1


def test_store_enforces_a_profile_wide_cap_across_store_instances(tmp_path):
    first = ProviderArtifactStore(tmp_path, max_bytes=4, max_total_bytes=6)
    second = ProviderArtifactStore(tmp_path, max_bytes=4, max_total_bytes=6)

    first.store(b"1234", filename="one.txt", content_type="text/plain")

    with pytest.raises(ProviderArtifactError, match="total byte cap"):
        second.store(b"567", filename="two.txt", content_type="text/plain")

    restored = ProviderArtifactStore(tmp_path, max_bytes=4, max_total_bytes=6)
    assert sum(path.stat().st_size for path in tmp_path.iterdir() if path.is_file()) == 4
    assert len([path for path in tmp_path.iterdir() if len(path.name) == 32]) == 1
    assert restored.store(b"56", filename="two.txt", content_type="text/plain").size_bytes == 2
