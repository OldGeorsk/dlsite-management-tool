const statsState = { data: null, error: null };
const t = (key, params = {}) => I18n.t(key, params);
const $ = (selector) => document.querySelector(selector);
const rankingMeta = {
  tags: { param: 'tag', icon: '<path d="M3 3h8l10 10-8 8L3 11z"/><circle cx="7.5" cy="7.5" r="1"/>' },
  voice_actors: { param: 'voice_actor', icon: '<rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 11v1a7 7 0 0 0 14 0M12 19v3M8 22h8"/>' },
  circles: { param: 'circle', icon: '<circle cx="9" cy="9" r="4"/><circle cx="15" cy="15" r="4"/>' },
};
const statusColors = { '成功': 'var(--teal)', '部分成功': 'var(--amber)', '失败': 'var(--ink)', '未抓取': '#aeb8c3' };

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[char]);
}
function escapeAttr(value) { return escapeHtml(value).replaceAll('\n', ' '); }
function statusLabel(status) { return t(`status.${status}`); }
function percentage(count, total) { return total ? (count / total * 100).toFixed(1) : '0.0'; }
function icon(paths) { return `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${paths}</svg>`; }
function pageFilters() {
  const source = new URLSearchParams(window.location.search);
  const query = new URLSearchParams();
  ['release_year', 'status', 'path'].forEach((key) => { if (source.get(key)) query.set(key, source.get(key)); });
  return query;
}
function filtersQuery(filters) {
  const query = new URLSearchParams();
  ['release_year', 'status', 'path'].forEach((key) => { if (filters[key]) query.set(key, filters[key]); });
  return query;
}
function workListUrl(param, value, filters) {
  const query = filtersQuery(filters);
  query.set(param, value);
  return `/?${query}`;
}
function yearUrl(year, filters) {
  const query = filtersQuery(filters);
  query.set('release_year', year);
  return `/stats?${query}`;
}
async function loadStats() {
  const query = pageFilters();
  const response = await fetch(`/api/stats${query.size ? `?${query}` : ''}`);
  const data = await response.json();
  if (!response.ok) { statsState.error = data; renderError(); return; }
  statsState.data = data;
  renderStats();
}
function renderStats(preserveFilters = false) {
  const data = statsState.data;
  const total = data.summary.total_works;
  $('#statsSummary').textContent = t('stats.filteredSummary', { all: data.summary.all_works, total });
  renderFilterOptions(data, preserveFilters);
  renderSummaryCards(data);
  renderYears(data);
  renderStatuses(data);
  renderCoverage(data);
  Object.keys(rankingMeta).forEach((key) => renderRanking(key, data));
  const empty = !total;
  const isLibraryEmpty = !data.summary.all_works;
  $('#globalEmpty').hidden = !empty;
  $('#emptyTitle').textContent = t(isLibraryEmpty ? 'stats.emptyLibrary' : 'stats.noMatch');
  $('#emptyText').textContent = t(isLibraryEmpty ? 'stats.emptyLibraryHelp' : 'stats.noMatchHelp');
  $('#emptyAction').textContent = t(isLibraryEmpty ? 'nav.works' : 'stats.clear');
  $('#emptyAction').href = isLibraryEmpty ? '/' : '/stats';
  $('#statsContent').hidden = false;
}
function renderFilterOptions(data, preserve) {
  const active = preserve ? { release_year: $('#yearFilter').value, status: $('#statsStatusFilter').value, path: $('#pathFilter').value } : data.filters;
  $('#yearFilter').innerHTML = `<option value="">${t('stats.allYears')}</option>${data.options.release_years.map((year) => `<option value="${escapeAttr(year)}">${escapeHtml(t('common.year', { year }))}</option>`).join('')}`;
  $('#statsStatusFilter').innerHTML = `<option value="">${t('search.allStatus')}</option>${data.options.statuses.map((status) => `<option value="${escapeAttr(status)}">${escapeHtml(statusLabel(status))}</option>`).join('')}`;
  $('#pathSuggestions').innerHTML = data.options.paths.map((item) => `<option value="${escapeAttr(item.path)}">${escapeHtml(t('common.works', { count: item.count }))}</option>`).join('');
  $('#yearFilter').value = active.release_year;
  $('#statsStatusFilter').value = active.status;
  $('#pathFilter').value = active.path;
}
function renderSummaryCards(data) {
  const cards = [{ label: t('stats.currentWorks'), value: data.summary.total_works, unit: t('stats.workUnit'), icon: '<path d="M4 5h4v15H4zM10 5h4v15h-4zM16 4l4-1 3 15-4 1z"/>' }];
  ['circles', 'voice_actors', 'tags'].forEach((key) => cards.push({ label: t(`stats.entries.${key}`), value: data.rankings[key].length, unit: t('stats.entryUnit'), icon: rankingMeta[key].icon }));
  $('#summaryCards').innerHTML = cards.map((card) => `<article class="card kpi"><div><p class="kpi-label">${escapeHtml(card.label)}</p><p class="kpi-value"><span class="kpi-number">${card.value}</span><span class="kpi-unit">${escapeHtml(card.unit)}</span></p></div><span class="kpi-glyph">${icon(card.icon)}</span></article>`).join('');
}
function ringSvg(parts, total, mini = false) {
  let offset = 0;
  const segments = total ? parts.filter((part) => part.count > 0).map((part) => {
    const length = part.count / total * 100;
    const segment = `<circle cx="60" cy="60" r="48" pathLength="100" fill="none" stroke="${part.color}" stroke-width="${mini ? 8 : 12}" stroke-dasharray="${length} ${100 - length}" stroke-dashoffset="${-offset}"/>`;
    offset += length;
    return segment;
  }).join('') : '';
  return `<svg viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="48" fill="none" stroke="var(--line)" stroke-width="${mini ? 8 : 12}"/><g transform="rotate(-90 60 60)">${segments}</g>${mini ? '' : '<circle cx="60" cy="60" r="37" fill="none" stroke="var(--line)" stroke-width=".45"/><circle cx="60" cy="60" r="34" fill="none" stroke="var(--line)" stroke-width=".35"/>'}</svg>`;
}
function renderYears(data) {
  const items = data.release_years;
  const total = data.summary.total_works;
  const known = data.summary.coverage.release_year.known;
  $('#yearKnown').textContent = t('stats.yearsKnown', { known, missing: total - known });
  if (!known) { $('#yearChart').innerHTML = `<p class="empty-state">${t(total ? 'stats.noYears' : 'stats.noWorks')}</p>`; return; }
  const counts = new Map(items.map((item) => [item.year, item.count]));
  const max = Math.max(1, ...items.map((item) => item.count));
  const years = [...data.options.release_years].sort();
  $('#yearChart').innerHTML = `<div class="years">${years.map((year) => {
    const count = counts.get(year) || 0;
    const label = t('stats.yearTip', { year, count, percentage: percentage(count, total) });
    return `<a class="year-column" href="${escapeAttr(yearUrl(year, data.filters))}" ${data.filters.release_year === year ? 'aria-current="true"' : ''} aria-label="${escapeAttr(label)}"><span class="year-count">${count}</span><span class="year-bar" style="height:${count / max * 100}px" aria-hidden="true"></span><span class="year-label">${escapeHtml(year)}</span></a>`;
  }).join('')}</div>`;
}
function renderStatuses(data) {
  const total = data.summary.total_works;
  const items = Object.keys(statusColors).map((status) => data.fetch_statuses.find((item) => item.status === status));
  $('#statusDisc').innerHTML = ringSvg(items.map((item) => ({ count: item.count, color: statusColors[item.status] })), total) + `<div class="disc-center"><strong id="discValue">${total}</strong><span id="discText">${t('stats.currentWorks')}</span></div>`;
  $('#statusChart').innerHTML = items.map((item) => {
    // A zero row cannot drill down by replacing a conflicting active status.
    const tag = item.count ? 'a' : 'div';
    const link = item.count ? `href="${escapeAttr(workListUrl('status', item.status, data.filters))}" aria-label="${escapeAttr(t('stats.statusLink', { status: statusLabel(item.status), count: item.count, percentage: percentage(item.count, total) }))}"` : '';
    return `<${tag} class="legend-row" ${link} style="--segment:${statusColors[item.status]}"><span class="swatch" aria-hidden="true"></span><span>${escapeHtml(statusLabel(item.status))}</span><strong>${item.count}</strong><span class="percent">${percentage(item.count, total)}%</span></${tag}>`;
  }).join('');
  $('#statusChart').querySelectorAll('.legend-row').forEach((row, index) => {
    const item = items[index];
    const update = () => {
      const active = row.matches(':hover, :focus');
      $('#discValue').textContent = active ? item.count : total;
      $('#discText').textContent = active ? `${statusLabel(item.status)} · ${percentage(item.count, total)}%` : t('stats.currentWorks');
    };
    ['mouseenter', 'mouseleave', 'focus', 'blur'].forEach((event) => row.addEventListener(event, update));
  });
  const success = items.find((item) => item.status === '成功').count;
  $('#statusFoot').textContent = total ? t('stats.statusFoot', { percentage: percentage(success, total), count: total - success }) : t('stats.emptyStatus');
}
function renderCoverage(data) {
  const total = data.summary.total_works;
  const items = ['tags', 'voice_actors', 'circles', 'release_year'].map((key) => ({ key, ...data.summary.coverage[key] }));
  $('#coverage').innerHTML = items.map((item, index) => `<div class="coverage-item"><div class="mini-ring">${ringSvg([{ count: item.known, color: index % 2 ? 'var(--blue)' : 'var(--teal)' }], total, true)}<strong aria-hidden="true">${total ? Math.round(item.known / total * 100) : 0}%</strong></div><div class="coverage-text"><strong>${escapeHtml(t(`dimension.${item.key}`))}</strong><p><span>${escapeHtml(t('stats.known', { count: item.known }))}</span><span>${escapeHtml(t('stats.missing', { count: item.missing }))}</span></p><span class="sr-only">${escapeHtml(t('stats.coverageValue', { percentage: percentage(item.known, total) }))}</span></div></div>`).join('');
  const low = items.reduce((a, b) => a.known <= b.known ? a : b);
  $('#coverageFoot').textContent = !total ? t('stats.emptyCoverage') : low.known === total ? t('stats.fullCoverage') : t('stats.lowCoverage', { dimension: t(`dimension.${low.key}`), percentage: percentage(low.known, total), missing: low.missing });
}
function rankRows(items, key, data) {
  const max = data.rankings[key][0]?.count || 1;
  return items.map((item, index) => `<a class="rank-row" data-name="${escapeAttr(item.name.toLocaleLowerCase())}" href="${escapeAttr(workListUrl(rankingMeta[key].param, item.name, data.filters))}"><span class="rank-index">${index + 1}</span><span class="rank-main"><span class="rank-label"><strong>${escapeHtml(item.name)}</strong><span class="rank-value">${item.count}<small>${percentage(item.count, data.summary.total_works)}%</small></span></span><span class="rank-track" aria-hidden="true"><span style="width:${item.count / max * 100}%"></span></span></span></a>`).join('');
}
function renderRanking(key, data) {
  const items = data.rankings[key];
  const target = $(`[data-ranking="${key}"]`);
  // Language changes retain the search node, its composition, and expanded state.
  if (!target.hasChildNodes()) {
    target.innerHTML = `<div class="panel-head"><h2></h2><span class="caption"></span></div>${items.length ? `<div class="rank-list rank-top">${rankRows(items.slice(0, 5), key, data)}</div>${items.length > 5 ? '<details class="all-ranking"><summary></summary><label><span class="sr-only rank-search-label"></span><input class="rank-search" type="search" autocomplete="off"></label><div class="rank-list rank-all"></div><p class="search-empty empty-state" hidden></p></details>' : ''}` : '<p class="empty-state"></p>'}`;
    const details = target.querySelector('details');
    const search = target.querySelector('.rank-search');
    if (details) {
      let loaded = false;
      details.addEventListener('toggle', () => {
        if (details.open && !loaded) {
          target.querySelector('.rank-all').innerHTML = rankRows(items, key, data);
          loaded = true;
          filterRanking();
        }
      });
      function filterRanking() {
        const query = search.value.trim().toLocaleLowerCase();
        let visible = 0;
        target.querySelectorAll('.rank-all .rank-row').forEach((row) => { row.hidden = !row.dataset.name.includes(query); if (!row.hidden) visible++; });
        target.querySelector('.search-empty').hidden = !loaded || visible > 0;
      }
      search.addEventListener('input', (event) => { if (!event.isComposing) filterRanking(); });
      search.addEventListener('compositionend', filterRanking);
    }
  }
  const title = t(`facet.${key}`);
  target.querySelector('h2').textContent = t('stats.ranking', { title });
  target.querySelector('.caption').textContent = t('stats.rankCount', { count: items.length });
  if (!items.length) target.querySelector('.empty-state').textContent = t('stats.emptyRanking', { title });
  const search = target.querySelector('.rank-search');
  if (search) {
    target.querySelector('summary').textContent = t('stats.allRanking', { count: items.length });
    target.querySelector('.rank-search-label').textContent = t('facet.search', { title });
    search.placeholder = t('facet.search', { title });
    target.querySelector('.search-empty').textContent = t('stats.searchEmpty');
  }
}
function renderError() {
  const data = statsState.error;
  const key = data?.error_code || 'error.statsRead';
  const localized = t(key, data?.error_params || {});
  $('#statsSummary').textContent = t('error.statsSummary');
  $('#statsError').hidden = false;
  $('#statsErrorMessage').textContent = localized === key ? t('error.statsRead') : localized;
  const detail = data?.error_detail || data?.error || '';
  $('#statsErrorDetails').hidden = !detail;
  $('#statsErrorDetails pre').textContent = detail;
}
$('#statsFilters').addEventListener('submit', (event) => {
  event.preventDefault();
  const query = filtersQuery({ release_year: $('#yearFilter').value, status: $('#statsStatusFilter').value, path: $('#pathFilter').value.trim() });
  window.location.href = `/stats${query.size ? `?${query}` : ''}`;
});
window.addEventListener('localechange', () => { if (statsState.data) renderStats(true); else if (statsState.error) renderError(); });
I18n.bindSwitcher();
loadStats().catch((error) => { statsState.error = { error_detail: error.message }; renderError(); });
