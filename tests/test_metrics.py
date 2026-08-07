from __future__ import annotations

import json
import sqlite3
import threading
import time
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path

import server
from dlsite_tool import scraper
from dlsite_tool.db import Store
from dlsite_tool.jobs import JOB_SUCCESS, JobManager
from dlsite_tool.models import Work
from dlsite_tool.scraper import build_metrics_url, parse_metrics_json


def test_parse_metrics_prefers_total_sales_and_reads_rating() -> None:
    body = json.dumps(
        {
            "RJ00000001": {
                "dl_count": 1200,
                "dl_count_total": "1,234",
                "rate_average_2dp": 4.25,
                "rate_count": 17,
            }
        }
    )

    work = parse_metrics_json("RJ00000001", body)

    assert work.sales_count == 1234
    assert work.rating_average == 4.25
    assert work.rating_count == 17
    assert build_metrics_url("RJ00000001", "home").startswith(
        "https://www.dlsite.com/home/product/info/ajax"
    )


def test_parse_metrics_treats_zero_rating_as_valid_without_average() -> None:
    body = json.dumps(
        {
            "RJ00000001": {
                "dl_count": "0",
                "rate_average_2dp": 0,
                "rate_count": 0,
            }
        }
    )

    work = parse_metrics_json("RJ00000001", body)

    assert work.sales_count == 0
    assert work.rating_count == 0
    assert work.rating_average is None


def test_parse_metrics_rejects_invalid_payload_and_values() -> None:
    invalid_bodies = [
        "not-json",
        json.dumps({"RJ00000002": {}}),
        json.dumps({"RJ00000001": {"dl_count": -1, "rate_count": 0}}),
        json.dumps(
            {
                "RJ00000001": {
                    "dl_count": 1,
                    "rate_count": 1,
                    "rate_average_2dp": 6,
                }
            }
        ),
    ]

    for body in invalid_bodies:
        try:
            parse_metrics_json("RJ00000001", body)
        except ValueError:
            pass
        else:
            raise AssertionError("invalid metrics payload should be rejected")


def test_fetch_metrics_falls_back_to_home(monkeypatch) -> None:
    valid = json.dumps(
        {
            "RJ00000001": {
                "dl_count": 7,
                "rate_average_2dp": 4.0,
                "rate_count": 2,
            }
        }
    )
    calls: list[str] = []

    def fake_download(url: str, _timeout: int, _proxy: str = "") -> tuple[str, str]:
        calls.append(url)
        if "/maniax/" in url:
            raise RuntimeError("maniax 不可用")
        return valid, url

    monkeypatch.setattr(scraper, "_download", fake_download)

    work = scraper.fetch_metrics("RJ00000001")

    assert len(calls) == 2
    assert "/home/" in calls[1]
    assert (work.sales_count, work.rating_average, work.rating_count) == (7, 4.0, 2)
    assert work.metrics_failure_reason == ""
    assert work.metrics_last_fetched_at


def test_store_migrates_old_database_without_losing_data(tmp_path: Path) -> None:
    db_path = tmp_path / "old.sqlite3"
    conn = sqlite3.connect(db_path)
    conn.execute(
        """
        CREATE TABLE works (
            rj TEXT PRIMARY KEY,
            local_title TEXT NOT NULL DEFAULT '',
            official_title TEXT NOT NULL DEFAULT '',
            circle TEXT NOT NULL DEFAULT '',
            voice_actors TEXT NOT NULL DEFAULT '',
            release_date TEXT NOT NULL DEFAULT '',
            tags TEXT NOT NULL DEFAULT '',
            cover_url TEXT NOT NULL DEFAULT '',
            work_url TEXT NOT NULL DEFAULT '',
            fetch_status TEXT NOT NULL DEFAULT '未抓取',
            failure_reason TEXT NOT NULL DEFAULT '',
            last_fetched_at TEXT NOT NULL DEFAULT ''
        )
        """
    )
    conn.execute("INSERT INTO works (rj, local_title) VALUES (?, ?)", ("RJ00000001", "旧数据"))
    conn.commit()
    conn.close()

    with Store(db_path) as store:
        work = store.get_work("RJ00000001")
        columns = {
            row["name"] for row in store.conn.execute("PRAGMA table_info(works)").fetchall()
        }

    assert work is not None
    assert work.local_title == "旧数据"
    assert work.sales_count is None
    assert {
        "sales_count",
        "rating_average",
        "rating_count",
        "metrics_failure_reason",
        "metrics_last_fetched_at",
    } <= columns


def test_metric_updates_overwrite_success_and_preserve_values_on_failure(tmp_path: Path) -> None:
    db_path = tmp_path / "metrics.sqlite3"
    with Store(db_path) as store:
        store.update_metrics(
            Work(
                rj="RJ00000001",
                sales_count=100,
                rating_average=4.5,
                rating_count=10,
                metrics_last_fetched_at="first",
            )
        )
        store.update_metrics(
            Work(
                rj="RJ00000001",
                metrics_failure_reason="网络失败",
                metrics_last_fetched_at="failed",
            )
        )
        failed = store.get_work("RJ00000001")
        store.update_metrics(
            Work(
                rj="RJ00000001",
                sales_count=120,
                rating_count=0,
                rating_average=None,
                metrics_last_fetched_at="zero",
            )
        )
        zero = store.get_work("RJ00000001")

    assert failed is not None
    assert (failed.sales_count, failed.rating_average, failed.rating_count) == (100, 4.5, 10)
    assert failed.metrics_failure_reason == "网络失败"
    assert zero is not None
    assert (zero.sales_count, zero.rating_average, zero.rating_count) == (120, None, 0)
    assert zero.metrics_failure_reason == ""


def test_metric_candidates_default_to_missing_and_force_all() -> None:
    complete = Work(rj="RJ00000001", sales_count=1, rating_count=0)
    missing_sales = Work(rj="RJ00000002", rating_count=1, rating_average=4.0)
    missing_rating = Work(rj="RJ00000003", sales_count=3)
    works = [complete, missing_sales, missing_rating]

    assert [work.rj for work in server._metric_candidates(works, False)] == [
        "RJ00000002",
        "RJ00000003",
    ]
    assert server._metric_candidates(works, True) == works


def test_metrics_refresh_api_starts_job_and_updates_work(tmp_path: Path, monkeypatch) -> None:
    db_path = tmp_path / "api.sqlite3"
    with Store(db_path) as store:
        store.upsert_scanned([Work(rj="RJ00000001", local_title="API 测试")])

    monkeypatch.setattr(server, "DB_PATH", db_path)
    monkeypatch.setattr(server, "JOBS", JobManager())
    monkeypatch.setattr(
        server,
        "fetch_metrics",
        lambda rj, proxy="": Work(
            rj=rj,
            sales_count=88,
            rating_average=4.25,
            rating_count=12,
            metrics_last_fetched_at="now",
        ),
    )
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), server.AppHandler)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    try:
        request = urllib.request.Request(
            f"http://127.0.0.1:{httpd.server_port}/api/metrics/refresh",
            data=json.dumps({"proxy": "", "force": False}).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(request, timeout=2) as response:
            payload = json.loads(response.read().decode("utf-8"))
            assert response.status == 202

        deadline = time.monotonic() + 2
        while time.monotonic() < deadline:
            job = server.JOBS.get(payload["job_id"])
            if job and job.status == JOB_SUCCESS:
                break
            time.sleep(0.01)
        else:
            raise AssertionError("metrics refresh job did not finish")

        with Store(db_path) as store:
            work = store.get_work("RJ00000001")
        assert work is not None
        assert (work.sales_count, work.rating_average, work.rating_count) == (88, 4.25, 12)

        with urllib.request.urlopen(
            f"http://127.0.0.1:{httpd.server_port}/api/works", timeout=2
        ) as response:
            works_payload = json.loads(response.read().decode("utf-8"))
        api_work = works_payload["works"][0]
        assert {
            "sales_count",
            "rating_average",
            "rating_count",
            "metrics_failure_reason",
            "metrics_last_fetched_at",
        } <= api_work.keys()
    finally:
        httpd.shutdown()
        httpd.server_close()
        thread.join(timeout=2)
