// Uses an existing Playwright and Python with openpyxl. The real HTTP app uses only a temporary database.
const assert = require('node:assert/strict');
const { spawn, execFileSync } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const readline = require('node:readline');
const { chromium } = require('playwright');

const python = process.env.STATS_PYTHON || 'python';
const root = path.resolve(__dirname, '..');
const tempRoot = fs.realpathSync(os.tmpdir());
const tmp = fs.mkdtempSync(path.join(tempRoot, 'dlsite-works-ui-'));
const publicCover = process.env.WORKS_PUBLIC_COVER;
const serverCode = `
import sys
from pathlib import Path
from dlsite_tool.models import Work
import server

folder = Path(sys.argv[1])
server.DB_PATH = folder / 'works.sqlite3'
server.EXPORT_DIR = folder / 'exports'
with server.Store(server.DB_PATH) as store:
    for i in range(1, 31):
        rj = 'RJ329940' if i == 30 and sys.argv[2] else f'RJ{i:06d}'
        images = ['wide', 'square', 'tall', 'broken', '']
        shape = images[(i - 1) % len(images)]
        cover = (sys.argv[2] if i == 30 and sys.argv[2] else
                 f'https://covers.example.invalid/{shape}.svg' if shape else '')
        work = Work(rj=rj, local_title=f'Local {rj}', official_title=f'作品 {rj} ' + '長い日本語の作品名' * 6,
                    circle='ABC'[i % 3], voice_actors='林' if i <= 20 else '森',
                    tags='タグ', release_date=f'{2024 + i % 2}年01月01日',
                    fetch_status='失败' if i == 13 else '成功',
                    failure_reason='Synthetic failure reason' if i == 13 else '',
                    work_url=f'https://www.dlsite.com/home/work/=/product_id/{rj}.html',
                    cover_url=cover, local_paths=[f'example/{rj}/original', f'backup/{rj}/' + 'long-folder-name' * 15])
        store.upsert_scanned([work])
        store.update_metadata(work)
        work.rating_count = i
        work.rating_average = 4.5
        work.sales_count = i * 10
        store.update_metrics(work)

with server.ThreadingHTTPServer(('127.0.0.1', 0), server.AppHandler) as httpd:
    print(httpd.server_port, flush=True)
    httpd.serve_forever()
`;

const waitLoaded = (page) => page.locator('.table-wrap[aria-busy="false"]').waitFor();
const rows = (page) => page.locator('#worksBody tr[data-work-row]');

async function startServer() {
  const child = spawn(python, ['-B', '-c', serverCode, tmp, publicCover || ''], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  const ready = readline.createInterface({ input: child.stdout });
  let errors = '';
  child.stderr.on('data', chunk => { errors += chunk; });
  const port = await new Promise((resolve, reject) => {
    ready.once('line', value => resolve(Number(value)));
    child.once('error', reject);
    child.once('exit', () => reject(new Error(errors || 'Temporary server exited')));
  });
  return { child, url: `http://127.0.0.1:${port}` };
}

async function exportFile(page, selector, workIds, lang) {
  const [download] = await Promise.all([page.waitForEvent('download'), page.click(selector)]);
  const output = path.join(tmp, 'download.xlsx');
  await download.saveAs(output);
  const actual = execFileSync(python, ['-X', 'utf8', '-B', '-c', `
import json, sys
from openpyxl import load_workbook
book = load_workbook(sys.argv[1], read_only=True)
rows = list(book.active.values)
print(json.dumps([rows[0][0], [row[0] for row in rows[1:]]]))
book.close()
`, output], { encoding: 'utf8' });
  assert.deepEqual(JSON.parse(actual), [lang, workIds]);
}

function modifyPaths(rj, newPath) {
  execFileSync(python, ['-B', '-c', `
import sys
from dlsite_tool.db import Store
with Store(sys.argv[1]) as store:
    assert store.add_path(sys.argv[2], sys.argv[3])
`, path.join(tmp, 'works.sqlite3'), rj, newPath], { cwd: root });
}

async function layout(page, width, title) {
  await page.setViewportSize({ width, height: 900 });
  const sizes = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
    sidebar: document.querySelector('.library-sidebar').getBoundingClientRect().toJSON(),
    main: document.querySelector('.library-main').getBoundingClientRect().toJSON(),
  }));
  assert.equal(sizes.sidebar.left, 0, `${title} ${width} sidebar left`);
  assert.ok(sizes.scroll <= sizes.client, `${title} ${width} overflow: ${sizes.scroll} > ${sizes.client}`);
  assert.equal(sizes.main.right, sizes.client);
  assert.equal(await page.locator('.sidebar-divider').isVisible(), width > 760);
  if (width > 760) assert.equal(sizes.sidebar.right, sizes.main.left);
}

async function test() {
  let server, browser;
  try {
    server = await startServer();
    browser = await chromium.launch({ channel: process.env.STATS_BROWSER || 'chrome', headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce', locale: 'zh-CN' });
    page.setDefaultTimeout(8000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const requests = [];
    let candidatesDelayed = false;
    let worksFail = false;
    let emptyLibrary = false;
    let shrinkAfterJob = false;
    let polls = 0;
    await page.route('https://covers.example.invalid/**', route => {
      const shape = new URL(route.request().url()).pathname.slice(1).split('.')[0];
      if (shape === 'broken') return route.abort();
      const [width, height] = { wide: [120, 50], square: [60, 60], tall: [50, 120] }[shape];
      return route.fulfill({ contentType: 'image/svg+xml', body: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#485bc7"/></svg>` });
    });
    await page.route('**/api/**', async route => {
      const request = route.request();
      const endpoint = new URL(request.url()).pathname;
      if (endpoint === '/api/works' && worksFail) return route.fulfill({ status: 500, json: { error: 'Synthetic load failure' } });
      if (endpoint === '/api/works' && emptyLibrary) {
        const data = await (await route.fetch()).json();
        return route.fulfill({ json: { ...data, works: [], total_works: 0, matched_works: 0 } });
      }
      if (endpoint === '/api/works' && shrinkAfterJob) {
        const data = await (await route.fetch()).json();
        return route.fulfill({ json: { ...data, works: data.works.slice(0, 7), matched_works: 7 } });
      }
      if (endpoint === '/api/session') return route.fulfill({ json: { token: 'session-test' } });
      if (endpoint === '/api/local-paths' || endpoint.startsWith('/api/paths/')) {
        const body = request.postDataJSON();
        assert.equal(request.headers()['x-local-session'], 'session-test');
        requests.push({ endpoint, body });
        if (endpoint === '/api/paths/open-saved') {
          if (body.path.endsWith('original')) return route.fulfill({ status: 404, json: { status: 'missing', error: 'Missing' } });
        }
        if (endpoint === '/api/local-paths') {
          if (body.root_only) return route.fulfill({ json: { candidates: [{ path: 'example-library' }] } });
          if (candidatesDelayed) await new Promise(resolve => setTimeout(resolve, 300));
          return route.fulfill({ json: { candidates: [{ path: 'new/path', open_token: 'open-test', save_token: 'save-test' }] } });
        }
        if (endpoint === '/api/paths/add-candidate') modifyPaths(body.rj, 'new/path');
        if (endpoint === '/api/paths/add-manual') modifyPaths(body.rj, body.path);
        return route.fulfill({ json: { status: 'ok' } });
      }
      if (['/api/scan', '/api/fetch', '/api/metrics/refresh'].includes(endpoint)) {
        polls = 0;
        requests.push({ endpoint, body: request.postDataJSON() });
        return route.fulfill({ json: { job_id: 'job-test' } });
      }
      if (endpoint === '/api/jobs/job-test') {
        const status = ++polls >= 2 ? 'success' : 'running';
        if (status === 'success') shrinkAfterJob = true;
        return route.fulfill({ json: { job: {
          status, total: 1, completed: status === 'success' ? 1 : 0,
          message_code: status === 'success' ? 'job.message.completed' : 'job.waiting',
        } } });
      }
      return route.continue();
    });

    await page.goto(server.url + '/stats?release_year=2025');
    await page.locator('#statsContent').waitFor();
    const down = page.locator('.rank-top [href*="circle="]').first();
    const shown = Number((await down.locator('.rank-value').evaluate(node => node.firstChild.textContent)).match(/\d+/)[0]);
    await down.click();
    await waitLoaded(page);
    assert.equal(await rows(page).count(), shown);
    assert.equal(new URL(page.url()).searchParams.get('release_year'), '2025');
    assert.ok(await page.locator('#activeFilters').isVisible());

    await page.goto(server.url + '/?sort_by=rating_count&sort_dir=asc');
    await waitLoaded(page);
    assert.equal(await rows(page).count(), 12);
    if (process.env.WORKS_SCREENSHOTS) {
      fs.mkdirSync(process.env.WORKS_SCREENSHOTS, { recursive: true });
      await page.screenshot({ path: path.join(process.env.WORKS_SCREENSHOTS, 'works-desktop.png') });
    }
    const circle = page.locator('[data-facet="circles"]');
    const actor = page.locator('[data-facet="voice_actors"]');
    const selected = (menu, value) => menu.locator(`input[value="${value}"]`);
    await circle.locator('summary').click();
    const facetSearch = circle.locator('.facet-search');
    assert.equal(await facetSearch.evaluate(input => {
      input.focus();
      input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
      input.value = 'a';
      input.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true }));
      I18n.setLocale('en');
      const retained = document.activeElement === input && input.value === 'a';
      input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
      I18n.setLocale('zh-CN');
      return retained;
    }), true);
    assert.equal(await circle.locator('.facet-option').count(), 1);
    await circle.locator('.facet-search').fill('');
    await selected(circle, 'A').check();
    await selected(circle, 'B').check();
    await waitLoaded(page);
    assert.deepEqual(new URL(page.url()).searchParams.getAll('circle'), ['A', 'B']);
    assert.ok(await circle.evaluate(element => element.open));
    await actor.locator('summary').click();
    assert.ok(!await circle.evaluate(element => element.open));
    await selected(actor, '林').check();
    await waitLoaded(page);
    const filtered = await page.request.get(page.url().replace('/?', '/api/works?')).then(response => response.json());
    assert.equal(filtered.works.length, 13);
    assert.equal(await rows(page).count(), 12);
    await page.keyboard.press('Escape');
    assert.ok(!await actor.evaluate(element => element.open));
    await page.selectOption('#statusFilter', '失败');
    await waitLoaded(page);
    await circle.locator('summary').click();
    assert.ok(await selected(circle, 'A').isChecked());
    assert.equal(await selected(circle, 'A').locator('..').locator('strong').textContent(), '0');
    await selected(circle, 'A').uncheck();
    await waitLoaded(page);
    await page.keyboard.press('Escape');
    await page.selectOption('#statusFilter', '');
    await waitLoaded(page);
    await circle.locator('summary').click();
    await selected(circle, 'A').check();
    await waitLoaded(page);
    await page.locator('[data-locale="en"]').click();
    assert.equal(await page.locator('h1').textContent(), 'Works');
    const ids = filtered.works.map(work => work.rj);
    await exportFile(page, '#exportCurrent', ids, 'RJ ID');
    const all = await page.request.get(server.url + '/api/works').then(response => response.json());
    await exportFile(page, '#exportAll', all.works.map(work => work.rj), 'RJ ID');
    await page.locator('[data-locale="zh-CN"]').click();
    await exportFile(page, '#exportCurrent', ids, 'RJ号');

    await page.goto(server.url + '/?sort_by=rating_count&sort_dir=asc');
    await waitLoaded(page);
    await page.click('#nextPage');
    const trigger = page.locator('[data-work-title="RJ000013"]');
    await trigger.scrollIntoViewIfNeeded();
    const scrollBefore = await page.evaluate(() => scrollY);
    await trigger.click();
    assert.equal(await page.locator('#detailPaths button').count(), 2);
    assert.match(await page.locator('#detailMetadata').textContent(), /失败.*Synthetic failure reason/s);
    assert.equal(await page.locator('#detailMetadata a').count(), 1);
    if (process.env.WORKS_SCREENSHOTS) {
      await page.screenshot({ path: path.join(process.env.WORKS_SCREENSHOTS, 'details-desktop.png') });
    }
    await page.getByRole('button', { name: 'example/RJ000013/original', exact: true }).click();
    await page.locator('[data-open-candidate]').click();
    await page.locator('[data-save-candidate]').click();
    await page.getByRole('button', { name: 'new/path', exact: true }).waitFor();
    assert.equal(await page.locator('#detailPaths button').count(), 3);
    assert.deepEqual(requests.find(entry => entry.endpoint === '/api/paths/add-candidate').body, { rj: 'RJ000013', token: 'save-test' });
    await page.getByRole('button', { name: 'example/RJ000013/original', exact: true }).click();
    await page.locator('[data-manual-path]').fill('manual/path');
    await page.locator('[data-add-manual]').click();
    await page.getByRole('button', { name: 'manual/path', exact: true }).waitFor();
    assert.equal(await page.locator('#detailPaths button').count(), 4);
    candidatesDelayed = true;
    await page.getByRole('button', { name: 'example/RJ000013/original', exact: true }).click();
    await page.locator('[data-manual-path]').waitFor();
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.activeElement?.dataset.workTitle === 'RJ000013');
    assert.equal(await page.locator('#pageCount').textContent(), '第 2 / 3 页');
    assert.equal(await page.evaluate(() => scrollY), scrollBefore);
    await page.locator('[data-work-title="RJ000014"]').click();
    await page.waitForTimeout(400);
    assert.equal(await page.locator('#detailRepair').textContent(), '');
    await page.locator('#workDetails .close-button').click();

    await page.goto(server.url + '/?sort_by=rating_count&sort_dir=asc');
    await waitLoaded(page);
    const expectedCovers = [[1, 120, 50], [2, 60, 60], [3, 50, 120]];
    for (const [id, width, height] of expectedCovers) {
      const thumb = page.locator(`[data-cover="RJ00000${id}"] img`);
      await thumb.scrollIntoViewIfNeeded();
      await thumb.evaluate(img => img.decode());
      assert.deepEqual(await thumb.evaluate(img => [img.naturalWidth, img.naturalHeight, getComputedStyle(img).objectFit]), [width, height, 'contain']);
    }
    assert.equal(await page.locator('[data-work-row="RJ000005"] .work-cover img').count(), 0);
    await page.waitForFunction(() => document.querySelector('[data-cover="RJ000004"]').disabled);
    const cover = page.locator('[data-cover="RJ000001"]');
    for (const [size, expected] of [['compact', [72, 54]], ['standard', [96, 72]], ['large', [120, 90]]]) {
      await page.selectOption('#coverSize', size);
      assert.deepEqual(await cover.evaluate(button => [button.offsetWidth, button.offsetHeight]), expected);
    }
    await cover.hover();
    await page.locator('#coverPreview').waitFor();
    await page.uncheck('#coverHover');
    await cover.hover();
    await page.waitForTimeout(350);
    assert.ok(!await page.locator('#coverPreview').isVisible());
    await cover.click();
    await page.locator('#coverViewer[open]').waitFor();
    await page.keyboard.press('Escape');
    await page.locator('#coverViewer').waitFor({ state: 'hidden' });
    assert.ok(!await page.locator('#workDetails').isVisible());

    for (const route of ['/', '/stats']) {
      await page.goto(server.url + route);
      if (route === '/') await waitLoaded(page);
      else await page.locator('#statsContent').waitFor();
      for (const width of [1920, 2560, 1024, 760, 390, 320]) await layout(page, width, route);
      await layout(page, 2560, route);
      const splitter = page.locator('.sidebar-divider');
      const rect = await splitter.boundingBox();
      await page.mouse.move(rect.x + 4, 100);
      await page.mouse.down();
      await page.mouse.move(1500, 100);
      await page.mouse.up();
      assert.equal(await splitter.getAttribute('aria-valuenow'), '768');
      await splitter.focus();
      await page.keyboard.press('ArrowRight');
      assert.equal(await splitter.getAttribute('aria-valuenow'), '768');
      await page.keyboard.press('ArrowLeft');
      assert.equal(await splitter.getAttribute('aria-valuenow'), '756');
      await layout(page, 1024, route);
      await page.waitForFunction(() => document.querySelector('.sidebar-divider').getAttribute('aria-valuenow') === '307');
      for (let i = 0; i < 11; i++) await page.keyboard.press('ArrowLeft');
      assert.equal(await splitter.getAttribute('aria-valuenow'), '188');
    }

    const touch = await browser.newPage({ viewport: { width: 390, height: 720 }, hasTouch: true, isMobile: true });
    await touch.route('https://covers.example.invalid/**', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="60"/>' }));
    await touch.goto(server.url + '/?sort_by=rating_count&sort_dir=asc');
    await waitLoaded(touch);
    await touch.locator('[data-cover="RJ000001"]').tap();
    assert.ok(await touch.locator('#coverViewer').isVisible());
    await touch.locator('#coverViewer .close-button').tap();
    await touch.locator('[data-work-title="RJ000001"]').tap();
    const mobileDetails = touch.locator('#workDetails');
    await mobileDetails.evaluate(node => Promise.all(node.getAnimations().map(animation => animation.finished)));
    const { y, height } = await mobileDetails.boundingBox();
    assert.equal(Math.round(height), Math.round(720 * 0.88));
    assert.equal(Math.round(y + height), 720);
    assert.ok(await mobileDetails.locator('.detail-body').evaluate(node => node.scrollWidth <= node.clientWidth));
    if (process.env.WORKS_SCREENSHOTS) {
      await touch.screenshot({ path: path.join(process.env.WORKS_SCREENSHOTS, 'details-mobile.png') });
    }
    await touch.close();

    if (publicCover) {
      await page.goto(server.url + '/?q=RJ329940');
      await waitLoaded(page);
      const image = page.locator('[data-cover="RJ329940"] img');
      await image.evaluate(img => img.decode());
      assert.ok(await image.evaluate(img => img.naturalWidth > 0));
      console.log('Live DLsite cover decoded.');
    }

    emptyLibrary = true;
    await page.goto(server.url);
    await waitLoaded(page);
    assert.match(await page.locator('.empty-results').textContent(), /资料库暂无作品/);
    emptyLibrary = false;
    await page.goto(server.url + '/?q=nonexistent');
    await waitLoaded(page);
    assert.match(await page.locator('.empty-results').textContent(), /没有符合/);
    await page.click('#clearAll');
    await waitLoaded(page);
    assert.equal(await rows(page).count(), 12);
    worksFail = true;
    await page.reload();
    await page.locator('#searchError').waitFor();
    assert.equal(await page.locator('.empty-results').count(), 0);
    worksFail = false;
    await page.locator('#searchError button').click();
    await waitLoaded(page);

    await page.click('#nextPage');
    await page.click('#nextPage');
    await page.fill('#pathInput', 'ex');
    await page.getByRole('option', { name: 'example-library' }).click();
    await page.locator('.settings summary').click();
    await page.check('#fetchInput');
    await page.check('#forceMetricsInput');
    await page.fill('#proxyInput', 'http://example.invalid:7890');
    for (const [button, endpoint] of [
      ['#scanButton', '/api/scan'], ['#fetchButton', '/api/fetch'], ['#metricsButton', '/api/metrics/refresh'],
    ]) {
      await page.click(button);
      await page.waitForFunction(() => document.querySelector('#jobPercent').textContent === '100%');
      await waitLoaded(page);
      assert.equal(requests.at(-1).endpoint, endpoint);
    }
    assert.match(await page.locator('#pageCount').textContent(), /1 \/ 1/);
    assert.equal(await rows(page).count(), 7);
    assert.equal(requests.find(entry => entry.endpoint === '/api/scan').body.path, 'example-library');
    assert.equal(requests.find(entry => entry.endpoint === '/api/scan').body.fetch, true);
    assert.equal(requests.find(entry => entry.endpoint === '/api/metrics/refresh').body.force, true);
    assert.deepEqual(errors, []);
    console.log('v13 browser workflows, responsiveness, and XLSX exports passed.');
  } finally {
    await browser?.close();
    if (server?.child.exitCode === null) {
      server.child.kill();
      await once(server.child, 'exit');
    }
    if (path.dirname(fs.realpathSync(tmp)) === tempRoot) fs.rmSync(tmp, { recursive: true, force: true });
  }
}

test().catch(error => { console.error(error); process.exitCode = 1; });
