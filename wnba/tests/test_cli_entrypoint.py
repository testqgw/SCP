from __future__ import annotations

import subprocess
import sys


def test_cli_module_entrypoint_prints_help() -> None:
    result = subprocess.run(
        [sys.executable, "-m", "wnba_prop_model.cli", "--help"],
        capture_output=True,
        check=False,
        text=True,
    )

    assert result.returncode == 0
    assert "WNBA player prop model toolkit" in result.stdout
