const statsState = { data: null };

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
  tags: { title: "标签", eyebrow: "TAGS", param: "tag", coverage: "tags" },
  voice_actors: { title: "声优", eyebrow: "VOICE ACTORS", param: "voice_actor", coverage: "voice_actors" },
  circles: { title: "社团", eyebrow: "CIRCLES", param: "circle", coverage: "circles" },
};

const coverageLabels = {
  tags: "标签覆盖",
  voice_actors: "声优覆盖",
  circles: "社团覆盖",
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
  if (!response.ok) throw new Error(data.error || "读取统计失败");
  statsState.data = data;
  renderStats();
}

function renderStats() {
  const data = statsState.data;
  const total = data.summary.total_works;
  statsEl.summary.textContent = total === data.summary.all_works
    ? `全库共 ${total} 部唯一 RJ 作品`
    : `全库 ${data.summary.all_works} 部，当前筛选 ${total} 部`;
  renderFilterOptions(data);
  renderSummaryCards(data);
  statsEl.insights.innerHTML = data.summary.insights.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
  Object.keys(rankingMeta).forEach((key) => renderRanking(key, data.rankings[key], data));
  renderYears(data.release_years);
  renderStatuses(data.fetch_statuses);
  statsEl.content.hidden = false;
}

function renderFilterOptions(data) {
  const active = data.filters;
  statsEl.year.innerHTML = `<option value="">全部年份</option>${data.options.release_years
    .map((year) => `<option value="${escapeAttr(year)}">${escapeHtml(year)} 年</option>`).join("")}`;
  statsEl.status.innerHTML = `<option value="">全部状态</option>${data.options.statuses
    .map((status) => `<option value="${escapeAttr(status)}">${escapeHtml(status)}</option>`).join("")}`;
  statsEl.pathSuggestions.innerHTML = data.options.paths
    .map((item) => `<option value="${escapeAttr(item.path)}">${item.count} 部作品</option>`).join("");
  statsEl.year.value = active.release_year;
  statsEl.status.value = active.status;
  statsEl.path.value = active.path;
}

function renderSummaryCards(data) {
  const cards = [{ label: "当前作品", value: data.summary.total_works, detail: `全库 ${data.summary.all_works} 部` }];
  Object.entries(coverageLabels).forEach(([key, label]) => {
    const item = data.summary.coverage[key];
    cards.push({ label, value: `${item.percentage}%`, detail: `${item.known} 部已知 · ${item.missing} 部缺失` });
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
  const target = document.querySelector(`[data-ranking="${key}"]`);
  const coverage = data.summary.coverage[meta.coverage];
  target.innerHTML = `
    <div class="ranking-header">
      <div><p class="section-kicker">${meta.eyebrow}</p><h2>${meta.title}排行</h2></div>
      <span>${coverage.known} 已知 · ${coverage.missing} 缺失</span>
    </div>
    ${items.length ? `
      <div class="rank-list rank-top">${rankRows(items.slice(0, 10), meta.param, data)}</div>
      ${items.length > 10 ? `
        <details class="all-ranking">
          <summary>查看完整排名（${items.length}）</summary>
          <label><span class="sr-only">搜索${meta.title}</span><input class="rank-search" placeholder="搜索${meta.title}"></label>
          <div class="rank-list rank-all">${rankRows(items, meta.param, data)}</div>
        </details>` : ""}
    ` : `<p class="empty-state">当前范围没有可统计的${meta.title}数据。</p>`}
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
        <span class="rank-label"><strong>${escapeHtml(item.name)}</strong><span>${item.count} 部 · ${item.percentage}%</span></span>
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
    statsEl.yearChart.innerHTML = `<p class="empty-state">当前范围没有可解析的发售年份。</p>`;
    return;
  }
  const max = Math.max(...items.map((item) => item.count));
  statsEl.yearChart.innerHTML = items.map((item) => `
    <div class="year-column" title="${escapeAttr(`${item.year} 年：${item.count} 部（${item.percentage}%）`)}">
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
    statsEl.statusChart.innerHTML = `<p class="empty-state">当前范围没有作品。</p>`;
    return;
  }
  statsEl.statusChart.innerHTML = `
    <div class="status-stack" aria-label="抓取状态比例">
      ${visible.map((item) => `<span class="${colors[item.status] || ""}" style="width:${item.percentage}%" title="${escapeAttr(`${item.status}：${item.count} 部`)}"></span>`).join("")}
    </div>
    <div class="status-legend">
      ${items.map((item) => `
        <div><span class="legend-dot ${colors[item.status] || ""}"></span><strong>${escapeHtml(item.status)}</strong><span>${item.count} 部 · ${item.percentage}%</span></div>
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

loadStats().catch((error) => {
  statsEl.error.hidden = false;
  statsEl.error.textContent = error.message;
  statsEl.summary.textContent = "资料库统计读取失败";
});
