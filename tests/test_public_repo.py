from __future__ import annotations

import subprocess
from pathlib import Path

from scripts import check_public_repo


def test_internal_records_are_ignored_and_rejected_but_index_is_publishable(tmp_path: Path) -> None:
    private_paths = [
        "AGENTS.md",
        "docs/dev/dev-log-example.md",
        "docs/DEVLOG/dev/dev-log-example.md",
        "docs/DEVLOG/dev/v1/prd-example.md",
        "data/library.sqlite3",
        "reports/example.html",
        ".env",
    ]
    public_paths = ["docs/PROJECT-STRUCTURE.md", "README.md", "README.zh-CN.md"]
    (tmp_path / ".gitignore").write_bytes((check_public_repo.ROOT / ".gitignore").read_bytes())
    subprocess.run(["git", "init", "--quiet", str(tmp_path)], check=True, capture_output=True)
    ignored = subprocess.run(
        ["git", "-c", f"safe.directory={tmp_path.as_posix()}", "check-ignore", "--stdin", "-z"],
        input=("\0".join(private_paths + public_paths) + "\0").encode("utf-8"),
        cwd=tmp_path,
        capture_output=True,
        check=True,
    )

    assert set(ignored.stdout.decode("utf-8").strip("\0").split("\0")) == set(private_paths)
    for path in private_paths:
        assert check_public_repo.path_findings(path), path
    for path in public_paths:
        assert check_public_repo.path_findings(path) == [], path
