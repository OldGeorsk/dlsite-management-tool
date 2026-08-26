from __future__ import annotations

import json
import threading
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer

from openpyxl import load_workbook

import server
from dlsite_tool.db import Store
from dlsite_tool.models import STATUS_SUCCESS, Work
from dlsite_tool.stats import search_library
from server import parse_search_query


def works() -> list[Work]:
    return [
        Work(
            rj="RJ00000003",
            local_title="逆転無し 癒し",
            circle="Circle A",
            voice_actors="声優A / 声優B",
            tags="ASMR 耳舐め",
            release_date="2025年02月03日",
            fetch_status=STATUS_SUCCESS,
            rating_average=4.8,
            rating_count=20,
            local_paths=[r"example\new\RJ00000003"],
        ),
        Work(
            rj="RJ00000002",
            official_title="逆転無し ドラマ",
            circle="Circle B",
            voice_actors="声優C",
            tags="ASMR 囁き",
            release_date="2024-12-01",
            fetch_status=STATUS_SUCCESS,
            rating_average=4.8,
            rating_count=0,
            local_paths=[r"example\old\RJ00000002"],
        ),
        Work(
            rj="RJ00000001",
            local_title="Unknown date",
            circle="Circle C",
            voice_actors="声優A",
            tags="耳舐め",
            release_date="日期不明",
            rating_average=None,
            rating_count=None,
            local_paths=[r"archive\RJ00000001"],
        ),
    ]


def test_keywords_can_match_different_fields_and_all_are_required() -> None:
    result = search_library(works(), q="逆転無し 声優b")
    assert [work.rj for work in result["works"]] == ["RJ00000003"]
    assert search_library(works(), q="逆転無し missing")["matched_works"] == 0


def test_same_facet_is_or_and_different_facets_are_and() -> None:
    result = search_library(
        works(),
        tags=["耳舐め", "囁き"],
        circles=["Circle A", "Circle C"],
        release_years=["2025"],
    )
    assert [work.rj for work in result["works"]] == ["RJ00000003"]


def test_facets_ignore_their_own_selection_and_keep_selected_zero_count() -> None:
    result = search_library(works(), tags=["囁き"], circles=["Circle A"])
    tag_items = {item["name"]: item for item in result["facets"]["tags"]}
    circle_items = {item["name"]: item for item in result["facets"]["circles"]}

    assert tag_items["ASMR"]["count"] == 1
    assert tag_items["耳舐め"]["count"] == 1
    assert tag_items["囁き"] == {"name": "囁き", "count": 0, "selected": True}
    assert circle_items["Circle B"]["count"] == 1
    assert "Circle C" not in circle_items


def test_metric_sort_keeps_null_last_and_rj_breaks_ties() -> None:
    descending = search_library(works(), sort_by="rating_average", sort_dir="desc")
    ascending = search_library(works(), sort_by="rating_count", sort_dir="asc")

    assert [work.rj for work in descending["works"]] == [
        "RJ00000003", "RJ00000002", "RJ00000001"
    ]
    assert [work.rj for work in ascending["works"]] == [
        "RJ00000002", "RJ00000003", "RJ00000001"
    ]


def test_default_sort_uses_release_date_then_rj_and_invalid_dates_last() -> None:
    extra = Work(rj="RJ00000004", release_date="2025-02-03")
    result = search_library([*works(), extra])
    assert [work.rj for work in result["works"]] == [
        "RJ00000004", "RJ00000003", "RJ00000002", "RJ00000001"
    ]


def test_search_query_parser_preserves_repeated_and_legacy_single_values() -> None:
    parsed = parse_search_query(
        "q=%E9%80%86%E8%BB%A2+ASMR&tag=A&tag=B&voice_actor=C&"
        "release_year=2025&release_year=2024&sort_by=rating_count&sort_dir=desc"
    )
    assert parsed == {
        "q": "逆転 ASMR",
        "release_years": ["2025", "2024"],
        "status": "",
        "path": "",
        "tags": ["A", "B"],
        "voice_actors": ["C"],
        "circles": [],
        "sort_by": "rating_count",
        "sort_dir": "desc",
    }


def test_invalid_year_and_sort_parameters_are_rejected() -> None:
    invalid = (
        {"release_years": ["20xx"]},
        {"sort_by": "sales_count", "sort_dir": "desc"},
        {"sort_by": "rating_count", "sort_dir": "newest"},
        {"sort_dir": "asc"},
    )
    for query in invalid:
        try:
            search_library(works(), **query)
        except ValueError:
            pass
        else:
            raise AssertionError(f"query should fail: {query}")


def test_works_api_and_filtered_export_share_query_and_order(tmp_path, monkeypatch) -> None:
    db_path = tmp_path / "search.sqlite3"
    export_dir = tmp_path / "exports"
    with Store(db_path) as store:
        store.upsert_scanned(works())
        for work in works():
            store.update_metadata(work)
            store.update_metrics(work)

    monkeypatch.setattr(server, "DB_PATH", db_path)
    monkeypatch.setattr(server, "EXPORT_DIR", export_dir)
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), server.AppHandler)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    query = "tag=ASMR&sort_by=rating_count&sort_dir=asc"
    try:
        with urllib.request.urlopen(
            f"http://127.0.0.1:{httpd.server_port}/api/works?{query}", timeout=2
        ) as response:
            payload = json.loads(response.read().decode("utf-8"))
        assert payload["total_works"] == 3
        assert payload["matched_works"] == 2
        assert payload["query"]["tags"] == ["ASMR"]
        assert [item["rj"] for item in payload["works"]] == ["RJ00000002", "RJ00000003"]
        assert "tags" in payload["facets"]

        with urllib.request.urlopen(
            f"http://127.0.0.1:{httpd.server_port}/api/export?{query}", timeout=2
        ) as response:
            output = tmp_path / "filtered.xlsx"
            output.write_bytes(response.read())
        sheet = load_workbook(output).active
        assert [sheet.cell(row=row, column=1).value for row in range(2, 4)] == [
            "RJ00000002", "RJ00000003"
        ]

        with urllib.request.urlopen(
            f"http://127.0.0.1:{httpd.server_port}/api/export?{query}&lang=en", timeout=2
        ) as response:
            english_output = tmp_path / "filtered-en.xlsx"
            english_output.write_bytes(response.read())
        english_sheet = load_workbook(english_output).active
        assert english_sheet.title == "DLsite Works"
        assert english_sheet["A1"].value == "RJ ID"
        assert english_sheet["N2"].value == "Success"
    finally:
        httpd.shutdown()
        httpd.server_close()
        thread.join(timeout=2)


def test_works_api_returns_readable_400_for_invalid_sort(tmp_path, monkeypatch) -> None:
    db_path = tmp_path / "invalid.sqlite3"
    with Store(db_path):
        pass
    monkeypatch.setattr(server, "DB_PATH", db_path)
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), server.AppHandler)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    try:
        try:
            urllib.request.urlopen(
                f"http://127.0.0.1:{httpd.server_port}/api/works?sort_by=sales_count&sort_dir=desc",
                timeout=2,
            )
        except urllib.error.HTTPError as exc:
            assert exc.code == 400
            assert json.loads(exc.read().decode("utf-8"))["error"] == "排序字段无效"
        else:
            raise AssertionError("invalid sort should return HTTP 400")
    finally:
        httpd.shutdown()
        httpd.server_close()
        thread.join(timeout=2)
