from __future__ import annotations

import errno
import hashlib
import logging
import mimetypes
import os
import re
import secrets
import stat
import threading
import time
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

_ARTIFACT_ID_RE = re.compile(r"^[0-9a-f]{32}$")
_PROVIDER_FILE_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,128}$")
_FILENAME_RE = re.compile(r"[^A-Za-z0-9._ -]+")
_DEFAULT_TTL_SECONDS = 30 * 24 * 60 * 60
_DEFAULT_MAX_BYTES = 100 * 1024 * 1024
_DEFAULT_MAX_TOTAL_BYTES = 1024 * 1024 * 1024
logger = logging.getLogger(__name__)


@contextmanager
def _windows_profile_file_lock(path: Path):
    import msvcrt

    try:
        handle = open(path, "x+b")
    except FileExistsError:
        handle = open(path, "r+b")
    locked = False
    try:
        if handle.seek(0, os.SEEK_END) == 0:
            handle.write(b"\0")
            handle.flush()
        handle.seek(0)
        while True:
            try:
                msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
                locked = True
                break
            except OSError as exc:
                if exc.errno not in {errno.EACCES, errno.EDEADLK, errno.EAGAIN}:
                    raise
                time.sleep(0.05)
        yield
    finally:
        if locked:
            handle.seek(0)
            msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
        handle.close()


@contextmanager
def _profile_file_lock(path: Path):
    if os.name == "nt":
        with _windows_profile_file_lock(path):
            yield
        return

    import fcntl

    with open(path, "a+b") as handle:
        fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(handle.fileno(), fcntl.LOCK_UN)


_ALLOWED_MIME_TYPES = frozenset({
    "application/json", "application/octet-stream", "application/pdf", "application/zip",
    "image/gif", "image/jpeg", "image/png", "image/webp", "text/csv", "text/html", "text/plain",
})


class ProviderArtifactError(ValueError):
    pass


@dataclass(frozen=True)
class ProviderArtifactRef:
    artifact_id: str
    filename: str
    content_type: str
    size_bytes: int
    sha256: str
    expires_at: float

    def to_dict(self) -> dict:
        return {
            "id": self.artifact_id,
            "filename": self.filename,
            "content_type": self.content_type,
            "size_bytes": self.size_bytes,
            "sha256": self.sha256,
            "expires_at": self.expires_at,
        }

    @staticmethod
    def _safe_filename_is_valid(filename: str) -> bool:
        name = Path(filename.replace("\\", "/")).name
        safe = _FILENAME_RE.sub("_", name).strip(" .")[:120]
        return bool(safe) and filename == safe

    @classmethod
    def from_dict(cls, value: object) -> "ProviderArtifactRef | None":
        if not isinstance(value, dict):
            return None
        artifact_id, filename = value.get("id"), value.get("filename")
        content_type, size_bytes = value.get("content_type"), value.get("size_bytes")
        sha256, expires_at = value.get("sha256"), value.get("expires_at")
        if not (
            isinstance(artifact_id, str) and _ARTIFACT_ID_RE.fullmatch(artifact_id)
            and isinstance(filename, str) and filename and cls._safe_filename_is_valid(filename)
            and isinstance(content_type, str) and content_type in _ALLOWED_MIME_TYPES
            and isinstance(size_bytes, int) and not isinstance(size_bytes, bool) and 0 <= size_bytes <= _DEFAULT_MAX_BYTES
            and isinstance(sha256, str) and re.fullmatch(r"[0-9a-f]{64}", sha256)
            and isinstance(expires_at, (int, float)) and not isinstance(expires_at, bool)
        ):
            return None
        return cls(artifact_id, filename, content_type, size_bytes, sha256, float(expires_at))


class ProviderArtifactStore:
    _root_locks: dict[Path, threading.RLock] = {}
    _root_locks_guard = threading.Lock()

    def __init__(
        self, root: Path, *, max_bytes: int = _DEFAULT_MAX_BYTES,
        max_total_bytes: int = _DEFAULT_MAX_TOTAL_BYTES, ttl_seconds: int = _DEFAULT_TTL_SECONDS,
        clock: Callable[[], float] = time.time,
    ) -> None:
        self.root = Path(root).resolve()
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.max_bytes = max(1, int(max_bytes))
        self.max_total_bytes = max(self.max_bytes, int(max_total_bytes))
        self.ttl_seconds = max(1, int(ttl_seconds))
        self.clock = clock
        with self._root_locks_guard:
            self._lock = self._root_locks.setdefault(self.root, threading.RLock())

    def _stored_bytes(self) -> int:
        total = 0
        for path in self.root.iterdir():
            try:
                if _ARTIFACT_ID_RE.fullmatch(path.name) and path.is_file() and not path.is_symlink():
                    total += path.stat().st_size
            except OSError:
                continue
        return total

    @staticmethod
    def _safe_filename(filename: str) -> str:
        name = Path(filename.replace("\\", "/")).name
        name = _FILENAME_RE.sub("_", name).strip(" .")[:120]
        if not name or name in {".", ".."}:
            raise ProviderArtifactError("invalid artifact filename")
        return name

    def store(self, data: bytes, *, filename: str, content_type: str) -> ProviderArtifactRef:
        if not isinstance(data, bytes) or not data:
            raise ProviderArtifactError("artifact is empty")
        return self.store_stream(iter((data,)), filename=filename, content_type=content_type)

    def store_stream(self, chunks, *, filename: str, content_type: str) -> ProviderArtifactRef:
        normalized_type = str(content_type or "application/octet-stream").split(";", 1)[0].lower().strip()
        if normalized_type not in _ALLOWED_MIME_TYPES:
            raise ProviderArtifactError("unsupported artifact content type")
        safe_name = self._safe_filename(filename)
        now = self.clock()
        with self._lock, _profile_file_lock(self.root / ".store.lock"):
            self._prune_expired()
            while True:
                artifact_id = secrets.token_hex(16)
                target = self.root / artifact_id
                if not target.exists():
                    break
            temp = self.root / f".{artifact_id}.tmp"
            digest = hashlib.sha256()
            size_bytes = 0
            remaining_bytes = self.max_total_bytes - self._stored_bytes()
            try:
                fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
                with os.fdopen(fd, "wb") as handle:
                    for chunk in chunks:
                        if not isinstance(chunk, bytes):
                            raise ProviderArtifactError("artifact stream returned non-bytes content")
                        next_size = size_bytes + len(chunk)
                        if next_size > self.max_bytes:
                            raise ProviderArtifactError("artifact exceeds the byte cap")
                        if next_size > remaining_bytes:
                            raise ProviderArtifactError("provider artifacts exceed the total byte cap")
                        size_bytes = next_size
                        handle.write(chunk)
                        digest.update(chunk)
                    if not size_bytes:
                        raise ProviderArtifactError("artifact is empty")
                    handle.flush()
                    os.fsync(handle.fileno())
                os.replace(temp, target)
            except Exception:
                temp.unlink(missing_ok=True)
                target.unlink(missing_ok=True)
                raise
        return ProviderArtifactRef(
            artifact_id, safe_name, normalized_type, size_bytes, digest.hexdigest(), now + self.ttl_seconds,
        )

    def _validated_path(self, artifact_id: str, *, ref: ProviderArtifactRef) -> Path:
        if not _ARTIFACT_ID_RE.fullmatch(str(artifact_id or "")) or artifact_id != ref.artifact_id:
            raise ProviderArtifactError("invalid artifact id")
        if ref.expires_at <= self.clock():
            raise ProviderArtifactError("artifact expired")
        path = self.root / artifact_id
        try:
            if path.parent.resolve() != self.root or path.is_symlink() or not path.is_file():
                raise ProviderArtifactError("artifact not found")
            if path.stat().st_size != ref.size_bytes or path.stat().st_size > self.max_bytes:
                raise ProviderArtifactError("artifact size mismatch")
        except OSError as exc:
            raise ProviderArtifactError("artifact not found") from exc
        return path

    def open_verified(self, artifact_id: str, *, ref: ProviderArtifactRef):
        """Return the open handle after verifying it, positioned at byte zero."""
        path = self._validated_path(artifact_id, ref=ref)
        flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
        try:
            handle = os.fdopen(os.open(path, flags), "rb")
        except OSError as exc:
            raise ProviderArtifactError("artifact not found") from exc
        try:
            file_stat = os.fstat(handle.fileno())
            if not stat.S_ISREG(file_stat.st_mode) or file_stat.st_size != ref.size_bytes:
                raise ProviderArtifactError("artifact size mismatch")
            digest = hashlib.sha256()
            size_bytes = 0
            for chunk in iter(lambda: handle.read(64 * 1024), b""):
                size_bytes += len(chunk)
                if size_bytes > self.max_bytes or size_bytes > ref.size_bytes:
                    raise ProviderArtifactError("artifact size mismatch")
                digest.update(chunk)
            if size_bytes != ref.size_bytes or digest.hexdigest() != ref.sha256:
                raise ProviderArtifactError("artifact checksum mismatch")
            handle.seek(0)
            return handle
        except Exception:
            handle.close()
            raise

    def read(self, artifact_id: str, *, ref: ProviderArtifactRef) -> bytes:
        path = self._validated_path(artifact_id, ref=ref)
        try:
            data = path.read_bytes()
        except OSError as exc:
            raise ProviderArtifactError("artifact not found") from exc
        if hashlib.sha256(data).hexdigest() != ref.sha256:
            raise ProviderArtifactError("artifact checksum mismatch")
        return data

    def delete(self, artifact_id: str) -> None:
        if _ARTIFACT_ID_RE.fullmatch(str(artifact_id or "")):
            (self.root / artifact_id).unlink(missing_ok=True)

    def _prune_expired(self, referenced: dict[str, float] | None = None) -> int:
        now, referenced = self.clock(), referenced or {}
        removed = 0
        for path in self.root.iterdir():
            try:
                if path.name.endswith(".tmp"):
                    if path.is_file() and path.stat().st_mtime <= now - 60:
                        path.unlink(missing_ok=True)
                        removed += 1
                elif _ARTIFACT_ID_RE.fullmatch(path.name) and path.name not in referenced:
                    if path.is_file() and path.stat().st_mtime <= now - self.ttl_seconds:
                        path.unlink(missing_ok=True)
                        removed += 1
                elif _ARTIFACT_ID_RE.fullmatch(path.name):
                    expires_at = referenced.get(path.name)
                    expired = expires_at <= now if expires_at is not None else path.stat().st_mtime <= now - self.ttl_seconds
                    if expired:
                        path.unlink(missing_ok=True)
                        removed += 1
            except OSError:
                logger.debug("provider artifact cleanup failed for %s", path.name, exc_info=True)
        return removed

    def prune_expired(self, referenced: dict[str, float] | None = None) -> int:
        with self._lock, _profile_file_lock(self.root / ".store.lock"):
            return self._prune_expired(referenced)


def materialize_provider_citations(agent: Any, citations: list[dict]) -> list[ProviderArtifactRef]:
    """Fetch citations only through the direct OpenAI API-key Responses client."""
    if not (
        getattr(agent, "provider", None) == "openai-api"
        and getattr(agent, "api_mode", None) == "codex_responses"
        and str(getattr(agent, "base_url", "") or "").rstrip("/") == "https://api.openai.com/v1"
        and bool(str(getattr(agent, "api_key", "") or "").strip())
        and getattr(getattr(agent, "client", None), "with_streaming_response", None) is not None
    ):
        return []

    from lemon_constants import get_lemon_home
    from lemon_cli.profiles import get_active_profile_name
    profile = get_active_profile_name() or "default"
    if profile == "custom":
        home = get_lemon_home()
    else:
        from lemon_cli.web_server_cron import _cron_profile_home
        _profile_name, home = _cron_profile_home(profile)
    store = ProviderArtifactStore(home / "cache" / "provider-artifacts")
    store.prune_expired()
    client = agent.client
    refs = []
    for citation in citations[:32]:
        if not isinstance(citation, dict):
            continue
        container_id, file_id = citation.get("container_id"), citation.get("file_id")
        if not (
            isinstance(container_id, str) and _PROVIDER_FILE_ID_RE.fullmatch(container_id)
            and isinstance(file_id, str) and _PROVIDER_FILE_ID_RE.fullmatch(file_id)
            and isinstance(citation.get("filename"), str)
        ):
            continue
        try:
            content_route = client.with_streaming_response.containers.files.content.retrieve
            with content_route(container_id=container_id, file_id=file_id, timeout=60) as response:
                mime = response.response.headers.get("content-type", "application/octet-stream")
                ref = store.store_stream(response.iter_bytes(chunk_size=64 * 1024),
                                         filename=citation["filename"], content_type=mime)
            refs.append(ref)
        except Exception:
            logger.warning("OpenAI container file retrieval failed; keeping assistant text", exc_info=True)
    return refs
