from __future__ import annotations

import secrets
import threading
import time
from collections import OrderedDict, deque
from dataclasses import dataclass


@dataclass(frozen=True)
class Candidate:
    rj: str
    path: str
    purpose: str
    expires_at: float


class SessionTokens:
    def __init__(self, capacity: int = 64) -> None:
        self.capacity = capacity
        self._tokens: OrderedDict[str, None] = OrderedDict()
        self._lock = threading.Lock()

    def issue(self) -> str:
        token = secrets.token_urlsafe(32)
        with self._lock:
            self._tokens[token] = None
            while len(self._tokens) > self.capacity:
                self._tokens.popitem(last=False)
        return token

    def valid(self, token: str) -> bool:
        with self._lock:
            return bool(token) and token in self._tokens


class CandidateTokens:
    def __init__(self, capacity: int = 512, ttl_seconds: float = 120.0) -> None:
        self.capacity = capacity
        self.ttl_seconds = ttl_seconds
        self._items: OrderedDict[str, Candidate] = OrderedDict()
        self._lock = threading.Lock()

    def issue(self, rj: str, path: str, purpose: str) -> str:
        token = secrets.token_urlsafe(24)
        now = time.monotonic()
        with self._lock:
            self._purge(now)
            self._items[token] = Candidate(rj.upper(), path, purpose, now + self.ttl_seconds)
            while len(self._items) > self.capacity:
                self._items.popitem(last=False)
        return token

    def consume(self, token: str, rj: str, purpose: str) -> Candidate | None:
        now = time.monotonic()
        with self._lock:
            self._purge(now)
            item = self._items.pop(token, None)
        return item if item and item.rj == rj.upper() and item.purpose == purpose else None

    def _purge(self, now: float) -> None:
        for token in [key for key, item in self._items.items() if item.expires_at <= now]:
            self._items.pop(token, None)


class TimingBuffer:
    def __init__(self, capacity: int = 256) -> None:
        self._items: deque[tuple[float, str, bool]] = deque(maxlen=capacity)
        self._lock = threading.Lock()

    def record(self, elapsed_ms: float, category: str, timed_out: bool = False) -> None:
        with self._lock:
            self._items.append((round(float(elapsed_ms), 3), str(category), bool(timed_out)))

    def snapshot(self) -> list[tuple[float, str, bool]]:
        with self._lock:
            return list(self._items)
