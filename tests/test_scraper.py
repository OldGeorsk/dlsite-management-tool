from __future__ import annotations

from pathlib import Path

from dlsite_tool import scraper
from dlsite_tool.db import Store
from dlsite_tool.models import STATUS_FAILED, STATUS_PARTIAL, STATUS_SUCCESS, Work
from dlsite_tool.stats import split_tags, split_voice_actors


NEW_PAGE = """
<meta property="og:title" content="サンプル作品 | DLsite">
<meta property="og:image" content="https://example.invalid/cover.jpg">
<style>.tag_general:before { content: "#\\a0"; }</style>
<dl>
  <div><dt class="c-productInfo__key">サークル名</dt>
    <dd class="c-productInfo__value"><!--[--><div><a href="/circle/">
      <!--[-->Circle &amp; Co<!--]--></a><div></div></div><!--]--></dd></div>
  <div><dt>声優</dt><dd><!--[-->
    <span><a href="/actor/a"><!--[-->声優A<!--]--></a></span>
    <span><a href="/actor/b"><!--[-->声優B/C<!--]--></a></span><!--]--></dd></div>
  <div><dt>販売日</dt><dd><!--[--><a href="/new/">2026年11月10日 0時</a><!--]--></dd></div>
  <div><dt>ジャンル</dt><dd><!--[--><div>
    <a class="tag_general" href="/genre/a"><!--[-->ASMR<!--]--></a>
    <a class="tag_general" href="/genre/b">ラブラブ/あまあま</a>
  </div><!--]--></dd></div>
</dl>
"""


def test_parse_definition_list_preserves_metadata_and_entity_separators() -> None:
    work = scraper.parse_work_html("RJ00000001", NEW_PAGE, "https://example.invalid/work")

    assert work.official_title == "サンプル作品"
    assert work.circle == "Circle & Co"
    assert work.release_date == "2026年11月10日 0時"
    assert work.voice_actors == "声優A / 声優B/C"
    assert split_voice_actors(work.voice_actors) == ["声優A", "声優B/C"]
    assert split_tags(work.tags) == ["ASMR", "ラブラブ/あまあま"]
    assert "#" not in work.tags
    assert work.cover_url == "https://example.invalid/cover.jpg"
    assert work.work_url == "https://example.invalid/work"


def test_parse_legacy_table_and_alternate_labels() -> None:
    body = """
    <h1 id="work_name">旧作品</h1><table>
      <tr><th>ブランド</th><td><a>旧社团</a></td></tr>
      <tr><th>声優</th><td><a>声優A</a><br><a>声優B/C</a></td></tr>
      <tr><th>配信開始日</th><td>2020年1月2日</td></tr>
      <tr><th>ジャンル</th><td><a>ASMR</a> <a>ラブラブ/あまあま</a></td></tr>
    </table>
    """
    work = scraper.parse_work_html("RJ00000001", body, "")

    assert work.official_title == "旧作品"
    assert work.circle == "旧社团"
    assert work.release_date == "2020年1月2日"
    assert split_voice_actors(work.voice_actors) == ["声優A", "声優B/C"]
    assert split_tags(work.tags) == ["ASMR", "ラブラブ/あまあま"]


def test_definition_list_alternate_labels_and_plain_text_voice_actors() -> None:
    body = """
    <dl><dt>ブランド</dt><dd>別ブランド</dd>
    <dt>配信開始日</dt><dd>2026年1月2日</dd>
    <dt>声優</dt><dd>声優A<br>声優B</dd></dl>
    """
    work = scraper.parse_work_html("RJ00000001", body, "")

    assert work.circle == "別ブランド"
    assert work.release_date == "2026年1月2日"
    assert split_voice_actors(work.voice_actors) == ["声優A", "声優B"]


def test_fetch_definition_list_and_store_only_fill_empty_values(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(scraper, "_download", lambda url, timeout, proxy: (NEW_PAGE, url))
    incoming = scraper.fetch_metadata("RJ00000001")
    assert incoming.fetch_status == STATUS_SUCCESS
    assert incoming.failure_reason == ""
    assert incoming.last_fetched_at

    with Store(tmp_path / "library.sqlite3") as store:
        store.upsert_scanned([Work(rj=incoming.rj, local_title="本地标题", local_paths=["example/old"])])
        store.update_metadata(Work(rj=incoming.rj, official_title="保留标题", circle="保留社团", cover_url="old-cover", work_url="old-url"))
        store.update_metadata(incoming)
        saved = store.get_work(incoming.rj)

    assert saved is not None
    assert (saved.local_title, saved.official_title, saved.circle) == ("本地标题", "保留标题", "保留社团")
    assert (saved.cover_url, saved.work_url) == ("old-cover", "old-url")
    assert saved.voice_actors == incoming.voice_actors
    assert saved.release_date == incoming.release_date
    assert saved.tags == incoming.tags
    assert saved.local_paths == ["example/old"]
    assert saved.fetch_status == STATUS_SUCCESS
    assert saved.failure_reason == ""
    assert saved.last_fetched_at == incoming.last_fetched_at


def test_missing_tags_remain_partial_and_do_not_consume_next_field(monkeypatch) -> None:
    body = NEW_PAGE.replace("ジャンル", "作品形式")
    body += '<dl><dt>ジャンル</dt><dd></dd><dt>その他</dt><dd>別の値</dd></dl>'
    monkeypatch.setattr(scraper, "_download", lambda url, timeout, proxy: (body, url))

    work = scraper.fetch_metadata("RJ00000001")

    assert work.circle == "Circle & Co"
    assert work.tags == ""
    assert work.fetch_status == STATUS_PARTIAL
    assert work.failure_reason == "字段缺失：标签"


def test_metadata_fallback_and_both_partition_failures(monkeypatch) -> None:
    calls: list[str] = []

    def download(url: str, timeout: int, proxy: str) -> tuple[str, str]:
        calls.append(url)
        assert proxy == "http://example.invalid:8888"
        if "/maniax/" in url:
            raise RuntimeError("HTTP 404")
        return NEW_PAGE, url

    monkeypatch.setattr(scraper, "_download", download)
    work = scraper.fetch_metadata("RJ00000001", proxy="http://example.invalid:8888")
    assert len(calls) == 2
    assert "/maniax/" in calls[0] and "/home/" in calls[1]
    assert work.fetch_status == STATUS_SUCCESS
    assert work.work_url == calls[1]

    def failed_download(url: str, timeout: int, proxy: str) -> tuple[str, str]:
        raise RuntimeError("HTTP 404")

    monkeypatch.setattr(scraper, "_download", failed_download)
    failed = scraper.fetch_metadata("RJ00000001")
    assert failed.fetch_status == STATUS_FAILED
    assert failed.failure_reason == "maniax: HTTP 404；home: HTTP 404"
