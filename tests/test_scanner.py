from __future__ import annotations

from pathlib import Path

from dlsite_tool.scanner import extract_local_title, extract_rj, scan_library


def test_extract_rj_and_local_title() -> None:
    name = "RJ00000001 示例作品标题"
    assert extract_rj(name) == "RJ00000001"
    assert extract_local_title(name, "RJ00000001") == "示例作品标题"


def test_scan_uses_highest_rj_directory(tmp_path: Path) -> None:
    work = tmp_path / "RJ00000001 示例作品标题"
    (work / "音声" / "SEあり").mkdir(parents=True)
    (work / "イラスト").mkdir()

    result = scan_library(str(tmp_path))

    assert len(result) == 1
    assert result[0].rj == "RJ00000001"
    assert result[0].local_paths == [str(work)]
