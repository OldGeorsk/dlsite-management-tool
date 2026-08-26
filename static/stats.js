const statsState = { data: null };
const t = (key, params = {}) => I18n.t(key, params);

const statsEl = {
  form: document.querySelector("#statsFilters"),
  year: document.querySelector("#yearFilter"),
  status: document.querySelector("#statsStatusFilter"),
  path: document.querySelector("#pathFilter"),
  pathSuggestions: document.querySelector("#pathSuggestions"),
  summary: document.querySelector("#statsSummary"),
  cards: document.querySelector("#summaryCards"),
  insights: document.querySelector("#insights"),
  yearChart: document.querySelector("#yearChart"),
  statusChart: document.querySelector("#statusChart"),
  content: document.querySelector("#statsContent"),
  error: document.querySelector("#statsError"),
};

const rankingMeta = {
  tags: { titleKey: "facet.tags", eyebrow: "TAGS", param: "tag", coverage: "tags" },
  voice_actors: { titleKey: "facet.voice_actors", eyebrow: "VOICE ACTORS", param: "voice_actor", coverage: "voice_actors" },
  circles: { titleKey: "facet.circles", eyebrow: "CIRCLES", param: "circle", coverage: "circles" },
};

const coverageLabels = {
  tags: "stats.coverage.tags",
  voice_actors: "stats.coverage.voice_actors",
  circles: "stats.coverage.circles",
};

function pageFilters() {
  const source = new URLSearchParams(window.location.search);
  const query = new URLSearchParams();
  ["release_year", "status", "path"].forEach((key) => {
    const value = source.get(key);
    if (value) query.set(key, value);
  });
  return query;
}

async function loadStats() {
  const query = pageFilters();
  const response = await fetch(`/api/stats${query.size ? `?${query}` : ""}`);
  const data = await response.json();
  if (!response.ok) throw apiError(data, "error.statsRead");
  statsState.data = data;
  renderStats();
}

function renderStats() {
  const data = statsState.data;
  const total = data.summary.total_works;
  statsEl.summary.textContent = total === data.summary.all_works
    ? t("stats.allSummary", { total })
    : t("stats.filteredSummary", { all: data.summary.all_works, total });
  renderFilterOptions(data);
  renderSummaryCards(data);
  const insights = data.summary.insight_items || [];
  statsEl.insights.innerHTML = (insights.length ? insights.map(translateInsight) : data.summary.insights).map((item) => `<li>${escapeHtml(item)}</li>`).join("");
  Object.keys(rankingMeta).forEach((key) => renderRanking(key, data.rankings[key], data));
  renderYears(data.release_years);
  renderStatuses(data.fetch_statuses);
  statsEl.content.hidden = false;
}

function renderFilterOptions(data) {
  const active = data.filters;
  statsEl.year.innerHTML = `<option value="">${t("stats.allYears")}</option>${data.options.release_years
    .map((year) => `<option value="${escapeAttr(year)}">${t("common.year", { year: escapeHtml(year) })}</option>`).join("")}`;
  statsEl.status.innerHTML = `<option value="">${t("search.allStatus")}</option>${data.options.statuses
    .map((status) => `<option value="${escapeAttr(status)}">${escapeHtml(statusLabel(status))}</option>`).join("")}`;
  statsEl.pathSuggestions.innerHTML = data.options.paths
    .map((item) => `<option value="${escapeAttr(item.path)}">${t("common.works", { count: item.count })}</option>`).join("");
  statsEl.year.value = active.release_year;
  statsEl.status.value = active.status;
  statsEl.path.value = active.path;
}

function renderSummaryCards(data) {
  const cards = [{ label: t("stats.currentWorks"), value: data.summary.total_works, detail: t("stats.fullLibrary", { count: data.summary.all_works }) }];
  Object.entries(coverageLabels).forEach(([key, labelKey]) => {
    const item = data.summary.coverage[key];
    cards.push({ label: t(labelKey), value: `${item.percentage}%`, detail: t("common.knownMissing", item) });
  });
  statsEl.cards.innerHTML = cards.map((card) => `
    <article class="summary-card">
      <p>${escapeHtml(card.label)}</p>
      <strong>${escapeHtml(card.value)}</strong>
      <span>${escapeHtml(card.detail)}</span>
    </article>
  `).join("");
}

function renderRanking(key, items, data) {
  const meta = rankingMeta[key];
  const title = t(meta.titleKey);
  const target = document.querySelector(`[data-ranking="${key}"]`);
  const coverage = data.summary.coverage[meta.coverage];
  target.innerHTML = `
    <div class="ranking-header">
      <div><p class="section-kicker">${meta.eyebrow}</p><h2>${t("stats.ranking", { title })}</h2></div>
      <span>${t("common.knownMissing", coverage)}</span>
    </div>
    ${items.length ? `
      <div class="rank-list rank-top">${rankRows(items.slice(0, 10), meta.param, data)}</div>
      ${items.length > 10 ? `
        <details class="all-ranking">
          <summary>${t("stats.allRanking", { count: items.length })}</summary>
          <label><span class="sr-only">${t("facet.search", { title })}</span><input class="rank-search" placeholder="${escapeAttr(t("facet.search", { title }))}"></label>
          <div class="rank-list rank-all">${rankRows(items, meta.param, data)}</div>
        </details>` : ""}
    ` : `<p class="empty-state">${t("stats.emptyRanking", { title })}</p>`}
  `;
  const search = target.querySelector(".rank-search");
  if (search) search.addEventListener("input", () => {
    const query = search.value.trim().toLocaleLowerCase();
    target.querySelectorAll(".rank-all .rank-row").forEach((row) => {
      row.hidden = Boolean(query) && !row.dataset.name.includes(query);
    });
  });
}

function rankRows(items, param, data) {
  const max = items[0]?.count || 1;
  return items.map((item, index) => `
    <a class="rank-row" data-name="${escapeAttr(item.name.toLocaleLowerCase())}" href="${workListUrl(param, item.name, data.filters)}">
      <span class="rank-index">${index + 1}</span>
      <span class="rank-main">
        <span class="rank-label"><strong>${escapeHtml(item.name)}</strong><span>${t("common.works", { count: item.count })} · ${item.percentage}%</span></span>
        <span class="rank-track"><span style="width:${Math.max(2, item.count / max * 100)}%"></span></span>
      </span>
    </a>
  `).join("");
}

function workListUrl(param, value, filters) {
  const query = new URLSearchParams();
  ["release_year", "status", "path"].forEach((key) => {
    if (filters[key]) query.set(key, filters[key]);
  });
  query.set(param, value);
  return `/?${query}`;
}

function renderYears(items) {
  if (!items.length) {
    statsEl.yearChart.innerHTML = `<p class="empty-state">${t("stats.noYears")}</p>`;
    return;
  }
  const max = Math.max(...items.map((item) => item.count));
  statsEl.yearChart.innerHTML = items.map((item) => `
    <div class="year-column" title="${escapeAttr(t("stats.yearTip", item))}">
      <span class="year-count">${item.count}</span>
      <span class="year-bar" style="height:${Math.max(5, item.count / max * 150)}px"></span>
      <span class="year-label">${escapeHtml(item.year)}</span>
    </div>
  `).join("");
}

function renderStatuses(items) {
  const colors = { 成功: "status-success", 部分成功: "status-partial", 失败: "status-failed", 未抓取: "status-unfetched" };
  const visible = items.filter((item) => item.count > 0);
  if (!visible.length) {
    statsEl.statusChart.innerHTML = `<p class="empty-state">${t("stats.noWorks")}</p>`;
    return;
  }
  statsEl.statusChart.innerHTML = `
    <div class="status-stack" aria-label="${escapeAttr(t("stats.statusRatio"))}">
      ${visible.map((item) => `<span class="${colors[item.status] || ""}" style="width:${item.percentage}%" title="${escapeAttr(`${statusLabel(item.status)}: ${t("common.works", { count: item.count })}`)}"></span>`).join("")}
    </div>
    <div class="status-legend">
      ${items.map((item) => `
        <div><span class="legend-dot ${colors[item.status] || ""}"></span><strong>${escapeHtml(statusLabel(item.status))}</strong><span>${t("common.works", { count: item.count })} · ${item.percentage}%</span></div>
      `).join("")}
    </div>
  `;
}

statsEl.form.addEventListener("submit", (event) => {
  event.preventDefault();
  const query = new URLSearchParams();
  if (statsEl.year.value) query.set("release_year", statsEl.year.value);
  if (statsEl.status.value) query.set("status", statsEl.status.value);
  if (statsEl.path.value.trim()) query.set("path", statsEl.path.value.trim());
  window.location.search = query.toString();
});

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
  })[char]);
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll("\n", " ");
}

function statusLabel(status) { return t(`status.${status}`); }
function translateInsight(item) { const params = { ...(item.params || {}) }; if (params.dimension) params.dimension = t(`dimension.${params.dimension}`); return t(item.code, params); }
function apiError(data, fallbackKey) { const key = data?.error_code || fallbackKey; const localized = t(key, data?.error_params || {}); const error = new Error(localized === key ? t(fallbackKey) : localized); error.detail = data?.error_detail || ((data?.error && key === "error.unexpected") ? data.error : ""); return error; }

window.addEventListener("localechange", () => { if (statsState.data) renderStats(); });
I18n.bindSwitcher();

loadStats().catch((error) => {
  statsEl.error.hidden = false;
  statsEl.error.innerHTML = `${escapeHtml(error.message)}${error.detail ? `<details><summary>${t("error.details")}</summary><pre>${escapeHtml(error.detail)}</pre></details>` : ""}`;
  statsEl.summary.textContent = t("error.statsSummary");
});
