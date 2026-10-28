import pytest

from lemon_state import SessionDB


ARTIFACTS = [{
    "id": "0123456789abcdef0123456789abcdef",
    "filename": "report.zip",
    "content_type": "application/zip",
    "size_bytes": 128,
    "sha256": "a" * 64,
    "expires_at": 1_800_000_000.0,
}]


@pytest.fixture
def db(tmp_path):
    return SessionDB(tmp_path / "state.db")


def test_provider_artifact_metadata_survives_resume_and_branch_copy(db):
    db.create_session("source", source="desktop")
    db.append_message("source", role="user", content="make a zip")
    db.append_message(
        "source", role="assistant", content="Done.",
        display_metadata={"provider_artifacts": ARTIFACTS},
    )

    _, display = db.get_resume_conversations("source")
    assistant = next(message for message in display if message["role"] == "assistant")
    assert assistant["display_metadata"]["provider_artifacts"] == ARTIFACTS

    db.create_session("branch", source="desktop", parent_session_id="source")
    db.replace_messages("branch", display)
    branched = db.get_messages_as_conversation("branch")
    copied = next(message for message in branched if message["role"] == "assistant")
    assert copied["display_metadata"]["provider_artifacts"] == ARTIFACTS
