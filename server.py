from __future__ import annotations

import json
import mimetypes
import os
import threading
import urllib.parse
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from dlsite_tool.db import Store
from dlsite_tool.exporter import export_xlsx
from dlsite_tool.jobs import JobManager, JobReporter, STAGE_FETCH, STAGE_SCAN, STAGE_WRITE
from dlsite_tool.models import Work
from dlsite_tool.scanner import scan_library
from dlsite_tool.scraper import fetch_metadata, fetch_metrics
from dlsite_tool.stats import build_stats, filter_works


HOST = "127.0.0.1"
PORT = int(os.environ.get("DLSITE_TOOL_PORT", "8765"))
ROOT = Path(__file__).parent
STATIC = ROOT / "static"
EXPORT_DIR = ROOT / "exports"
DB_PATH = ROOT / "data" / "dlsite_tool.sqlite3"
JOBS = JobManager()


class AppHandler(BaseHTTPRequestHandler):
    server_version = "DLsiteTool/1.0"

    def do_GET(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/":
            self._send_file(STATIC / "index.html")
        elif parsed.path in {"/stats", "/stats/"}:
            self._send_file(STATIC / "stats.html")
        elif parsed.path == "/api/works":
            self._works(parsed.query)
        elif parsed.path == "/api/stats":
            self._stats(parsed.query)
        elif parsed.path == "/api/export":
            self._export()
        elif parsed.path.startswith("/api/jobs/"):
            self._job_status(parsed.path.removeprefix("/api/jobs/"))
        elif parsed.path.startswith("/static/"):
            self._send_file(STATIC / parsed.path.removeprefix("/static/"))
        else:
            self._json({"error": "Not found"}, HTTPStatus.NOT_FOUND)

    def do_POST(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/api/scan":
            self._scan()
        elif parsed.path == "/api/fetch":
            self._fetch_missing()
        elif parsed.path == "/api/metrics/refresh":
            self._refresh_metrics()
        else:
            self._json({"error": "Not found"}, HTTPStatus.NOT_FOUND)

    def log_message(self, format: str, *args: object) -> None:
        print(f"[server] {self.address_string()} - {format % args}")

    def _scan(self) -> None:
        payload = self._read_json()
        root = str(payload.get("path", "")).strip()
        should_fetch = bool(payload.get("fetch", False))
        proxy = str(payload.get("proxy", "")).strip()
        if not root:
            self._json({"error": "请输入要扫描的文件夹路径"}, HTTPStatus.BAD_REQUEST)
            return

        try:
            job = JOBS.start(
                "scan_fetch" if should_fetch else "scan",
                lambda reporter: _run_scan_job(reporter, root, should_fetch, proxy),
            )
            self._json({"job_id": job.id, "job": job.to_dict()}, HTTPStatus.ACCEPTED)
        except Exception as exc:
            self._json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)

    def _fetch_missing(self) -> None:
        payload = self._read_json()
        proxy = str(payload.get("proxy", "")).strip()
        try:
            job = JOBS.start(
                "fetch",
                lambda reporter: _run_fetch_missing_job(reporter, proxy),
            )
            self._json({"job_id": job.id, "job": job.to_dict()}, HTTPStatus.ACCEPTED)
        except Exception as exc:
            self._json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)

    def _refresh_metrics(self) -> None:
        payload = self._read_json()
        proxy = str(payload.get("proxy", "")).strip()
        force = payload.get("force", False)
        if not isinstance(force, bool):
            self._json({"error": "force 必须是布尔值"}, HTTPStatus.BAD_REQUEST)
            return
        try:
            job = JOBS.start(
                "metrics_refresh",
                lambda reporter: _run_metrics_refresh_job(reporter, proxy, force),
            )
            self._json({"job_id": job.id, "job": job.to_dict()}, HTTPStatus.ACCEPTED)
        except Exception as exc:
            self._json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)

    def _job_status(self, job_id: str) -> None:
        job = JOBS.get(job_id.strip())
        if not job:
            self._json({"error": "任务不存在"}, HTTPStatus.NOT_FOUND)
            return
        self._json({"job": job.to_dict()})

    def _works(self, query: str) -> None:
        filters = parse_query_filters(query, include_entities=True)
        try:
            with Store(DB_PATH) as store:
                all_works = store.list_works()
            works = filter_works(all_works, **filters)
        except ValueError as exc:
            self._json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
            return
        self._json(
            {
                "works": [work.to_dict() for work in works],
                "total_works": len(all_works),
                "filters": filters,
            }
        )

    def _stats(self, query: str) -> None:
        filters = parse_query_filters(query, include_entities=False)
        try:
            with Store(DB_PATH) as store:
                works = store.list_works()
            payload = build_stats(works, **filters)
        except ValueError as exc:
            self._json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
            return
        self._json(payload)

    def _export(self) -> None:
        with Store(DB_PATH) as store:
            works = store.list_works()
        output = export_xlsx(works, EXPORT_DIR / "dlsite_works.xlsx")
        data = output.read_bytes()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        self.send_header("Content-Disposition", 'attachment; filename="dlsite_works.xlsx"')
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _read_json(self) -> dict[str, object]:
        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length) if length else b"{}"
        return json.loads(raw.decode("utf-8"))

    def _json(self, payload: dict[str, object], status: HTTPStatus = HTTPStatus.OK) -> None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _send_file(self, path: Path) -> None:
        if not path.exists() or not path.is_file():
            self._json({"error": "Not found"}, HTTPStatus.NOT_FOUND)
            return
        data = path.read_bytes()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", mimetypes.guess_type(path.name)[0] or "application/octet-stream")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


def _run_scan_job(reporter: JobReporter, root: str, should_fetch: bool, proxy: str) -> None:
    reporter.update(stage=STAGE_SCAN, message="正在扫描目录")
    scanned = scan_library(root)
    reporter.update(
        stage=STAGE_WRITE,
        total=len(scanned),
        completed=0,
        message=f"扫描到 {len(scanned)} 个作品，正在写入缓存",
    )

    with Store(DB_PATH) as store:
        store.upsert_scanned(scanned)

    if should_fetch:
        _fetch_works(reporter, scanned, proxy)
    else:
        reporter.update(
            completed=len(scanned),
            message=f"本次扫描识别 {len(scanned)} 个作品",
        )


def _run_fetch_missing_job(reporter: JobReporter, proxy: str) -> None:
    with Store(DB_PATH) as store:
        works = [work for work in store.list_works() if work.fetch_status != "成功"]
    _fetch_works(reporter, works, proxy)


def _fetch_works(reporter: JobReporter, works: list[Work], proxy: str) -> None:
    total = len(works)
    reporter.update(
        stage=STAGE_FETCH,
        total=total,
        completed=0,
        current_rj="",
        message=f"准备抓取 {total} 个作品",
    )
    if total == 0:
        reporter.update(message="没有需要抓取的作品")
        return

    for index, work in enumerate(works, start=1):
        reporter.update(
            completed=index - 1,
            current_rj=work.rj,
            message=f"正在抓取 {work.rj}",
        )
        metadata = fetch_metadata(work.rj, proxy=proxy)
        with Store(DB_PATH) as store:
            store.update_metadata(metadata)
        if metadata.failure_reason:
            reporter.update(last_error=f"{metadata.rj}: {metadata.failure_reason}")
        reporter.update(
            completed=index,
            current_rj=work.rj,
            message=f"已完成 {index}/{total}",
        )


def _metric_candidates(works: list[Work], force: bool) -> list[Work]:
    if force:
        return works
    return [
        work
        for work in works
        if work.sales_count is None or work.rating_count is None
    ]


def _run_metrics_refresh_job(reporter: JobReporter, proxy: str, force: bool) -> None:
    with Store(DB_PATH) as store:
        works = _metric_candidates(store.list_works(), force)
    _fetch_metrics_works(reporter, works, proxy)


def _fetch_metrics_works(reporter: JobReporter, works: list[Work], proxy: str) -> None:
    total = len(works)
    reporter.update(
        stage=STAGE_FETCH,
        total=total,
        completed=0,
        current_rj="",
        message=f"准备刷新 {total} 个作品的销量与评价",
    )
    if total == 0:
        reporter.update(message="没有缺失销量或评价指标的作品")
        return

    for index, work in enumerate(works, start=1):
        reporter.update(
            completed=index - 1,
            current_rj=work.rj,
            message=f"正在刷新 {work.rj} 的销量与评价",
        )
        metrics = fetch_metrics(work.rj, proxy=proxy)
        with Store(DB_PATH) as store:
            store.update_metrics(metrics)
        if metrics.metrics_failure_reason:
            reporter.update(last_error=f"{metrics.rj}: {metrics.metrics_failure_reason}")
        reporter.update(
            completed=index,
            current_rj=work.rj,
            message=f"已完成 {index}/{total}",
        )


def parse_query_filters(query: str, *, include_entities: bool) -> dict[str, str]:
    params = urllib.parse.parse_qs(query, keep_blank_values=False)
    names = ["release_year", "status", "path"]
    if include_entities:
        names.extend(["tag", "voice_actor", "circle"])
    return {name: str(params.get(name, [""])[0]).strip() for name in names}


def main() -> None:
    STATIC.mkdir(exist_ok=True)
    server = ThreadingHTTPServer((HOST, PORT), AppHandler)
    print(f"DLsite Tool running at http://{HOST}:{PORT}")
    print("Press Ctrl+C to stop.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        threading.Thread(target=server.shutdown, daemon=True).start()


if __name__ == "__main__":
    main()
