from __future__ import annotations

import json
import multiprocessing
import threading
import time
from multiprocessing.connection import Connection
from typing import Callable

from .everything import EverythingError, perform_search


QUERY_TIMEOUT_SECONDS = 1.0
IDLE_SECONDS = 300.0


def worker_main(connection: Connection) -> None:
    try:
        while True:
            message = json.loads(connection.recv_bytes().decode("utf-8"))
            if message.get("command") == "stop":
                return
            started = time.perf_counter()
            try:
                paths = perform_search(str(message["mode"]), str(message["query"]))
                connection.send_bytes(json.dumps({"ok": True, "paths": paths, "elapsed_ms": (time.perf_counter() - started) * 1000}, ensure_ascii=False).encode("utf-8"))
            except Exception as exc:
                safe = str(exc) if isinstance(exc, EverythingError) else "Everything 查询进程发生异常"
                connection.send_bytes(json.dumps({"ok": False, "error": safe, "elapsed_ms": (time.perf_counter() - started) * 1000}, ensure_ascii=False).encode("utf-8"))
    except (EOFError, BrokenPipeError, KeyboardInterrupt):
        return
    finally:
        connection.close()


class EverythingWorkerManager:
    def __init__(self, *, timeout: float = QUERY_TIMEOUT_SECONDS, idle_seconds: float = IDLE_SECONDS,
                 process_factory: Callable[..., multiprocessing.Process] | None = None) -> None:
        self.timeout = timeout
        self.idle_seconds = idle_seconds
        self.process_factory = process_factory or multiprocessing.get_context("spawn").Process
        self._lock = threading.Lock()
        self._state_lock = threading.Lock()
        self._process: multiprocessing.Process | None = None
        self._connection: Connection | None = None
        self._last_used = 0.0
        self._closed = False
        self._reaper: threading.Thread | None = None

    def query(self, mode: str, query: str) -> dict[str, object]:
        if not self._lock.acquire(timeout=0.025):
            raise EverythingError("Everything 搜索繁忙，请稍后重试")
        try:
            connection = self._ensure_worker()
            self._last_used = time.monotonic()
            try:
                connection.send_bytes(json.dumps({"command": "query", "mode": mode, "query": query}, ensure_ascii=False).encode("utf-8"))
                if not connection.poll(self.timeout):
                    self._terminate_worker()
                    raise EverythingError("Everything 查询超时，请稍后重试")
                result = json.loads(connection.recv_bytes().decode("utf-8"))
            except (EOFError, BrokenPipeError, OSError) as exc:
                self._terminate_worker()
                raise EverythingError("Everything 查询进程已断开，请重试") from exc
            self._last_used = time.monotonic()
            if not result.get("ok"):
                raise EverythingError(str(result.get("error") or "Everything 查询失败"))
            return result
        finally:
            self._lock.release()

    def _ensure_worker(self) -> Connection:
        with self._state_lock:
            if self._closed:
                raise EverythingError("Everything 查询服务已关闭")
            if self._process is not None and self._process.is_alive() and self._connection is not None:
                return self._connection
            parent, child = multiprocessing.Pipe(duplex=True)
            process = self.process_factory(target=worker_main, args=(child,), daemon=True, name="everything-sdk-worker")
            process.start()
            child.close()
            self._process, self._connection = process, parent
            self._last_used = time.monotonic()
            if self._reaper is None:
                self._reaper = threading.Thread(target=self._reap_loop, daemon=True, name="everything-worker-reaper")
                self._reaper.start()
            return parent

    def _terminate_worker(self) -> None:
        with self._state_lock:
            process, connection = self._process, self._connection
            self._process = None
            self._connection = None
            if connection is not None:
                connection.close()
            if process is not None and process.is_alive():
                process.terminate()
                process.join(timeout=0.5)

    def _reap_loop(self) -> None:
        while not self._closed:
            time.sleep(min(1.0, max(0.1, self.idle_seconds / 4)))
            if self._process is not None and time.monotonic() - self._last_used >= self.idle_seconds:
                if self._lock.acquire(blocking=False):
                    try:
                        self._terminate_worker()
                    finally:
                        self._lock.release()

    def close(self) -> None:
        self._closed = True
        if self._lock.acquire(timeout=0.25):
            try:
                with self._state_lock:
                    process, connection = self._process, self._connection
                if process is not None and process.is_alive() and connection is not None:
                    try:
                        connection.send_bytes(json.dumps({"command": "stop"}).encode("utf-8"))
                        process.join(timeout=0.5)
                    except (BrokenPipeError, OSError):
                        pass
                self._terminate_worker()
            finally:
                self._lock.release()
