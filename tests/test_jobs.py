from __future__ import annotations

import threading
import time

from dlsite_tool.jobs import JOB_RUNNING, JOB_SUCCESS, JobManager


def wait_for_job(manager: JobManager, job_id: str, status: str, timeout: float = 2.0) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        job = manager.get(job_id)
        if job and job.status == status:
            return
        time.sleep(0.01)
    raise AssertionError(f"job {job_id} did not reach {status}")


def test_job_manager_reports_success_progress() -> None:
    manager = JobManager()

    job = manager.start(
        "fetch",
        lambda reporter: reporter.update(
            stage="抓取官网信息",
            total=2,
            completed=1,
            current_rj="RJ00000001",
            message="正在抓取 RJ00000001",
        ),
    )

    wait_for_job(manager, job.id, JOB_SUCCESS)
    finished = manager.get(job.id)

    assert finished is not None
    assert finished.status == JOB_SUCCESS
    assert finished.stage == "完成"
    assert finished.total == 2
    assert finished.completed == 1
    assert finished.finished_at


def test_job_manager_rejects_second_running_job() -> None:
    manager = JobManager()
    release = threading.Event()

    first = manager.start("fetch", lambda _reporter: release.wait(1))
    running = manager.get(first.id)

    assert running is not None
    assert running.status == JOB_RUNNING

    rejected = False
    try:
        manager.start("scan", lambda _reporter: None)
    except RuntimeError as exc:
        rejected = "已有任务正在运行" in str(exc)

    assert rejected

    release.set()
    wait_for_job(manager, first.id, JOB_SUCCESS)
