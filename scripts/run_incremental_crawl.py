from __future__ import annotations

import argparse
import html
import json
import shutil
import time
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

from dlsite_tool.db import Store
from dlsite_tool.models import STATUS_FAILED, Work
from dlsite_tool.scanner import scan_library
from dlsite_tool.scraper import fetch_metadata


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def month_for(work: Work, root: Path) -> str:
    if not work.local_paths:
        return "未知"
    try:
        return Path(work.local_paths[0]).relative_to(root).parts[0]
    except (ValueError, IndexError):
        return "其他"


def write_report(
    output: Path,
    root: Path,
    started_at: str,
    scanned: list[Work],
    baseline_rjs: set[str],
    attempted: dict[str, int],
    stopped_reason: str,
    db_path: Path,
) -> None:
    with Store(db_path) as store:
        stored = {work.rj: work for work in store.list_works()}
    rows = [stored.get(work.rj, work) for work in scanned]
    status_counts = Counter(work.fetch_status for work in rows)
    month_rows: dict[str, list[Work]] = defaultdict(list)
    scanned_by_rj = {work.rj: work for work in scanned}
    for work in rows:
        month_rows[month_for(scanned_by_rj[work.rj], root)].append(work)

    attempted_statuses = Counter(
        stored[rj].fetch_status for rj in attempted if rj in stored
    )
    completed_attempts = len(attempted)
    new_total = sum(1 for work in scanned if work.rj not in baseline_rjs)
    remaining = max(new_total - completed_attempts, 0)

    def esc(value: object) -> str:
        return html.escape(str(value or ""))

    month_table = []
    for month, works in sorted(month_rows.items()):
        counts = Counter(work.fetch_status for work in works)
        month_table.append(
            "<tr>"
            f"<td>{esc(month)}</td><td>{len(works)}</td>"
            f"<td>{counts.get('成功', 0)}</td>"
            f"<td>{counts.get('部分成功', 0)}</td>"
            f"<td>{counts.get('失败', 0)}</td>"
            f"<td>{counts.get('未抓取', 0)}</td>"
            "</tr>"
        )

    detail_rows = []
    for work in rows:
        source = scanned_by_rj[work.rj]
        if work.rj in baseline_rjs:
            action = "历史记录（跳过）"
        elif work.rj in attempted:
            action = f"本次抓取（{attempted[work.rj]} 次尝试）"
        else:
            action = "本次未处理"
        paths = "<br>".join(esc(path) for path in source.local_paths)
        url = esc(work.work_url)
        url_cell = f'<a href="{url}">{url}</a>' if url else ""
        detail_rows.append(
            "<tr>"
            f"<td>{esc(month_for(source, root))}</td>"
            f"<td>{esc(work.rj)}</td>"
            f"<td>{esc(work.local_title)}</td>"
            f"<td>{esc(work.official_title)}</td>"
            f"<td>{esc(work.circle)}</td>"
            f"<td>{esc(work.voice_actors)}</td>"
            f"<td>{esc(work.release_date)}</td>"
            f"<td>{esc(work.tags)}</td>"
            f"<td>{esc(work.fetch_status)}</td>"
            f"<td>{esc(action)}</td>"
            f"<td>{esc(work.failure_reason)}</td>"
            f"<td>{esc(work.last_fetched_at)}</td>"
            f"<td>{url_cell}</td>"
            f"<td>{paths}</td>"
            "</tr>"
        )

    outcome = "提前停止" if stopped_reason else "完整完成"
    stopped_block = (
        f'<div class="alert"><strong>停止原因：</strong>{esc(stopped_reason)}</div>'
        if stopped_reason
        else ""
    )
    document = f"""<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>DLsite 音声库增量抓取报告</title>
<style>
body{{font-family:system-ui,"Microsoft YaHei",sans-serif;margin:24px;color:#202124;background:#f7f8fa}}
h1,h2{{color:#18212f}} .meta,.cards,.alert,table{{background:white;border:1px solid #dfe3e8;border-radius:10px}}
.meta,.alert{{padding:14px;margin:12px 0}} .alert{{border-color:#d93025;color:#8a1c13}}
.cards{{display:flex;flex-wrap:wrap;gap:12px;padding:14px}} .card{{min-width:130px}}
.number{{font-size:26px;font-weight:700}} .label{{color:#5f6368}}
.table-wrap{{overflow:auto;background:white;border-radius:10px}} table{{border-collapse:collapse;width:100%;font-size:13px}}
th,td{{padding:8px;border-bottom:1px solid #e5e7eb;text-align:left;vertical-align:top}} th{{position:sticky;top:0;background:#eef2f7}}
td{{max-width:320px;overflow-wrap:anywhere}} a{{color:#1467c5}} .ok{{color:#137333}}
</style></head><body>
<h1>DLsite 音声库增量抓取报告</h1>
<div class="meta">运行结果：<strong>{outcome}</strong><br>扫描目录：{esc(root)}<br>开始时间（UTC）：{esc(started_at)}<br>报告时间（UTC）：{esc(now_iso())}<br>数据库：{esc(db_path)}</div>
{stopped_block}
<div class="cards">
<div class="card"><div class="number">{len(rows)}</div><div class="label">扫描作品</div></div>
<div class="card"><div class="number">{len(baseline_rjs & set(scanned_by_rj))}</div><div class="label">历史跳过</div></div>
<div class="card"><div class="number">{new_total}</div><div class="label">新增待抓</div></div>
<div class="card"><div class="number">{completed_attempts}</div><div class="label">本次已尝试</div></div>
<div class="card"><div class="number">{remaining}</div><div class="label">本次剩余</div></div>
<div class="card"><div class="number">{status_counts.get('成功', 0)}</div><div class="label">当前成功</div></div>
<div class="card"><div class="number">{status_counts.get('部分成功', 0)}</div><div class="label">当前部分成功</div></div>
<div class="card"><div class="number">{status_counts.get('失败', 0)}</div><div class="label">当前失败</div></div>
<div class="card"><div class="number">{status_counts.get('未抓取', 0)}</div><div class="label">当前未抓取</div></div>
</div>
<h2>本次抓取状态</h2>
<div class="meta">{esc(json.dumps(dict(attempted_statuses), ensure_ascii=False))}</div>
<h2>月份统计</h2><div class="table-wrap"><table><thead><tr><th>月份</th><th>总数</th><th>成功</th><th>部分成功</th><th>失败</th><th>未抓取</th></tr></thead><tbody>{''.join(month_table)}</tbody></table></div>
<h2>作品明细</h2><div class="table-wrap"><table><thead><tr><th>月份</th><th>RJ</th><th>本地标题</th><th>官网标题</th><th>社团</th><th>声优</th><th>发售日</th><th>标签</th><th>状态</th><th>处理方式</th><th>失败/缺失原因</th><th>最后抓取时间</th><th>作品 URL</th><th>本地路径</th></tr></thead><tbody>{''.join(detail_rows)}</tbody></table></div>
</body></html>"""
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(document, encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("root", type=Path)
    parser.add_argument("--db", type=Path, default=Path("data/dlsite_tool.sqlite3"))
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--proxy", default="")
    parser.add_argument("--timeout", type=int, default=20)
    parser.add_argument("--max-attempts", type=int, default=5)
    args = parser.parse_args()

    started_at = now_iso()
    scanned = scan_library(str(args.root))
    with Store(args.db) as store:
        baseline = store.list_works()
        baseline_rjs = {work.rj for work in baseline}

    backup = args.db.with_name(f"{args.db.stem}.before-{datetime.now().strftime('%Y%m%d-%H%M%S')}{args.db.suffix}")
    shutil.copy2(args.db, backup)
    with Store(args.db) as store:
        store.upsert_scanned(scanned)

    pending = [work for work in scanned if work.rj not in baseline_rjs]
    attempted: dict[str, int] = {}
    stopped_reason = ""
    print(json.dumps({"event": "start", "scanned": len(scanned), "baseline": len(baseline_rjs), "pending": len(pending), "backup": str(backup)}, ensure_ascii=True), flush=True)

    try:
        for index, work in enumerate(pending, start=1):
            metadata = None
            for attempt in range(1, args.max_attempts + 1):
                attempted[work.rj] = attempt
                metadata = fetch_metadata(work.rj, timeout=args.timeout, proxy=args.proxy)
                print(json.dumps({"event": "attempt", "index": index, "total": len(pending), "rj": work.rj, "attempt": attempt, "status": metadata.fetch_status, "reason": metadata.failure_reason}, ensure_ascii=True), flush=True)
                if metadata.fetch_status != STATUS_FAILED:
                    break
                if attempt < args.max_attempts:
                    time.sleep(min(attempt * 2, 8))

            assert metadata is not None
            with Store(args.db) as store:
                store.update_metadata(metadata)
            write_report(args.report, args.root, started_at, scanned, baseline_rjs, attempted, stopped_reason, args.db)

            if metadata.fetch_status == STATUS_FAILED:
                stopped_reason = f"{work.rj} 连续 {args.max_attempts} 次抓取失败：{metadata.failure_reason}"
                print(json.dumps({"event": "stopped", "reason": stopped_reason}, ensure_ascii=True), flush=True)
                break
    except BaseException as exc:
        stopped_reason = f"运行异常：{type(exc).__name__}: {exc}"
        raise
    finally:
        write_report(args.report, args.root, started_at, scanned, baseline_rjs, attempted, stopped_reason, args.db)
        print(json.dumps({"event": "report", "path": str(args.report), "stopped_reason": stopped_reason}, ensure_ascii=True), flush=True)
    return 2 if stopped_reason else 0


if __name__ == "__main__":
    raise SystemExit(main())
