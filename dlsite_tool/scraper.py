from __future__ import annotations

import html
import json
import re
import urllib.error
import urllib.request

from .models import STATUS_FAILED, STATUS_PARTIAL, STATUS_SUCCESS, Work, utc_now_iso


DL_DOMAINS = ("maniax", "home")


def build_work_url(rj: str, domain: str = "maniax") -> str:
    return f"https://www.dlsite.com/{domain}/work/=/product_id/{rj}.html/?locale=ja_JP"


def build_metrics_url(rj: str, domain: str = "maniax") -> str:
    return f"https://www.dlsite.com/{domain}/product/info/ajax?product_id={rj}"


def fetch_metadata(rj: str, timeout: int = 20, proxy: str = "") -> Work:
    errors: list[str] = []
    for domain in DL_DOMAINS:
        url = build_work_url(rj, domain)
        try:
            body, final_url = _download(url, timeout, proxy)
            work = parse_work_html(rj, body, final_url or url)
            if work.official_title or work.circle or work.tags:
                missing = _missing_fields(work)
                work.fetch_status = STATUS_PARTIAL if missing else STATUS_SUCCESS
                work.failure_reason = f"字段缺失：{', '.join(missing)}" if missing else ""
                work.last_fetched_at = utc_now_iso()
                return work
            errors.append(f"{domain}: 页面可访问但未解析到作品信息")
        except Exception as exc:
            errors.append(f"{domain}: {exc}")

    return Work(
        rj=rj,
        work_url=build_work_url(rj),
        fetch_status=STATUS_FAILED,
        failure_reason="；".join(errors),
        last_fetched_at=utc_now_iso(),
    )


def parse_work_html(rj: str, body: str, work_url: str) -> Work:
    title = _first_match(
        body,
        [
            r'<h1[^>]+id=["\']work_name["\'][^>]*>(.*?)</h1>',
            r'<meta[^>]+property=["\']og:title["\'][^>]+content=["\'](.*?)["\']',
            r"<title[^>]*>(.*?)</title>",
        ],
    )
    title = re.sub(r"\s*\|\s*DLsite.*$", "", title).strip()

    return Work(
        rj=rj,
        official_title=title,
        circle=_table_value(body, ("サークル名", "ブランド")),
        voice_actors=_table_value(body, ("声優",)),
        release_date=_table_value(body, ("販売日", "配信開始日")),
        tags=_table_value(body, ("ジャンル",)),
        cover_url=_first_match(
            body,
            [
                r'<meta[^>]+property=["\']og:image["\'][^>]+content=["\'](.*?)["\']',
                r'<img[^>]+id=["\']work_left_img["\'][^>]+src=["\'](.*?)["\']',
            ],
        ),
        work_url=work_url,
    )


def fetch_metrics(rj: str, timeout: int = 20, proxy: str = "") -> Work:
    errors: list[str] = []
    best: Work | None = None
    for domain in DL_DOMAINS:
        url = build_metrics_url(rj, domain)
        try:
            body, _final_url = _download(url, timeout, proxy)
            metrics = parse_metrics_json(rj, body)
            missing = _missing_metrics(metrics)
            metrics.metrics_last_fetched_at = utc_now_iso()
            if not missing:
                return metrics
            metrics.metrics_failure_reason = f"指标缺失：{', '.join(missing)}"
            errors.append(f"{domain}: {metrics.metrics_failure_reason}")
            if best is None or _metric_value_count(metrics) > _metric_value_count(best):
                best = metrics
        except Exception as exc:
            errors.append(f"{domain}: {exc}")

    if best is None:
        best = Work(rj=rj)
    best.metrics_failure_reason = "；".join(errors)
    best.metrics_last_fetched_at = utc_now_iso()
    return best


def parse_metrics_json(rj: str, body: str) -> Work:
    try:
        payload = json.loads(body)
    except json.JSONDecodeError as exc:
        raise ValueError("指标接口返回的不是有效 JSON") from exc
    if not isinstance(payload, dict) or not isinstance(payload.get(rj), dict):
        raise ValueError("指标接口未返回对应作品")

    product = payload[rj]
    sales_raw = product.get("dl_count_total", product.get("dl_count"))
    rating_count = _optional_nonnegative_int(product.get("rate_count"), "评价人数")
    rating_average = _optional_rating(product.get("rate_average_2dp"))
    if rating_count == 0:
        rating_average = None

    return Work(
        rj=rj,
        sales_count=_optional_nonnegative_int(sales_raw, "总售出数"),
        rating_average=rating_average,
        rating_count=rating_count,
    )


def _download(url: str, timeout: int, proxy: str = "") -> tuple[str, str]:
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 DLsiteTool/1.0",
            "Accept-Language": "ja-JP,ja;q=0.9",
            "Cookie": "locale=ja_JP; adultchecked=1; age_check_done=1",
        },
    )
    opener = urllib.request.build_opener()
    if proxy:
        opener = urllib.request.build_opener(
            urllib.request.ProxyHandler({"http": proxy, "https": proxy})
        )
    try:
        with opener.open(request, timeout=timeout) as response:
            charset = response.headers.get_content_charset() or "utf-8"
            body = response.read().decode(charset, errors="replace")
            return body, response.geturl()
    except urllib.error.HTTPError as exc:
        raise RuntimeError(f"HTTP {exc.code}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(str(exc.reason)) from exc


def _table_value(body: str, labels: tuple[str, ...]) -> str:
    for label in labels:
        pattern = rf"<tr[^>]*>\s*<t[hd][^>]*>\s*{re.escape(label)}\s*</t[hd]>\s*<td[^>]*>(.*?)</td>\s*</tr>"
        match = re.search(pattern, body, flags=re.I | re.S)
        if match:
            return _clean_html(match.group(1))
    return ""


def _first_match(body: str, patterns: list[str]) -> str:
    for pattern in patterns:
        match = re.search(pattern, body, flags=re.I | re.S)
        if match:
            return _clean_html(match.group(1))
    return ""


def _clean_html(value: str) -> str:
    value = re.sub(r"<br\s*/?>", " / ", value, flags=re.I)
    value = re.sub(r"<[^>]+>", " ", value)
    value = html.unescape(value)
    value = re.sub(r"\s+", " ", value)
    return value.strip()


def _missing_fields(work: Work) -> list[str]:
    checks = {
        "官网标题": work.official_title,
        "社团": work.circle,
        "发售日": work.release_date,
        "标签": work.tags,
    }
    return [name for name, value in checks.items() if not value]


def _missing_metrics(work: Work) -> list[str]:
    missing: list[str] = []
    if work.sales_count is None:
        missing.append("总售出数")
    if work.rating_count is None:
        missing.append("评价人数")
    elif work.rating_count > 0 and work.rating_average is None:
        missing.append("平均评分")
    return missing


def _metric_value_count(work: Work) -> int:
    return int(work.sales_count is not None) + int(work.rating_count is not None)


def _optional_nonnegative_int(value: object, label: str) -> int | None:
    if value is None or value == "":
        return None
    if isinstance(value, bool):
        raise ValueError(f"{label}格式无效")
    try:
        parsed = int(str(value).replace(",", ""))
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{label}格式无效") from exc
    if parsed < 0:
        raise ValueError(f"{label}不能为负数")
    return parsed


def _optional_rating(value: object) -> float | None:
    if value is None or value == "":
        return None
    if isinstance(value, bool):
        raise ValueError("平均评分格式无效")
    try:
        parsed = float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError("平均评分格式无效") from exc
    if not 0 <= parsed <= 5:
        raise ValueError("平均评分超出 0 到 5 的范围")
    return parsed
