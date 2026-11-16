// Development-only browser check. Uses an existing Playwright installation and synthetic data.
// NODE_PATH points to that installation; STATS_PYTHON selects a Python with openpyxl.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'docs/PRD/v12/verification');
const python = process.env.STATS_PYTHON || 'python';
const fixtureCode = `
import json, sys
from dlsite_tool.models import Work
from dlsite_tool.stats import build_stats, search_library
from server import parse_query_filters, parse_search_query
request = json.load(sys.stdin)
scenario = request['scenario']
works = []
for i in range(1200 if scenario == 'stress' else 384):
    status = ['成功', '部分成功', '失败', '未抓取'][i % 4]
    missing = scenario == 'missing'
    works.append(Work(
        rj=f'RJ{i + 1:08d}',
        circle='' if missing else ('長い日本語の社団名' * 8 + str(i) if scenario == 'stress' else f'社団 {i % 20} <&"'),
        voice_actors='' if missing else f'声優{i if scenario == "stress" else i % 18} / 共演者',
        tags='' if missing else f'ASMR タグ{i if scenario == "stress" else i % 14}',
        release_date='' if missing or i % 23 == 0 else f'{1977 + i % 50 if scenario == "stress" else 2018 + i % 9}年01月01日',
        fetch_status='成功' if scenario == 'single' else status,
        local_paths=[f'example-library/collection-{i % 3}/RJ{i + 1:08d}', f'backup/RJ{i + 1:08d}'],
    ))
if scenario == 'empty': works = []
query = request.get('query', '')
if request.get('list'):
    result = search_library(works, **parse_search_query(query))
    payload = {'count': result['matched_works']}
else:
    payload = build_stats(works, **parse_query_filters(query, include_entities=False))
print(json.dumps(payload, ensure_ascii=True))
`;
function fixture(scenario, query = '', list = false) {
  return JSON.parse(execFileSync(python, ['-B', '-c', fixtureCode], {
    cwd: root, input: JSON.stringify({ scenario, query, list }), encoding: 'utf8', maxBuffer: 8 * 1024 * 1024,
  }));
}
async function main() {
  fs.mkdirSync(output, { recursive: true });
  let scenario = 'normal';
  const requests = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    requests.push(url.pathname);
    if (url.pathname === '/api/stats') {
      res.setHeader('Content-Type', 'application/json');
      if (scenario === 'error') { res.writeHead(500); res.end(JSON.stringify({ error_code: 'error.unexpected', error_detail: '<failed fixture>' })); return; }
      if (scenario === 'invalid-json') { res.end('invalid JSON'); return; }
      try { res.end(JSON.stringify(fixture(scenario, url.search.slice(1)))); }
      catch (error) { res.writeHead(500); res.end(JSON.stringify({ error_detail: error.message })); }
      return;
    }
    const allowed = { '/stats': 'static/stats.html', '/static/stats.css': 'static/stats.css', '/static/stats.js': 'static/stats.js', '/static/i18n.js': 'static/i18n.js' };
    const file = allowed[url.pathname];
    if (!file) { res.writeHead(404); res.end(); return; }
    res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html');
    res.end(fs.readFileSync(path.join(root, file)));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  let browser;
  const errors = [];
  try {
    browser = await chromium.launch({ channel: process.env.STATS_BROWSER || 'chrome', headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, reducedMotion: 'reduce' });
    page.on('pageerror', error => errors.push(error.message));
    async function open(next = 'normal', query = '') {
      scenario = next;
      await page.goto(`${base}/stats${query ? '?' + query : ''}`);
      await page.locator(next === 'error' || next === 'invalid-json' ? '#statsError' : '#statsContent').waitFor({ state: 'visible' });
    }
    async function verify(expected) {
      assert.deepEqual(await page.locator('.kpi-number').allTextContents(), [expected.summary.total_works, expected.rankings.circles.length, expected.rankings.voice_actors.length, expected.rankings.tags.length].map(String));
      const statuses = ['成功', '部分成功', '失败', '未抓取'].map(status => expected.fetch_statuses.find(item => item.status === status));
      assert.deepEqual(await page.locator('.legend-row strong').allTextContents(), statuses.map(item => String(item.count)));
      const ring = await page.locator('#statusDisc g circle').evaluateAll(nodes => nodes.map(node => Number(node.getAttribute('stroke-dasharray').split(' ')[0])));
      const total = expected.summary.total_works;
      const raw = statuses.filter(item => item.count).map(item => item.count / total * 100);
      assert.deepEqual(ring, raw);
      const coverage = Object.values(expected.summary.coverage);
      assert.equal(coverage.every(item => item.known + item.missing === total), true);
      assert.deepEqual(await page.locator('.mini-ring strong').allTextContents(), coverage.map(item => `${total ? Math.round(item.known / total * 100) : 0}%`));
      assert.equal(await page.locator('#statsContent').innerHTML().then(html => /NaN|Infinity/.test(html)), false);
    }
    await open();
    await verify(fixture('normal'));
    assert.equal(await page.locator('.rank-top .rank-row').count(), 15);
    assert.equal(await page.locator('.rank-all .rank-row').count(), 0);
    await page.screenshot({ path: path.join(output, 'desktop.png'), fullPage: true });

    // Full rankings use original counts and keep the input node through composition and locale changes.
    for (const key of ['tags', 'voice_actors', 'circles']) {
      const card = page.locator(`[data-ranking="${key}"]`);
      await card.locator('summary').click();
      await card.locator('.rank-all .rank-row').first().waitFor();
      const input = card.locator('input');
      await input.fill('no-such-entry');
      assert.equal(await card.locator('.search-empty').isVisible(), true);
      assert.equal(await card.locator('.rank-all .rank-row:visible').count(), 0);
      assert.equal(await input.evaluate(el => {
        window.retainedSearch = el;
        el.focus();
        el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
        el.value = '日';
        el.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true }));
        I18n.setLocale('en');
        const retained = window.retainedSearch === document.querySelector(`[data-ranking="${el.closest('article').dataset.ranking}"] input`) && document.activeElement === el;
        el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
        return retained;
      }), true);
      assert.equal(await card.locator('details').getAttribute('open') !== null, true);
      assert.equal(await input.inputValue(), '日');
      await input.fill('');
      assert.equal(await card.locator('.rank-all .rank-row:visible').count(), fixture('normal').rankings[key].length);
      await card.locator('summary').click();
      await page.locator('[data-locale="zh-CN"]').click();
    }
    // Switching languages also keeps unsubmitted filter edits.
    await page.fill('#pathFilter', 'not-yet-applied');
    await page.locator('[data-locale="en"]').click();
    assert.equal(await page.locator('#pathFilter').inputValue(), 'not-yet-applied');
    assert.equal(await page.locator('h1').textContent(), 'Library Overview');
    await page.screenshot({ path: path.join(output, 'desktop-en.png'), fullPage: true });
    await page.locator('[data-locale="zh-CN"]').click();

    await page.selectOption('#yearFilter', '2025');
    await page.selectOption('#statsStatusFilter', '成功');
    await page.fill('#pathFilter', 'collection-1');
    await Promise.all([page.waitForURL('**/stats?**'), page.click('button[type="submit"]')]);
    await page.locator('#statsContent').waitFor({ state: 'visible' });
    const query = new URL(page.url()).search.slice(1);
    const filtered = fixture('normal', query);
    assert.ok(filtered.summary.total_works > 0);
    await verify(filtered);
    for (const selector of ['.rank-top .rank-row', '.legend-row[href]']) {
      const href = await page.locator(selector).first().getAttribute('href');
      const target = new URL(href, base);
      assert.equal(target.searchParams.get('release_year'), '2025');
      assert.equal(target.searchParams.get('path'), 'collection-1');
      const count = fixture('normal', target.search.slice(1), true).count;
      const shown = selector.startsWith('.rank') ? filtered.rankings.tags[0].count : filtered.fetch_statuses.find(item => item.status === target.searchParams.get('status')).count;
      assert.equal(count, shown);
    }
    const yearHref = await page.locator('.year-column').first().getAttribute('href');
    assert.equal(new URL(yearHref, base).searchParams.get('status'), '成功');
    assert.equal(new URL(yearHref, base).searchParams.get('path'), 'collection-1');
    await page.locator('.year-column').first().click();
    await page.locator('#statsContent').waitFor({ state: 'visible' });
    await verify(fixture('normal', new URL(page.url()).search.slice(1)));
    await page.locator('#statsFilters .secondary').click();
    await page.locator('#statsContent').waitFor({ state: 'visible' });
    assert.equal(new URL(page.url()).search, '');
    await verify(fixture('normal'));
    for (const next of ['empty', 'missing', 'single']) {
      await open(next);
      await verify(fixture(next));
      if (next === 'empty') assert.ok((await page.locator('#emptyTitle').textContent()).includes('空'));
      if (next === 'missing') assert.equal(await page.locator('.rank-row').count(), 0);
      if (next === 'single') assert.equal(await page.locator('#statusDisc g circle').count(), 1);
      await page.screenshot({ path: path.join(output, `${next}.png`), fullPage: true });
    }
    await open('normal', 'path=not-found');
    await verify(fixture('normal', 'path=not-found'));
    assert.ok((await page.locator('#emptyTitle').textContent()).includes('符合'));
    await open('error');
    assert.equal(await page.locator('#statsContent').isVisible(), false);
    assert.equal(await page.locator('#statsErrorDetails pre').textContent(), '<failed fixture>');
    await page.locator('[data-locale="en"]').click();
    assert.equal(await page.locator('#retryStats').textContent(), 'Reload');
    scenario = 'normal';
    await page.click('#retryStats');
    await page.locator('#statsContent').waitFor({ state: 'visible' });
    await open('invalid-json');
    assert.equal(await page.locator('#statsError').isVisible(), true);
    await page.locator('[data-locale="zh-CN"]').click();

    const layouts = [];
    for (const locale of ['zh-CN', 'en']) {
      await open('stress');
      await page.locator(`[data-locale="${locale}"]`).click();
      await verify(fixture('stress'));
      assert.equal(await page.locator('.year-column').count(), 50);
      assert.equal(await page.locator('.rank-all .rank-row').count(), 0);
      const card = page.locator('[data-ranking="circles"]');
      await card.locator('summary').click();
      await card.locator('.rank-all .rank-row').first().waitFor();
      assert.equal(await card.locator('.rank-all .rank-row').count(), 1200);
      await card.locator('input').fill('no-such-entry');
      assert.equal(await card.locator('.search-empty').isVisible(), true);
      await card.locator('input').fill('');
      for (const width of [1440, 1024, 768, 390, 320]) {
        await page.setViewportSize({ width, height: 1000 });
        const size = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth, chartScroll: document.querySelector('#yearChart').scrollWidth, chartClient: document.querySelector('#yearChart').clientWidth }));
        assert.ok(size.scroll <= size.client, `${locale} ${width}: ${JSON.stringify(size)}`);
        assert.ok(size.chartScroll > size.chartClient);
        layouts.push({ locale, width, ...size });
        if (width === 390) await page.screenshot({ path: path.join(output, `stress-mobile-${locale}.png`), fullPage: true });
      }
      await card.locator('summary').click();
    }
    await page.setViewportSize({ width: 390, height: 1000 });
    await open();
    await page.locator('[data-locale="zh-CN"]').click();
    await page.screenshot({ path: path.join(output, 'mobile.png'), fullPage: true });
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page.keyboard.press('Tab');
    await page.locator('.legend-row').first().focus();
    assert.ok((await page.locator('#discText').textContent()).includes('成功'));
    assert.equal(await page.locator('.legend-row').first().evaluate(el => getComputedStyle(el).outlineStyle), 'solid');
    assert.deepEqual(errors, []);
    assert.ok(requests.every(url => ['/stats', '/api/stats', '/static/stats.css', '/static/stats.js', '/static/i18n.js', '/favicon.ico'].includes(url)));
    fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({ result: 'PASS', synthetic: true, layouts, errors }, null, 2));
    console.log(JSON.stringify({ result: 'PASS', synthetic: true, layouts, errors }, null, 2));
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
