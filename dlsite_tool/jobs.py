from __future__ import annotations

import threading
import uuid
from dataclasses import dataclass
from typing import Callable

from .models import utc_now_iso


JOB_RUNNING = "running"
JOB_SUCCESS = "success"
JOB_FAILED = "failed"

STAGE_SCAN = "扫描目录"
STAGE_WRITE = "写入缓存"
STAGE_FETCH = "抓取官网信息"
STAGE_DONE = "完成"


@dataclass
class Job:
    id: str
    type: str
    status: str = JOB_RUNNING
    stage: str = ""
    total: int = 0
    completed: int = 0
    current_rj: str = ""
    message: str = ""
    stage_code: str = ""
    message_code: str = ""
    message_params: dict[str, object] | None = None
    last_error: str = ""
    started_at: str = ""
    finished_at: str = ""

    def to_dict(self) -> dict[str, object]:
        return {
            "id": self.id,
            "type": self.type,
            "status": self.status,
            "stage": self.stage,
            "total": self.total,
            "completed": self.completed,
            "current_rj": self.current_rj,
            "message": self.message,
            "stage_code": self.stage_code,
            "message_code": self.message_code,
            "message_params": self.message_params or {},
            "last_error": self.last_error,
            "started_at": self.started_at,
            "finished_at": self.finished_at,
        }


class JobManager:
    def __init__(self) -> None:
        self._jobs: dict[str, Job] = {}
        self._lock = threading.Lock()
        self._active_job_id = ""

    def start(self, job_type: str, target: Callable[[JobReporter], None]) -> Job:
        with self._lock:
            active = self._active_job()
            if active:
                raise RuntimeError(f"已有任务正在运行：{active.stage or active.type}")

            job = Job(
                id=uuid.uuid4().hex,
                type=job_type,
                stage="准备中",
                message="任务已创建",
                stage_code="job.stage.preparing",
                message_code="job.message.created",
                message_params={},
                started_at=utc_now_iso(),
            )
            self._jobs[job.id] = job
            self._active_job_id = job.id

        thread = threading.Thread(
            target=self._run,
            args=(job.id, target),
            daemon=True,
        )
        thread.start()
        return job

    def get(self, job_id: str) -> Job | None:
        with self._lock:
            job = self._jobs.get(job_id)
            return _copy_job(job) if job else None

    def _run(self, job_id: str, target: Callable[[JobReporter], None]) -> None:
        reporter = JobReporter(self, job_id)
        try:
            target(reporter)
            reporter.succeed()
        except Exception as exc:
            reporter.fail(str(exc))

    def _update(self, job_id: str, **changes: object) -> None:
        with self._lock:
            job = self._jobs[job_id]
            for key, value in changes.items():
                setattr(job, key, value)
            if job.status != JOB_RUNNING and self._active_job_id == job_id:
                self._active_job_id = ""

    def _active_job(self) -> Job | None:
        job = self._jobs.get(self._active_job_id)
        if job and job.status == JOB_RUNNING:
            return job
        return None


class JobReporter:
    def __init__(self, manager: JobManager, job_id: str) -> None:
        self._manager = manager
        self._job_id = job_id

    def update(
        self,
        *,
        stage: str | None = None,
        total: int | None = None,
        completed: int | None = None,
        current_rj: str | None = None,
        message: str | None = None,
        stage_code: str | None = None,
        message_code: str | None = None,
        message_params: dict[str, object] | None = None,
        last_error: str | None = None,
    ) -> None:
        changes: dict[str, object] = {}
        if stage is not None:
            changes["stage"] = stage
        if total is not None:
            changes["total"] = total
        if completed is not None:
            changes["completed"] = completed
        if current_rj is not None:
            changes["current_rj"] = current_rj
        if message is not None:
            changes["message"] = message
        if stage_code is not None:
            changes["stage_code"] = stage_code
        if message_code is not None:
            changes["message_code"] = message_code
        if message_params is not None:
            changes["message_params"] = message_params
        if last_error is not None:
            changes["last_error"] = last_error
        self._manager._update(self._job_id, **changes)

    def succeed(self) -> None:
        self._manager._update(
            self._job_id,
            status=JOB_SUCCESS,
            stage=STAGE_DONE,
            stage_code="job.stage.done",
            current_rj="",
            message="任务完成",
            message_code="job.message.completed",
            message_params={},
            finished_at=utc_now_iso(),
        )

    def fail(self, error: str) -> None:
        self._manager._update(
            self._job_id,
            status=JOB_FAILED,
            current_rj="",
            message="任务失败",
            message_code="job.message.failed",
            message_params={},
            last_error=error,
            finished_at=utc_now_iso(),
        )


def _copy_job(job: Job | None) -> Job | None:
    if job is None:
        return None
    return Job(**job.to_dict())
