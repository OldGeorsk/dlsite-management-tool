from __future__ import annotations

import json
import multiprocessing
import threading
import time
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path

import pytest

import server
from dlsite_tool.db import Store
from dlsite_tool.everything import (
    EverythingSDK,
    EverythingError,
    dll_name_for_runtime,
    filter_keyword_paths,
    filter_rj_paths,
    sdk_literal_query,
)
from dlsite_tool.local_access import CandidateTokens, SessionTokens, TimingBuffer
from dlsite_tool.everything_worker import EverythingWorkerManager
from dlsite_tool.models import Work


def test_runtime_architecture_mapping() -> None:
    assert dll_name_for_runtime(system="Windows", machine="AMD64", pointer_bits=64) == "Everything64.dll"
    assert dll_name_for_runtime(system="Windows", machine="AMD64", pointer_bits=32) == "Everything32.dll"
    assert dll_name_for_runtime(system="Windows", machine="ARM64", pointer_bits=64) == "EverythingARM64.dll"
    assert dll_name_for_runtime(system="Windows", machine="ARM", pointer_bits=32) == "EverythingARM.dll"
    with pytest.raises(EverythingError):
        dll_name_for_runtime(system="Linux", machine="x86_64", pointer_bits=64)


def test_named_instance_is_rejected_instead_of_silently_ignored(monkeypatch) -> None:
    monkeypatch.setenv("EVERYTHING_INSTANCE_NAME", "secondary")
    with pytest.raises(EverythingError, match="不支持命名实例"):
        EverythingSDK()


def test_literal_query_and_keyword_filter_do_not_expose_operators() -> None:
    query = sdk_literal_query('regex:*.wav "private"')
    assert query == 'folder: "regex:*.wav" """private"""'
    paths = [
        r"example-library\private regex wav",
        r"example-library\private\regex-only",
        r"example-library\unrelated",
    ]
    assert filter_keyword_paths(paths, "private regex") == [
        r"example-library\private regex wav",
        r"example-library\private\regex-only",
    ]


def test_rj_filter_requires_directory_name_and_keeps_highest_root() -> None:
    paths = [
        r"example-library\RJ00000001 title",
        r"example-library\RJ00000001 title\RJ00000001 child",
        r"example-library\RJ00000002 wrong",
        r"example-library\RJ00000001 parent\audio",
    ]
    assert filter_rj_paths(paths, "RJ00000001") == [r"example-library\RJ00000001 title"]


def test_tokens_are_bounded_bound_to_purpose_and_timings_are_anonymous() -> None:
    sessions = SessionTokens(capacity=1)
    first, second = sessions.issue(), sessions.issue()
    assert not sessions.valid(first) and sessions.valid(second)

    candidates = CandidateTokens(capacity=2, ttl_seconds=60)
    opened = candidates.issue("RJ00000001", r"example-library\RJ00000001", "open")
    saved = candidates.issue("RJ00000001", r"example-library\RJ00000001", "save")
    assert candidates.consume(opened, "RJ00000001", "save") is None
    assert candidates.consume(saved, "RJ00000001", "save") is not None
    assert candidates.consume(saved, "RJ00000001", "save") is None

    timings = TimingBuffer(capacity=2)
    timings.record(12.3456, "success")
    timings.record(1000, "timeout", True)
    timings.record(8, "success")
    assert timings.snapshot() == [(1000.0, "timeout", True), (8.0, "success", False)]


class FakeWorker:
    def query(self, mode: str, query: str) -> dict[str, object]:
        return {"paths": [rf"example-library\{query} title"], "elapsed_ms": 4.5}


class HangingConnection:
    def send_bytes(self, _message): pass
    def poll(self, _timeout): return False
    def close(self): pass


class HangingProcess:
    def __init__(self) -> None:
        self.terminated = False
    def is_alive(self): return not self.terminated
    def start(self): pass
    def terminate(self): self.terminated = True
    def join(self, timeout=None): pass


def test_worker_timeout_terminates_stuck_process() -> None:
    manager = EverythingWorkerManager(timeout=0.01, idle_seconds=60)
    process = HangingProcess()
    manager._process = process
    manager._connection = HangingConnection()
    with pytest.raises(EverythingError, match="超时"):
        manager.query("rj", "RJ00000001")
    assert process.terminated
    assert manager._process is None
    manager.close()


def test_worker_manager_does_not_start_background_thread_before_first_query() -> None:
    manager = EverythingWorkerManager(timeout=0.01, idle_seconds=60)
    assert manager._process is None
    assert manager._reaper is None
    manager.close()


def test_idle_worker_is_terminated() -> None:
    process = HangingProcess()
    manager = EverythingWorkerManager(
        timeout=0.01,
        idle_seconds=0.05,
        process_factory=lambda **_kwargs: process,
    )
    manager._ensure_worker()
    deadline = time.monotonic() + 1
    while manager._process is not None and time.monotonic() < deadline:
        time.sleep(0.01)
    assert manager._process is None
    assert process.terminated
    manager.close()


def _request(port: int, path: str, payload: dict[str, object], token: str = "", origin: str | None = None):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["X-Local-Session"] = token
    if origin:
        headers["Origin"] = origin
    return urllib.request.Request(
        f"http://127.0.0.1:{port}{path}",
        data=json.dumps(payload).encode("utf-8"),
        headers=headers,
        method="POST",
    )


def test_sensitive_api_rejects_cross_origin_and_adds_valid_path(tmp_path: Path, monkeypatch) -> None:
    db_path = tmp_path / "paths.sqlite3"
    work_dir = tmp_path / "RJ00000001 title"
    work_dir.mkdir()
    missing = str(tmp_path / "RJ00000001 missing")
    with Store(db_path) as store:
        store.upsert_scanned([Work(rj="RJ00000001", local_paths=[missing])])

    monkeypatch.setattr(server, "DB_PATH", db_path)
    monkeypatch.setattr(server, "EVERYTHING_WORKER", FakeWorker())
    monkeypatch.setattr(server, "SESSIONS", SessionTokens())
    monkeypatch.setattr(server, "CANDIDATES", CandidateTokens())
    opened: list[Path] = []
    monkeypatch.setattr(server, "open_directory", lambda path: opened.append(path))

    httpd = ThreadingHTTPServer(("127.0.0.1", 0), server.AppHandler)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    origin = f"http://127.0.0.1:{httpd.server_port}"
    try:
        with urllib.request.urlopen(f"{origin}/api/session", timeout=2) as response:
            token = json.loads(response.read().decode("utf-8"))["token"]

        bad = _request(httpd.server_port, "/api/local-paths", {"mode": "rj", "rj": "RJ00000001"}, token, "https://evil.example")
        with pytest.raises(urllib.error.HTTPError) as exc:
            urllib.request.urlopen(bad, timeout=2)
        assert exc.value.code == 403

        missing_request = _request(httpd.server_port, "/api/paths/open-saved", {"rj": "RJ00000001", "path": missing}, token, origin)
        with pytest.raises(urllib.error.HTTPError) as exc:
            urllib.request.urlopen(missing_request, timeout=2)
        assert exc.value.code == 404
        assert json.loads(exc.value.read().decode("utf-8"))["status"] == "missing"

        manual = _request(httpd.server_port, "/api/paths/add-manual", {"rj": "RJ00000001", "path": str(work_dir)}, token, origin)
        with urllib.request.urlopen(manual, timeout=2) as response:
            assert json.loads(response.read().decode("utf-8"))["status"] == "added"
        with Store(db_path) as store:
            assert store.get_work("RJ00000001").local_paths == sorted([missing, str(work_dir)])

        saved = _request(httpd.server_port, "/api/paths/open-saved", {"rj": "RJ00000001", "path": str(work_dir)}, token, origin)
        with urllib.request.urlopen(saved, timeout=2):
            pass
        assert opened == [work_dir]
    finally:
        httpd.shutdown()
        httpd.server_close()
        thread.join(timeout=2)


def test_local_paths_returns_tokens_without_total_count(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(server, "EVERYTHING_WORKER", FakeWorker())
    monkeypatch.setattr(server, "SESSIONS", SessionTokens())
    monkeypatch.setattr(server, "CANDIDATES", CandidateTokens())
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), server.AppHandler)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    origin = f"http://127.0.0.1:{httpd.server_port}"
    try:
        with urllib.request.urlopen(f"{origin}/api/session", timeout=2) as response:
            token = json.loads(response.read().decode("utf-8"))["token"]
        request = _request(httpd.server_port, "/api/local-paths", {"mode": "rj", "rj": "RJ00000001"}, token, origin)
        with urllib.request.urlopen(request, timeout=2) as response:
            payload = json.loads(response.read().decode("utf-8"))
        assert set(payload) == {"candidates"}
        assert set(payload["candidates"][0]) == {"path", "open_token", "save_token"}
        assert "RJ00000001" not in payload["candidates"][0]["open_token"]
    finally:
        httpd.shutdown()
        httpd.server_close()
        thread.join(timeout=2)


def test_sensitive_api_rejects_invalid_json_without_echo(monkeypatch) -> None:
    monkeypatch.setattr(server, "SESSIONS", SessionTokens())
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), server.AppHandler)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    origin = f"http://127.0.0.1:{httpd.server_port}"
    try:
        with urllib.request.urlopen(f"{origin}/api/session", timeout=2) as response:
            token = json.loads(response.read().decode("utf-8"))["token"]
        secret = "private-path-fragment"
        request = urllib.request.Request(
            f"{origin}/api/local-paths",
            data=("{" + secret).encode("utf-8"),
            headers={"Content-Type": "application/json", "Origin": origin, "X-Local-Session": token},
            method="POST",
        )
        with pytest.raises(urllib.error.HTTPError) as exc:
            urllib.request.urlopen(request, timeout=2)
        body = exc.value.read().decode("utf-8")
        assert exc.value.code == 400
        assert secret not in body
    finally:
        httpd.shutdown()
        httpd.server_close()
        thread.join(timeout=2)
