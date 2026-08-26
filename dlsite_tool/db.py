from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Iterable

from .models import STATUS_UNFETCHED, Work


DB_PATH = Path("data/dlsite_tool.sqlite3")


class Store:
    def __init__(self, db_path: Path | str = DB_PATH) -> None:
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(self.db_path)
        self.conn.row_factory = sqlite3.Row
        self.init_schema()

    def __enter__(self) -> Store:
        return self

    def __exit__(self, *_args: object) -> None:
        self.close()

    def close(self) -> None:
        self.conn.close()

    def init_schema(self) -> None:
        self.conn.execute(
            """
            CREATE TABLE IF NOT EXISTS works (
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
                last_fetched_at TEXT NOT NULL DEFAULT '',
                sales_count INTEGER,
                rating_average REAL,
                rating_count INTEGER,
                metrics_failure_reason TEXT NOT NULL DEFAULT '',
                metrics_last_fetched_at TEXT NOT NULL DEFAULT ''
            )
            """
        )
        self.conn.execute(
            """
            CREATE TABLE IF NOT EXISTS work_paths (
                rj TEXT NOT NULL,
                path TEXT NOT NULL,
                PRIMARY KEY (rj, path),
                FOREIGN KEY (rj) REFERENCES works(rj) ON DELETE CASCADE
            )
            """
        )
        self._migrate_works_columns()
        self.conn.commit()

    def _migrate_works_columns(self) -> None:
        existing = {
            row["name"]
            for row in self.conn.execute("PRAGMA table_info(works)").fetchall()
        }
        additions = {
            "sales_count": "INTEGER",
            "rating_average": "REAL",
            "rating_count": "INTEGER",
            "metrics_failure_reason": "TEXT NOT NULL DEFAULT ''",
            "metrics_last_fetched_at": "TEXT NOT NULL DEFAULT ''",
        }
        for name, definition in additions.items():
            if name not in existing:
                self.conn.execute(f"ALTER TABLE works ADD COLUMN {name} {definition}")

    def upsert_scanned(self, works: Iterable[Work]) -> None:
        for work in works:
            self.conn.execute(
                """
                INSERT INTO works (rj, local_title, fetch_status)
                VALUES (?, ?, ?)
                ON CONFLICT(rj) DO UPDATE SET
                    local_title = CASE
                        WHEN works.local_title = '' THEN excluded.local_title
                        ELSE works.local_title
                    END
                """,
                (work.rj, work.local_title, STATUS_UNFETCHED),
            )
            for path in work.local_paths:
                self.conn.execute(
                    "INSERT OR IGNORE INTO work_paths (rj, path) VALUES (?, ?)",
                    (work.rj, path),
                )
        self.conn.commit()

    def update_metadata(self, work: Work) -> None:
        existing = self.get_work(work.rj)
        if existing:
            merged = _merge_missing(existing, work)
        else:
            merged = work

        self.conn.execute(
            """
            INSERT INTO works (
                rj, local_title, official_title, circle, voice_actors, release_date,
                tags, cover_url, work_url, fetch_status, failure_reason, last_fetched_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(rj) DO UPDATE SET
                local_title = excluded.local_title,
                official_title = excluded.official_title,
                circle = excluded.circle,
                voice_actors = excluded.voice_actors,
                release_date = excluded.release_date,
                tags = excluded.tags,
                cover_url = excluded.cover_url,
                work_url = excluded.work_url,
                fetch_status = excluded.fetch_status,
                failure_reason = excluded.failure_reason,
                last_fetched_at = excluded.last_fetched_at
            """,
            (
                merged.rj,
                merged.local_title,
                merged.official_title,
                merged.circle,
                merged.voice_actors,
                merged.release_date,
                merged.tags,
                merged.cover_url,
                merged.work_url,
                merged.fetch_status,
                merged.failure_reason,
                merged.last_fetched_at,
            ),
        )
        self.conn.commit()

    def update_metrics(self, work: Work) -> None:
        self.conn.execute(
            "INSERT OR IGNORE INTO works (rj) VALUES (?)",
            (work.rj,),
        )
        self.conn.execute(
            """
            UPDATE works SET
                sales_count = COALESCE(?, sales_count),
                rating_average = CASE
                    WHEN ? IS NULL THEN rating_average
                    ELSE ?
                END,
                rating_count = COALESCE(?, rating_count),
                metrics_failure_reason = ?,
                metrics_last_fetched_at = ?
            WHERE rj = ?
            """,
            (
                work.sales_count,
                work.rating_count,
                work.rating_average,
                work.rating_count,
                work.metrics_failure_reason,
                work.metrics_last_fetched_at,
                work.rj,
            ),
        )
        self.conn.commit()

    def list_works(self) -> list[Work]:
        rows = self.conn.execute("SELECT * FROM works ORDER BY rj").fetchall()
        return [self._row_to_work(row) for row in rows]

    def get_work(self, rj: str) -> Work | None:
        row = self.conn.execute("SELECT * FROM works WHERE rj = ?", (rj,)).fetchone()
        return self._row_to_work(row) if row else None

    def add_path(self, rj: str, path: str) -> bool:
        before = self.conn.total_changes
        self.conn.execute(
            "INSERT OR IGNORE INTO work_paths (rj, path) VALUES (?, ?)",
            (rj, path),
        )
        self.conn.commit()
        return self.conn.total_changes > before

    def _row_to_work(self, row: sqlite3.Row) -> Work:
        path_rows = self.conn.execute(
            "SELECT path FROM work_paths WHERE rj = ? ORDER BY path",
            (row["rj"],),
        ).fetchall()
        return Work(
            rj=row["rj"],
            local_title=row["local_title"],
            official_title=row["official_title"],
            circle=row["circle"],
            voice_actors=row["voice_actors"],
            release_date=row["release_date"],
            tags=row["tags"],
            cover_url=row["cover_url"],
            work_url=row["work_url"],
            fetch_status=row["fetch_status"],
            failure_reason=row["failure_reason"],
            last_fetched_at=row["last_fetched_at"],
            sales_count=row["sales_count"],
            rating_average=row["rating_average"],
            rating_count=row["rating_count"],
            metrics_failure_reason=row["metrics_failure_reason"],
            metrics_last_fetched_at=row["metrics_last_fetched_at"],
            local_paths=[item["path"] for item in path_rows],
        )

    def to_json(self) -> str:
        return json.dumps([work.to_dict() for work in self.list_works()], ensure_ascii=False)


def _merge_missing(existing: Work, incoming: Work) -> Work:
    return Work(
        rj=existing.rj,
        local_title=existing.local_title or incoming.local_title,
        official_title=existing.official_title or incoming.official_title,
        circle=existing.circle or incoming.circle,
        voice_actors=existing.voice_actors or incoming.voice_actors,
        release_date=existing.release_date or incoming.release_date,
        tags=existing.tags or incoming.tags,
        cover_url=existing.cover_url or incoming.cover_url,
        work_url=existing.work_url or incoming.work_url,
        fetch_status=incoming.fetch_status or existing.fetch_status,
        failure_reason=incoming.failure_reason,
        last_fetched_at=incoming.last_fetched_at or existing.last_fetched_at,
        sales_count=existing.sales_count,
        rating_average=existing.rating_average,
        rating_count=existing.rating_count,
        metrics_failure_reason=existing.metrics_failure_reason,
        metrics_last_fetched_at=existing.metrics_last_fetched_at,
        local_paths=existing.local_paths,
    )
