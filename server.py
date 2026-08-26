from __future__ import annotations

import json
import mimetypes
import os
import subprocess
import threading
import time
import urllib.parse
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from dlsite_tool.db import Store
from dlsite_tool.exporter import export_xlsx
from dlsite_tool.jobs import JobManager, JobReporter, STAGE_FETCH, STAGE_SCAN, STAGE_WRITE
from dlsite_tool.everything import EverythingError
from dlsite_tool.everything_worker import EverythingWorkerManager
from dlsite_tool.local_access import CandidateTokens, SessionTokens, TimingBuffer
from dlsite_tool.models import Work
from dlsite_tool.scanner import extract_rj, scan_library
from dlsite_tool.scraper import fetch_metadata, fetch_metrics
from dlsite_tool.stats import build_stats, filter_works, search_library


HOST = "127.0.0.1"
PORT = int(os.environ.get("DLSITE_TOOL_PORT", "8765"))
ROOT = Path(__file__).parent
STATIC = ROOT / "static"
EXPORT_DIR = ROOT / "exports"
DB_PATH = ROOT / "data" / "dlsite_tool.sqlite3"
JOBS = JobManager()
EVERYTHING_WORKER = EverythingWorkerManager()
SESSIONS = SessionTokens()
CANDIDATES = CandidateTokens()
QUERY_TIMINGS = TimingBuffer()
ERROR_CODES = {
    "Not found": "error.not_found",
    "请求 JSON 无效": "error.invalid_json",
    "请求来源无效": "error.invalid_origin",
    "请求必须使用 JSON": "error.json_required",
    "页面会话已失效，请刷新页面": "error.session_expired",
    "未知的路径查询类型": "error.path_query_type",
    "请至少输入 2 个字符": "error.query_too_short",
    "RJ 号格式无效": "error.invalid_rj",
    "该路径不属于当前作品": "error.path_not_owned",
    "无法打开该目录": "error.open_directory",
    "候选已失效，请重新搜索": "error.candidate_expired",
    "候选目录已不存在": "error.candidate_missing",
    "补充路径不存在或不是目录": "error.path_invalid",
    "目录自身名称不包含当前作品的同一 RJ 号": "error.path_rj_mismatch",
    "作品不存在": "error.work_missing",
    "请输入要扫描的文件夹路径": "error.scan_path_required",
    "force 必须是布尔值": "error.force_boolean",
    "任务不存在": "error.job_missing",
    "排序字段无效": "error.invalid_sort_field",
    "排序方向必须是 asc 或 desc": "error.invalid_sort_direction",
    "指定排序方向前必须选择排序字段": "error.sort_field_required",
    "发售年份必须是四位数字": "error.invalid_release_year",
    "抓取状态无效": "error.invalid_status",
}
SENSITIVE_PATHS = {
    "/api/local-paths",
    "/api/paths/open-saved",
    "/api/paths/open-candidate",
    "/api/paths/add-candidate",
    "/api/paths/add-manual",
}


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
            self._export(parsed.query)
        elif parsed.path == "/api/session":
            self._session()
        elif parsed.path.startswith("/api/jobs/"):
            self._job_status(parsed.path.removeprefix("/api/jobs/"))
        elif parsed.path.startswith("/static/"):
            self._send_file(STATIC / parsed.path.removeprefix("/static/"))
        else:
            self._json({"error": "Not found"}, HTTPStatus.NOT_FOUND)

    def do_POST(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        try:
            if parsed.path == "/api/scan":
                self._scan()
            elif parsed.path == "/api/fetch":
                self._fetch_missing()
            elif parsed.path == "/api/metrics/refresh":
                self._refresh_metrics()
            elif parsed.path == "/api/local-paths":
                self._local_paths()
            elif parsed.path == "/api/paths/open-saved":
                self._open_saved_path()
            elif parsed.path == "/api/paths/open-candidate":
                self._open_candidate_path()
            elif parsed.path == "/api/paths/add-candidate":
                self._add_candidate_path()
            elif parsed.path == "/api/paths/add-manual":
                self._add_manual_path()
            else:
                self._json({"error": "Not found"}, HTTPStatus.NOT_FOUND)
        except (json.JSONDecodeError, UnicodeDecodeError, ValueError):
            self._json({"error": "请求 JSON 无效"}, HTTPStatus.BAD_REQUEST)

    def log_message(self, format: str, *args: object) -> None:
        route = urllib.parse.urlparse(self.path).path
        if route in SENSITIVE_PATHS:
            status = args[1] if len(args) > 1 else "-"
            print(f"[server] local-path action - {status}")
            return
        print(f"[server] {self.address_string()} - {format % args}")

    def _session(self) -> None:
        self._json({"token": SESSIONS.issue()}, headers={"Cache-Control": "no-store"})

    def _validate_sensitive_request(self) -> bool:
        host = self.headers.get("Host", "")
        expected_host = f"127.0.0.1:{self.server.server_address[1]}"
        origin = self.headers.get("Origin", "")
        content_type = self.headers.get("Content-Type", "").split(";", 1)[0].strip().lower()
        if host != expected_host or origin != f"http://{expected_host}":
            self._json({"error": "请求来源无效"}, HTTPStatus.FORBIDDEN)
            return False
        if content_type != "application/json":
            self._json({"error": "请求必须使用 JSON"}, HTTPStatus.UNSUPPORTED_MEDIA_TYPE)
            return False
        if not SESSIONS.valid(self.headers.get("X-Local-Session", "")):
            self._json({"error": "页面会话已失效，请刷新页面"}, HTTPStatus.FORBIDDEN)
            return False
        return True

    def _local_paths(self) -> None:
        if not self._validate_sensitive_request():
            return
        payload = self._read_json()
        mode = str(payload.get("mode", "keyword"))
        query = str(payload.get("query", "")).strip()
        rj = str(payload.get("rj", "")).strip().upper()
        root_only = bool(payload.get("root_only", False))
        if mode not in {"keyword", "rj"}:
            self._json({"error": "未知的路径查询类型"}, HTTPStatus.BAD_REQUEST)
            return
        if mode == "keyword" and len(query) < 2:
            self._json({"error": "请至少输入 2 个字符"}, HTTPStatus.BAD_REQUEST)
            return
        if mode == "rj":
            rj = rj or query.upper()
            if extract_rj(rj) != rj:
                self._json({"error": "RJ 号格式无效"}, HTTPStatus.BAD_REQUEST)
                return
            query = rj
        started = time.perf_counter()
        try:
            result = EVERYTHING_WORKER.query(mode, query)
            paths = [str(path) for path in result.get("paths", [])][:20]
            candidates = []
            for path in paths:
                item: dict[str, object] = {"path": path}
                if not root_only and rj:
                    item["open_token"] = CANDIDATES.issue(rj, path, "open")
                    if extract_rj(Path(path).name) == rj:
                        item["save_token"] = CANDIDATES.issue(rj, path, "save")
                candidates.append(item)
            QUERY_TIMINGS.record(float(result.get("elapsed_ms", 0)), "success")
            self._json({"candidates": candidates}, headers={"Cache-Control": "no-store"})
        except EverythingError as exc:
            elapsed = (time.perf_counter() - started) * 1000
            timed_out = "超时" in str(exc)
            QUERY_TIMINGS.record(elapsed, "timeout" if timed_out else "error", timed_out)
            busy = "繁忙" in str(exc)
            self._json({
                "error": str(exc),
                "error_code": "error.everything_timeout" if timed_out else ("error.everything_busy" if busy else "error.everything_unavailable"),
                "error_params": {},
                "error_detail": str(exc),
            }, HTTPStatus.SERVICE_UNAVAILABLE)

    def _open_saved_path(self) -> None:
        if not self._validate_sensitive_request():
            return
        payload = self._read_json()
        rj = str(payload.get("rj", "")).strip().upper()
        path = str(payload.get("path", ""))
        with Store(DB_PATH) as store:
            work = store.get_work(rj)
        if not work or path not in work.local_paths:
            self._json({"error": "该路径不属于当前作品"}, HTTPStatus.FORBIDDEN)
            return
        target = Path(path)
        if not target.is_absolute() or not target.is_dir():
            self._json({"status": "missing"}, HTTPStatus.NOT_FOUND)
            return
        try:
            open_directory(target)
            self._json({"status": "opened"})
        except OSError:
            self._json({"error": "无法打开该目录"}, HTTPStatus.BAD_REQUEST)

    def _open_candidate_path(self) -> None:
        if not self._validate_sensitive_request():
            return
        payload = self._read_json()
        rj = str(payload.get("rj", "")).strip().upper()
        candidate = CANDIDATES.consume(str(payload.get("token", "")), rj, "open")
        if not candidate:
            self._json({"error": "候选已失效，请重新搜索"}, HTTPStatus.FORBIDDEN)
            return
        target = Path(candidate.path)
        if not target.is_absolute() or not target.is_dir():
            self._json({"error": "候选目录已不存在"}, HTTPStatus.NOT_FOUND)
            return
        try:
            open_directory(target)
            self._json({"status": "opened"})
        except OSError:
            self._json({"error": "无法打开该目录"}, HTTPStatus.BAD_REQUEST)

    def _add_candidate_path(self) -> None:
        if not self._validate_sensitive_request():
            return
        payload = self._read_json()
        rj = str(payload.get("rj", "")).strip().upper()
        candidate = CANDIDATES.consume(str(payload.get("token", "")), rj, "save")
        if not candidate:
            self._json({"error": "候选已失效，请重新搜索"}, HTTPStatus.FORBIDDEN)
            return
        self._save_local_path(rj, candidate.path)

    def _add_manual_path(self) -> None:
        if not self._validate_sensitive_request():
            return
        payload = self._read_json()
        self._save_local_path(
            str(payload.get("rj", "")).strip().upper(),
            str(payload.get("path", "")).strip(),
        )

    def _save_local_path(self, rj: str, path: str) -> None:
        target = Path(path)
        if not target.is_absolute() or not target.is_dir():
            self._json({"error": "补充路径不存在或不是目录"}, HTTPStatus.BAD_REQUEST)
            return
        if extract_rj(target.name) != rj:
            self._json({"error": "目录自身名称不包含当前作品的同一 RJ 号"}, HTTPStatus.BAD_REQUEST)
            return
        with Store(DB_PATH) as store:
            if not store.get_work(rj):
                self._json({"error": "作品不存在"}, HTTPStatus.NOT_FOUND)
                return
            added = store.add_path(rj, str(target.resolve()))
        self._json({"status": "added" if added else "exists"})

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
        filters = parse_search_query(query)
        try:
            with Store(DB_PATH) as store:
                all_works = store.list_works()
            result = search_library(all_works, **filters)
        except ValueError as exc:
            self._json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
            return
        self._json(
            {
                "works": [work.to_dict() for work in result["works"]],
                "total_works": result["total_works"],
                "matched_works": result["matched_works"],
                "query": result["query"],
                "facets": result["facets"],
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

    def _export(self, query: str) -> None:
        query_params = urllib.parse.parse_qs(query, keep_blank_values=False)
        lang = str(query_params.pop("lang", ["zh-CN"])[0])
        lang = lang if lang in {"zh-CN", "en"} else "zh-CN"
        search_query = urllib.parse.urlencode(query_params, doseq=True)
        filters = parse_search_query(search_query)
        try:
            with Store(DB_PATH) as store:
                all_works = store.list_works()
            result = search_library(all_works, **filters)
        except ValueError as exc:
            self._json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
            return
        output = export_xlsx(result["works"], EXPORT_DIR / "dlsite_works.xlsx", lang=lang)
        data = output.read_bytes()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        self.send_header("Content-Disposition", 'attachment; filename="dlsite_works.xlsx"')
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _read_json(self) -> dict[str, object]:
        length = int(self.headers.get("Content-Length", "0"))
        if length > 64 * 1024:
            raise ValueError("request too large")
        raw = self.rfile.read(length) if length else b"{}"
        payload = json.loads(raw.decode("utf-8"))
        if not isinstance(payload, dict):
            raise ValueError("JSON object required")
        return payload

    def _json(self, payload: dict[str, object], status: HTTPStatus = HTTPStatus.OK,
              headers: dict[str, str] | None = None) -> None:
        if "error" in payload and "error_code" not in payload:
            message = str(payload["error"])
            payload = dict(payload)
            payload["error_code"] = ERROR_CODES.get(message, "error.unexpected")
            payload["error_params"] = {}
            if message not in ERROR_CODES:
                payload["error_detail"] = message
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        for name, value in (headers or {}).items():
            self.send_header(name, value)
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
    reporter.update(stage=STAGE_SCAN, stage_code="job.stage.scan", message="正在扫描目录", message_code="job.message.scanning", message_params={})
    scanned = scan_library(root)
    reporter.update(
        stage=STAGE_WRITE,
        total=len(scanned),
        completed=0,
        message=f"扫描到 {len(scanned)} 个作品，正在写入缓存",
        stage_code="job.stage.write",
        message_code="job.message.scan_found",
        message_params={"count": len(scanned)},
    )

    with Store(DB_PATH) as store:
        store.upsert_scanned(scanned)

    if should_fetch:
        _fetch_works(reporter, scanned, proxy)
    else:
        reporter.update(
            completed=len(scanned),
            message=f"本次扫描识别 {len(scanned)} 个作品",
            message_code="job.message.scan_complete",
            message_params={"count": len(scanned)},
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
        stage_code="job.stage.fetch",
        message_code="job.message.fetch_preparing",
        message_params={"total": total},
    )
    if total == 0:
        reporter.update(message="没有需要抓取的作品", message_code="job.message.fetch_none", message_params={})
        return

    for index, work in enumerate(works, start=1):
        reporter.update(
            completed=index - 1,
            current_rj=work.rj,
            message=f"正在抓取 {work.rj}",
            message_code="job.message.fetching",
            message_params={"rj": work.rj},
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
            message_code="job.message.progress",
            message_params={"completed": index, "total": total},
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
        stage_code="job.stage.fetch",
        message_code="job.message.metrics_preparing",
        message_params={"total": total},
    )
    if total == 0:
        reporter.update(message="没有缺失销量或评价指标的作品", message_code="job.message.metrics_none", message_params={})
        return

    for index, work in enumerate(works, start=1):
        reporter.update(
            completed=index - 1,
            current_rj=work.rj,
            message=f"正在刷新 {work.rj} 的销量与评价",
            message_code="job.message.metrics_refreshing",
            message_params={"rj": work.rj},
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
            message_code="job.message.progress",
            message_params={"completed": index, "total": total},
        )


def parse_query_filters(query: str, *, include_entities: bool) -> dict[str, str]:
    params = urllib.parse.parse_qs(query, keep_blank_values=False)
    names = ["release_year", "status", "path"]
    if include_entities:
        names.extend(["tag", "voice_actor", "circle"])
    return {name: str(params.get(name, [""])[0]).strip() for name in names}


def parse_search_query(query: str) -> dict[str, object]:
    params = urllib.parse.parse_qs(query, keep_blank_values=False)

    def first(name: str) -> str:
        return str(params.get(name, [""])[0]).strip()

    return {
        "q": first("q"),
        "release_years": [str(value).strip() for value in params.get("release_year", [])],
        "status": first("status"),
        "path": first("path"),
        "tags": [str(value).strip() for value in params.get("tag", [])],
        "voice_actors": [str(value).strip() for value in params.get("voice_actor", [])],
        "circles": [str(value).strip() for value in params.get("circle", [])],
        "sort_by": first("sort_by"),
        "sort_dir": first("sort_dir"),
    }


def open_directory(path: Path) -> None:
    if os.name != "nt" or not path.is_absolute():
        raise OSError("unsupported platform")
    subprocess.Popen(["explorer.exe", str(path)], close_fds=True)


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
        EVERYTHING_WORKER.close()
        threading.Thread(target=server.shutdown, daemon=True).start()


if __name__ == "__main__":
    main()
