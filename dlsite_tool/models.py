from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone


STATUS_UNFETCHED = "未抓取"
STATUS_SUCCESS = "成功"
STATUS_PARTIAL = "部分成功"
STATUS_FAILED = "失败"


@dataclass
class Work:
    rj: str
    local_title: str = ""
    official_title: str = ""
    circle: str = ""
    voice_actors: str = ""
    release_date: str = ""
    tags: str = ""
    cover_url: str = ""
    work_url: str = ""
    fetch_status: str = STATUS_UNFETCHED
    failure_reason: str = ""
    last_fetched_at: str = ""
    sales_count: int | None = None
    rating_average: float | None = None
    rating_count: int | None = None
    metrics_failure_reason: str = ""
    metrics_last_fetched_at: str = ""
    local_paths: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, object]:
        return {
            "rj": self.rj,
            "local_title": self.local_title,
            "official_title": self.official_title,
            "circle": self.circle,
            "voice_actors": self.voice_actors,
            "release_date": self.release_date,
            "tags": self.tags,
            "cover_url": self.cover_url,
            "work_url": self.work_url,
            "local_paths": self.local_paths,
            "fetch_status": self.fetch_status,
            "failure_reason": self.failure_reason,
            "last_fetched_at": self.last_fetched_at,
            "sales_count": self.sales_count,
            "rating_average": self.rating_average,
            "rating_count": self.rating_count,
            "metrics_failure_reason": self.metrics_failure_reason,
            "metrics_last_fetched_at": self.metrics_last_fetched_at,
        }


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()
