from __future__ import annotations

import os
import re
from pathlib import Path

from .models import Work


RJ_PATTERN = re.compile(r"(?i)(RJ\d{6,9})")


def extract_rj(name: str) -> str | None:
    match = RJ_PATTERN.search(name)
    return match.group(1).upper() if match else None


def extract_local_title(folder_name: str, rj: str) -> str:
    title = RJ_PATTERN.sub("", folder_name, count=1)
    return title.strip(" []　-_")


def scan_library(root: str) -> list[Work]:
    root_path = Path(root).expanduser()
    if not root_path.exists():
        raise FileNotFoundError(f"目录不存在：{root}")
    if not root_path.is_dir():
        raise NotADirectoryError(f"不是文件夹：{root}")

    works: dict[str, Work] = {}
    claimed_roots: list[Path] = []

    for current, dirnames, _filenames in os.walk(root_path):
        current_path = Path(current)
        if any(_is_relative_to(current_path, claimed) for claimed in claimed_roots):
            dirnames[:] = []
            continue

        rj = extract_rj(current_path.name)
        if not rj:
            continue

        claimed_roots.append(current_path)
        dirnames[:] = []

        local_title = extract_local_title(current_path.name, rj)
        work = works.setdefault(rj, Work(rj=rj, local_title=local_title))
        if not work.local_title and local_title:
            work.local_title = local_title

        path_text = str(current_path)
        if path_text not in work.local_paths:
            work.local_paths.append(path_text)

    return sorted(works.values(), key=lambda item: item.rj)


def _is_relative_to(path: Path, parent: Path) -> bool:
    try:
        path.relative_to(parent)
        return path != parent
    except ValueError:
        return False

