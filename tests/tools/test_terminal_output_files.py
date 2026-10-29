import json
from pathlib import Path

import pytest

from tools import terminal_tool as terminal_module


@pytest.fixture
def isolated_home(tmp_path, monkeypatch):
    monkeypatch.setenv("LEMON_HOME", str(tmp_path / ".lemon-ai"))
    return tmp_path


def test_foreground_local_command_returns_declared_file(isolated_home, tmp_path):
    result = json.loads(terminal_module.terminal_tool(
        "printf workbook > report.xlsx",
        workdir=str(tmp_path),
        task_id="terminal-output-success",
        output_files=["report.xlsx"],
    ))

    expected = str(Path(tmp_path, "report.xlsx").resolve())
    assert result["exit_code"] == 0
    assert result["files_created"] == [expected]
    assert result["output_file"] == expected


def test_failed_command_does_not_return_declared_file(isolated_home, tmp_path):
    result = json.loads(terminal_module.terminal_tool(
        "printf partial > partial.xlsx; exit 7",
        workdir=str(tmp_path),
        task_id="terminal-output-failure",
        output_files=["partial.xlsx"],
    ))

    assert result["exit_code"] == 7
    assert "files_created" not in result
    assert "output_file" not in result


def test_invalid_declaration_is_rejected_before_command_runs(isolated_home, tmp_path):
    marker = tmp_path / "ran.txt"
    result = json.loads(terminal_module.terminal_tool(
        "printf ran > ran.txt",
        workdir=str(tmp_path),
        task_id="terminal-output-invalid",
        output_files=[str(tmp_path / "report.xlsx")],
    ))

    assert result["status"] == "error"
    assert "relative paths" in result["error"]
    assert not marker.exists()


def test_background_output_declaration_is_rejected(isolated_home, tmp_path):
    result = json.loads(terminal_module.terminal_tool(
        "printf workbook > report.xlsx",
        background=True,
        workdir=str(tmp_path),
        task_id="terminal-output-background",
        output_files=["report.xlsx"],
    ))

    assert result["status"] == "error"
    assert "foreground" in result["error"]
    assert not (tmp_path / "report.xlsx").exists()


def test_remote_output_declaration_is_rejected_before_command_runs(
    isolated_home, tmp_path, monkeypatch,
):
    monkeypatch.setattr(
        terminal_module,
        "_plan_execution",
        lambda *_args, **_kwargs: terminal_module._ExecPlan(
            config={},
            env_type="ssh",
            effective_task_id="terminal-output-remote",
            image=None,
            cwd=str(tmp_path),
            host_cwd=None,
            effective_timeout=30,
        ),
    )
    monkeypatch.setattr(
        terminal_module,
        "_acquire_env",
        lambda *_args, **_kwargs: pytest.fail("remote environment must not start"),
    )

    result = json.loads(terminal_module.terminal_tool(
        "printf workbook > report.xlsx",
        task_id="terminal-output-remote",
        output_files=["report.xlsx"],
    ))

    assert result["status"] == "error"
    assert "local terminal backend" in result["error"]


def test_multiple_declared_files_have_no_single_output_alias(isolated_home, tmp_path):
    result = json.loads(terminal_module.terminal_tool(
        "printf a > a.xlsx; printf b > b.xlsx",
        workdir=str(tmp_path),
        task_id="terminal-output-multiple",
        output_files=["a.xlsx", "b.xlsx"],
    ))

    assert result["exit_code"] == 0
    assert result["files_created"] == [
        str(Path(tmp_path, name).resolve()) for name in ("a.xlsx", "b.xlsx")
    ]
    assert "output_file" not in result


def test_schema_and_handler_forward_output_files(monkeypatch):
    captured = {}

    def fake_terminal_tool(**kwargs):
        captured.update(kwargs)
        return "{}"

    monkeypatch.setattr(terminal_module, "terminal_tool", fake_terminal_tool)

    terminal_module._handle_terminal({
        "command": "printf workbook > report.xlsx",
        "output_files": ["report.xlsx"],
    }, task_id="terminal-output-handler")

    assert "output_files" in terminal_module.TERMINAL_SCHEMA["parameters"]["properties"]
    assert captured["output_files"] == ["report.xlsx"]
