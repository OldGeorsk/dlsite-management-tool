from __future__ import annotations

from dlsite_tool.models import STATUS_FAILED, STATUS_SUCCESS, Work
from dlsite_tool.stats import (
    build_stats,
    extract_release_year,
    filter_works,
    split_tags,
    split_voice_actors,
)
from server import parse_query_filters


def sample_works() -> list[Work]:
    return [
        Work(
            rj="RJ00000001",
            circle="Circle B",
            voice_actors="声優A / 声優B / 声優A",
            tags="ASMR バイノーラル/ダミヘ ASMR",
            release_date="2025年01月02日",
            fetch_status=STATUS_SUCCESS,
            local_paths=[
                r"example-library\collection-a\RJ00000001",
                r"backup-library\RJ00000001",
            ],
        ),
        Work(
            rj="RJ00000002",
            circle="Circle A",
            voice_actors="声優A",
            tags="ASMR 耳舐め",
            release_date="2024-12-01",
            fetch_status=STATUS_SUCCESS,
            local_paths=[r"example-library\collection-b\RJ00000002"],
        ),
        Work(
            rj="RJ00000003",
            release_date="日期不明",
            fetch_status=STATUS_FAILED,
            local_paths=[r"example-library\collection-a\RJ00000003"],
        ),
    ]


def test_entity_splitting_is_conservative_and_unique() -> None:
    assert split_voice_actors("声優A / 声優B / 声優A") == ["声優A", "声優B"]
    assert split_tags("ASMR バイノーラル/ダミヘ ASMR") == ["ASMR", "バイノーラル/ダミヘ"]
    assert split_tags("") == []


def test_extract_release_year_rejects_unparseable_text() -> None:
    assert extract_release_year("2025年01月02日") == "2025"
    assert extract_release_year("日期不明") == ""


def test_build_stats_counts_unique_works_and_missing_fields() -> None:
    stats = build_stats(sample_works())

    assert stats["summary"]["total_works"] == 3
    assert stats["summary"]["coverage"]["tags"] == {
        "known": 2,
        "missing": 1,
        "percentage": 66.7,
    }
    assert stats["rankings"]["tags"][0] == {
        "name": "ASMR",
        "count": 2,
        "percentage": 66.7,
    }
    assert [item["name"] for item in stats["rankings"]["circles"]] == ["Circle A", "Circle B"]
    assert stats["options"]["paths"][0] == {
        "path": r"example-library\collection-a",
        "count": 2,
    }
    assert stats["summary"]["insight_items"][0] == {
        "code": "stats.insight.total",
        "params": {"total": 3},
    }


def test_filters_combine_and_entity_matches_are_exact() -> None:
    works = sample_works()

    selected = filter_works(
        works,
        release_year="2025",
        status=STATUS_SUCCESS,
        path="LIBRARY",
        tag="ASMR",
        voice_actor="声優B",
        circle="Circle B",
    )
    assert [work.rj for work in selected] == ["RJ00000001"]
    assert filter_works(works, tag="ASM") == []


def test_empty_result_and_invalid_filters() -> None:
    stats = build_stats(sample_works(), path="not-found")
    assert stats["summary"]["total_works"] == 0
    assert stats["summary"]["coverage"]["tags"]["percentage"] == 0.0
    assert stats["summary"]["insights"] == ["当前筛选条件下没有作品，可以调整年份、状态或路径。"]
    assert stats["summary"]["insight_items"] == [{"code": "stats.insight.empty", "params": {}}]

    for kwargs in ({"release_year": "20xx"}, {"status": "未知状态"}):
        try:
            build_stats(sample_works(), **kwargs)
        except ValueError:
            pass
        else:
            raise AssertionError("invalid filters should be rejected")


def test_api_query_parser_decodes_paths_and_entities() -> None:
    query = (
        "release_year=2025&status=%E6%88%90%E5%8A%9F&"
        "path=example-library%5C%E9%9F%B3%E5%A3%B0%26more&tag=ASMR"
    )
    assert parse_query_filters(query, include_entities=True) == {
        "release_year": "2025",
        "status": "成功",
        "path": "example-library\\音声&more",
        "tag": "ASMR",
        "voice_actor": "",
        "circle": "",
    }
