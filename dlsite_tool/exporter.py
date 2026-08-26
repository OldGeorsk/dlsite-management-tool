from __future__ import annotations

from pathlib import Path

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

from .models import Work


HEADERS_ZH = [
    "RJ号",
    "本地标题",
    "官网标题",
    "社团",
    "声优",
    "发售日",
    "标签",
    "总售出数",
    "平均评分",
    "评价人数",
    "封面URL",
    "作品URL",
    "本地路径",
    "抓取状态",
    "失败原因",
    "最后抓取时间",
    "指标失败原因",
    "指标最后刷新时间",
]

HEADERS_EN = [
    "RJ ID", "Local Title", "Official Title", "Circle", "Voice Actors",
    "Release Date", "Tags", "Sales Count", "Average Rating", "Rating Count",
    "Cover URL", "Work URL", "Local Paths", "Fetch Status", "Failure Reason",
    "Last Fetched At", "Metrics Failure Reason", "Metrics Last Refreshed At",
]

HEADERS = HEADERS_ZH
STATUS_EN = {"未抓取": "Not Fetched", "成功": "Success", "部分成功": "Partial Success", "失败": "Failed"}


def export_xlsx(works: list[Work], output_path: str | Path, lang: str = "zh-CN") -> Path:
    path = Path(output_path)
    path.parent.mkdir(parents=True, exist_ok=True)

    workbook = Workbook()
    sheet = workbook.active
    locale = "en" if lang == "en" else "zh-CN"
    sheet.title = "DLsite Works" if locale == "en" else "DLsite作品"
    sheet.append(HEADERS_EN if locale == "en" else HEADERS_ZH)

    for cell in sheet[1]:
        cell.font = Font(bold=True)
        cell.fill = PatternFill("solid", fgColor="EAF2F8")
        cell.alignment = Alignment(vertical="center")

    for work in works:
        sheet.append(
            [
                work.rj,
                work.local_title,
                work.official_title,
                work.circle,
                work.voice_actors,
                work.release_date,
                work.tags,
                work.sales_count,
                work.rating_average,
                work.rating_count,
                work.cover_url,
                work.work_url,
                "\n".join(work.local_paths),
                STATUS_EN.get(work.fetch_status, work.fetch_status) if locale == "en" else work.fetch_status,
                work.failure_reason,
                work.last_fetched_at,
                work.metrics_failure_reason,
                work.metrics_last_fetched_at,
            ]
        )

    widths = [14, 36, 42, 24, 24, 14, 36, 14, 12, 12, 42, 42, 58, 12, 36, 24, 36, 24]
    for index, width in enumerate(widths, start=1):
        sheet.column_dimensions[get_column_letter(index)].width = width

    for row in sheet.iter_rows():
        for cell in row:
            cell.alignment = Alignment(vertical="top", wrap_text=True)

    sheet.freeze_panes = "A2"
    sheet.auto_filter.ref = sheet.dimensions
    workbook.save(path)
    return path
