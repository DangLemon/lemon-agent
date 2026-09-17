"""Regression tests for install.sh Lemon AI user-facing copy."""

from __future__ import annotations

import os
import subprocess
import tempfile
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parent.parent
INSTALL_SH = REPO_ROOT / "scripts" / "install.sh"



def test_install_sh_config_stage_emits_lemon_diagnostics_and_seed() -> None:
    with tempfile.TemporaryDirectory() as raw_tmp:
        tmp = Path(raw_tmp)
        home = tmp / "home"
        install_dir = tmp / "install"
        lemon_home = home / ".lemon-ai"
        install_dir.mkdir(parents=True)
        home.mkdir()
        (install_dir / (".env" + ".example")).write_text("DUMMY_KEY=\n", encoding="utf-8")
        (install_dir / "cli-config.yaml.example").write_text("profiles: {}\n", encoding="utf-8")

        env = os.environ.copy()
        env.update({"HOME": str(home), "LEMON_INSTALLER_BRAND": "lemon"})

        result = subprocess.run(
            [
                "bash",
                str(INSTALL_SH),
                "--stage",
                "config",
                "--non-interactive",
                "--json",
                "--dir",
                str(install_dir),
                "--lemon-home",
                str(lemon_home),
            ],
            env=env,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            check=True,
        )

        assert f"Lemon AI home: {lemon_home}" in result.stdout
        assert f"Lemon AI install root: {install_dir}" in result.stdout
        assert "Lemon AI runtime dir: lemon-agent" in result.stdout
        assert "Lemon AI CLI command: lemon config" in result.stdout
        assert '"ok":true' in result.stdout.replace(" ", "")

        soul = (lemon_home / "SOUL.md").read_text(encoding="utf-8")
        assert "You are Lemon AI, built by Lemon Digital." in soul
        assert "Hermes" not in soul
        assert "Nous Research" not in soul


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print(f"PASS {name}")
