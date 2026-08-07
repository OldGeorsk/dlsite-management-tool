from __future__ import annotations

import re
from collections import Counter
from pathlib import Path
from typing import Iterable

from .models import STATUS_FAILED, STATUS_PARTIAL, STATUS_SUCCESS, STATUS_UNFETCHED, Work


VALID_STATUSES = (STATUS_UNFETCHED, STATUS_SUCCESS, STATUS_PARTIAL, STATUS_FAILED)
YEAR_PATTERN = re.compile(r"(?<!\d)(\d{4})(?!\d)")
VOICE_ACTOR_SEPARATOR = re.compile(r"\s+/\s+")


def _unique(values: Iterable[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for raw in values:
        value = raw.strip()
        if value and value not in seen:
            seen.add(value)
            result.append(value)
    return result


def split_voice_actors(value: str) -> list[str]:
    """Split the scraper's actor separator without splitting slashes inside names."""
    return _unique(VOICE_ACTOR_SEPARATOR.split(value.strip())) if value.strip() else []


def split_tags(value: str) -> list[str]:
    """DLsite tags are separated by whitespace; a slash may belong to one tag."""
    return _unique(value.split())


def split_circles(value: str) -> list[str]:
    return _unique([value])


def extract_release_year(value: str) -> str:
    match = YEAR_PATTERN.search(value)
    return match.group(1) if match else ""


def entities_for_work(work: Work, dimension: str) -> list[str]:
    if dimension == "tags":
        return split_tags(work.tags)
    if dimension == "voice_actors":
        return split_voice_actors(work.voice_actors)
    if dimension == "circles":
        return split_circles(work.circle)
    raise ValueError(f"未知统计维度：{dimension}")


def validate_filters(release_year: str = "", status: str = "") -> None:
    if release_year and not re.fullmatch(r"\d{4}", release_year):
        raise ValueError("发售年份必须是四位数字")
    if status and status not in VALID_STATUSES:
        raise ValueError("抓取状态无效")


def filter_works(
    works: Iterable[Work],
    *,
    release_year: str = "",
    status: str = "",
    path: str = "",
    tag: str = "",
    voice_actor: str = "",
    circle: str = "",
) -> list[Work]:
    validate_filters(release_year, status)
    path_query = path.strip().casefold()
    result: list[Work] = []

    for work in works:
        if release_year and extract_release_year(work.release_date) != release_year:
            continue
        if status and work.fetch_status != status:
            continue
        if path_query and not any(path_query in item.casefold() for item in work.local_paths):
            continue
        if tag and tag not in split_tags(work.tags):
            continue
        if voice_actor and voice_actor not in split_voice_actors(work.voice_actors):
            continue
        if circle and circle not in split_circles(work.circle):
            continue
        result.append(work)
    return result


def build_stats(
    works: Iterable[Work],
    *,
    release_year: str = "",
    status: str = "",
    path: str = "",
) -> dict[str, object]:
    all_works = list(works)
    selected = filter_works(
        all_works,
        release_year=release_year,
        status=status,
        path=path,
    )
    total = len(selected)

    rankings = {
        dimension: _ranking(selected, dimension, total)
        for dimension in ("tags", "voice_actors", "circles")
    }
    coverage = {
        "tags": _coverage(sum(bool(split_tags(work.tags)) for work in selected), total),
        "voice_actors": _coverage(
            sum(bool(split_voice_actors(work.voice_actors)) for work in selected), total
        ),
        "circles": _coverage(sum(bool(split_circles(work.circle)) for work in selected), total),
        "release_year": _coverage(
            sum(bool(extract_release_year(work.release_date)) for work in selected), total
        ),
    }
    years = Counter(filter(None, (extract_release_year(work.release_date) for work in selected)))
    statuses = Counter(work.fetch_status for work in selected)

    return {
        "filters": {
            "release_year": release_year,
            "status": status,
            "path": path,
        },
        "options": {
            "release_years": sorted(
                {year for work in all_works if (year := extract_release_year(work.release_date))},
                reverse=True,
            ),
            "statuses": list(VALID_STATUSES),
            "paths": _path_suggestions(all_works),
        },
        "summary": {
            "total_works": total,
            "all_works": len(all_works),
            "coverage": coverage,
            "insights": _build_insights(total, rankings, years, coverage),
        },
        "rankings": rankings,
        "release_years": [
            {"year": year, "count": count, "percentage": _percentage(count, total)}
            for year, count in sorted(years.items())
        ],
        "fetch_statuses": [
            {
                "status": item,
                "count": statuses.get(item, 0),
                "percentage": _percentage(statuses.get(item, 0), total),
            }
            for item in VALID_STATUSES
        ],
    }


def _ranking(works: list[Work], dimension: str, total: int) -> list[dict[str, object]]:
    counts: Counter[str] = Counter()
    for work in works:
        counts.update(entities_for_work(work, dimension))
    ordered = sorted(counts.items(), key=lambda item: (-item[1], item[0].casefold(), item[0]))
    return [
        {"name": name, "count": count, "percentage": _percentage(count, total)}
        for name, count in ordered
    ]


def _coverage(known: int, total: int) -> dict[str, object]:
    return {
        "known": known,
        "missing": total - known,
        "percentage": _percentage(known, total),
    }


def _percentage(count: int, total: int) -> float:
    return round(count / total * 100, 1) if total else 0.0


def _path_suggestions(works: list[Work]) -> list[dict[str, object]]:
    counts: Counter[str] = Counter()
    for work in works:
        parents = {str(Path(item).parent) for item in work.local_paths if item.strip()}
        counts.update(parents)
    ordered = sorted(counts.items(), key=lambda item: (-item[1], item[0].casefold()))
    return [{"path": path, "count": count} for path, count in ordered]


def _build_insights(
    total: int,
    rankings: dict[str, list[dict[str, object]]],
    years: Counter[str],
    coverage: dict[str, dict[str, object]],
) -> list[str]:
    if total == 0:
        return ["当前筛选条件下没有作品，可以调整年份、状态或路径。"]

    insights = [f"当前视图包含 {total} 部唯一 RJ 作品。"]
    labels = (("tags", "最高频标签"), ("voice_actors", "最高频声优"), ("circles", "最高频社团"))
    for key, label in labels:
        if rankings[key]:
            top = rankings[key][0]
            insights.append(f"{label}是“{top['name']}”，覆盖 {top['count']} 部作品。")
    if years:
        year, count = sorted(years.items(), key=lambda item: (-item[1], item[0]))[0]
        insights.append(f"作品发售年份最集中在 {year} 年，共 {count} 部。")
    lowest_key = min(coverage, key=lambda key: float(coverage[key]["percentage"]))
    if coverage[lowest_key]["missing"]:
        names = {"tags": "标签", "voice_actors": "声优", "circles": "社团", "release_year": "发售年份"}
        item = coverage[lowest_key]
        insights.append(
            f"{names[lowest_key]}覆盖率最低，为 {item['percentage']}%，尚有 {item['missing']} 部缺失。"
        )
    return insights
