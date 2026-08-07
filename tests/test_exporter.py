from __future__ import annotations

from pathlib import Path

from openpyxl import load_workbook

from dlsite_tool.exporter import export_xlsx
from dlsite_tool.models import Work


def test_export_xlsx_preserves_multilingual_text(tmp_path: Path) -> None:
    output = tmp_path / "works.xlsx"
    export_xlsx(
        [
            Work(
                rj="RJ00000001",
                local_title="示例标题♡",
                official_title="公式サンプルタイトル",
                circle="サンプルサークル",
                sales_count=1234,
                rating_average=4.25,
                rating_count=17,
                metrics_failure_reason="",
                metrics_last_fetched_at="2000-01-01T00:00:00+00:00",
                local_paths=["example-library\\RJ00000001 示例标题"],
            )
        ],
        output,
    )

    workbook = load_workbook(output)
    sheet = workbook.active
    assert sheet["A2"].value == "RJ00000001"
    assert sheet["B2"].value == "示例标题♡"
    assert sheet["H1"].value == "总售出数"
    assert sheet["H2"].value == 1234
    assert sheet["I2"].value == 4.25
    assert sheet["J2"].value == 17
    assert sheet["R1"].value == "指标最后刷新时间"
