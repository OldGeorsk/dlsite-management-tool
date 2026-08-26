from __future__ import annotations

import re
from collections import Counter
from datetime import date
from pathlib import Path
from typing import Iterable

from .models import STATUS_FAILED, STATUS_PARTIAL, STATUS_SUCCESS, STATUS_UNFETCHED, Work


VALID_STATUSES = (STATUS_UNFETCHED, STATUS_SUCCESS, STATUS_PARTIAL, STATUS_FAILED)
YEAR_PATTERN = re.compile(r"(?<!\d)(\d{4})(?!\d)")
DATE_PATTERN = re.compile(r"(?<!\d)(\d{4})\D+(\d{1,2})\D+(\d{1,2})(?!\d)")
VOICE_ACTOR_SEPARATOR = re.compile(r"\s+/\s+")
FACET_KEYS = ("circles", "voice_actors", "release_years", "tags")
SORT_FIELDS = ("rating_average", "rating_count")
SORT_DIRECTIONS = ("asc", "desc")


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


def extract_release_date(value: str) -> tuple[int, int, int] | None:
    match = DATE_PATTERN.search(value)
    if not match:
        return None
    year, month, day = (int(item) for item in match.groups())
    try:
        date(year, month, day)
    except ValueError:
        return None
    return year, month, day


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


def search_library(
    works: Iterable[Work],
    *,
    q: str = "",
    release_years: Iterable[str] = (),
    status: str = "",
    path: str = "",
    tags: Iterable[str] = (),
    voice_actors: Iterable[str] = (),
    circles: Iterable[str] = (),
    sort_by: str = "",
    sort_dir: str = "",
) -> dict[str, object]:
    """Apply the workbench query and return results plus self-excluding facets."""
    query = normalize_search_query(
        q=q,
        release_years=release_years,
        status=status,
        path=path,
        tags=tags,
        voice_actors=voice_actors,
        circles=circles,
        sort_by=sort_by,
        sort_dir=sort_dir,
    )
    all_works = list(works)
    selected = _filter_search(all_works, query)
    facets = {
        key: _build_facet(all_works, query, key)
        for key in FACET_KEYS
    }
    return {
        "works": _sort_works(selected, query["sort_by"], query["sort_dir"]),
        "total_works": len(all_works),
        "matched_works": len(selected),
        "query": query,
        "facets": facets,
    }


def normalize_search_query(
    *,
    q: str = "",
    release_years: Iterable[str] = (),
    status: str = "",
    path: str = "",
    tags: Iterable[str] = (),
    voice_actors: Iterable[str] = (),
    circles: Iterable[str] = (),
    sort_by: str = "",
    sort_dir: str = "",
) -> dict[str, object]:
    years = _unique(release_years)
    normalized = {
        "q": " ".join(q.split()),
        "release_years": years,
        "status": status.strip(),
        "path": path.strip(),
        "tags": _unique(tags),
        "voice_actors": _unique(voice_actors),
        "circles": _unique(circles),
        "sort_by": sort_by.strip(),
        "sort_dir": sort_dir.strip(),
    }
    for year in years:
        if not re.fullmatch(r"\d{4}", year):
            raise ValueError("发售年份必须是四位数字")
    if normalized["status"] and normalized["status"] not in VALID_STATUSES:
        raise ValueError("抓取状态无效")
    if normalized["sort_by"] not in ("", *SORT_FIELDS):
        raise ValueError("排序字段无效")
    if normalized["sort_by"]:
        if normalized["sort_dir"] not in SORT_DIRECTIONS:
            raise ValueError("排序方向必须是 asc 或 desc")
    elif normalized["sort_dir"]:
        raise ValueError("指定排序方向前必须选择排序字段")
    return normalized


def _filter_search(
    works: Iterable[Work], query: dict[str, object], *, ignore_facet: str = ""
) -> list[Work]:
    keywords = str(query["q"]).casefold().split()
    path_query = str(query["path"]).casefold()
    selections = {
        "release_years": set(query["release_years"]),
        "tags": set(query["tags"]),
        "voice_actors": set(query["voice_actors"]),
        "circles": set(query["circles"]),
    }
    result: list[Work] = []
    for work in works:
        searchable = " ".join(
            [
                work.rj,
                work.local_title,
                work.official_title,
                work.circle,
                work.voice_actors,
                work.tags,
                *work.local_paths,
            ]
        ).casefold()
        if keywords and not all(keyword in searchable for keyword in keywords):
            continue
        if query["status"] and work.fetch_status != query["status"]:
            continue
        if path_query and not any(path_query in item.casefold() for item in work.local_paths):
            continue
        values = {
            "release_years": [extract_release_year(work.release_date)],
            "tags": split_tags(work.tags),
            "voice_actors": split_voice_actors(work.voice_actors),
            "circles": split_circles(work.circle),
        }
        if any(
            key != ignore_facet
            and selections[key]
            and selections[key].isdisjoint(values[key])
            for key in FACET_KEYS
        ):
            continue
        result.append(work)
    return result


def _build_facet(
    works: list[Work], query: dict[str, object], facet: str
) -> list[dict[str, object]]:
    counts: Counter[str] = Counter()
    for work in _filter_search(works, query, ignore_facet=facet):
        if facet == "release_years":
            values = [extract_release_year(work.release_date)]
        else:
            values = entities_for_work(work, facet)
        counts.update(filter(None, values))
    selected = set(query[facet])
    names = set(counts) | selected
    ordered = sorted(
        names,
        key=(lambda name: (-int(name),))
        if facet == "release_years"
        else (lambda name: (-counts[name], name.casefold(), name)),
    )
    return [
        {"name": name, "count": counts[name], "selected": name in selected}
        for name in ordered
        if counts[name] > 0 or name in selected
    ]


def _sort_works(works: list[Work], sort_by: object, sort_dir: object) -> list[Work]:
    ordered = sorted(works, key=lambda work: work.rj, reverse=True)
    if sort_by:
        known = [work for work in ordered if getattr(work, str(sort_by)) is not None]
        unknown = [work for work in ordered if getattr(work, str(sort_by)) is None]
        known.sort(
            key=lambda work: getattr(work, str(sort_by)),
            reverse=sort_dir == "desc",
        )
        return known + unknown
    return sorted(
        ordered,
        key=lambda work: (
            extract_release_date(work.release_date) is not None,
            extract_release_date(work.release_date) or (0, 0, 0),
        ),
        reverse=True,
    )


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
    insight_items = _build_insight_items(total, rankings, years, coverage)

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
            "insight_items": insight_items,
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


def _build_insight_items(
    total: int,
    rankings: dict[str, list[dict[str, object]]],
    years: Counter[str],
    coverage: dict[str, dict[str, object]],
) -> list[dict[str, object]]:
    if total == 0:
        return [{"code": "stats.insight.empty", "params": {}}]

    items: list[dict[str, object]] = [
        {"code": "stats.insight.total", "params": {"total": total}}
    ]
    for key in ("tags", "voice_actors", "circles"):
        if rankings[key]:
            top = rankings[key][0]
            items.append({
                "code": "stats.insight.top",
                "params": {"dimension": key, "name": top["name"], "count": top["count"]},
            })
    if years:
        year, count = sorted(years.items(), key=lambda item: (-item[1], item[0]))[0]
        items.append({
            "code": "stats.insight.year",
            "params": {"year": year, "count": count},
        })
    lowest_key = min(coverage, key=lambda key: float(coverage[key]["percentage"]))
    lowest = coverage[lowest_key]
    if lowest["missing"]:
        items.append({
            "code": "stats.insight.coverage",
            "params": {
                "dimension": lowest_key,
                "percentage": lowest["percentage"],
                "missing": lowest["missing"],
            },
        })
    return items
