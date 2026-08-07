const state = { works: [], totalWorks: 0, pollTimer: null };

const el = {
  path: document.querySelector("#pathInput"),
  proxy: document.querySelector("#proxyInput"),
  fetch: document.querySelector("#fetchInput"),
  scan: document.querySelector("#scanButton"),
  fetchButton: document.querySelector("#fetchButton"),
  forceMetrics: document.querySelector("#forceMetricsInput"),
  metricsButton: document.querySelector("#metricsButton"),
  search: document.querySelector("#searchInput"),
  status: document.querySelector("#statusFilter"),
  body: document.querySelector("#worksBody"),
  summary: document.querySelector("#summary"),
  jobPanel: document.querySelector("#jobPanel"),
  jobTitle: document.querySelector("#jobTitle"),
  jobPercent: document.querySelector("#jobPercent"),
  jobBar: document.querySelector("#jobBar"),
  jobCount: document.querySelector("#jobCount"),
  jobCurrent: document.querySelector("#jobCurrent"),
  jobMessage: document.querySelector("#jobMessage"),
  jobError: document.querySelector("#jobError"),
  activeFilters: document.querySelector("#activeFilters"),
};

const filterNames = {
  release_year: "发售年份",
  status: "抓取状态",
  path: "路径",
  tag: "标签",
  voice_actor: "声优",
  circle: "社团",
};

function activeQuery() {
  const source = new URLSearchParams(window.location.search);
  const query = new URLSearchParams();
  Object.keys(filterNames).forEach((key) => {
    const value = source.get(key);
    if (value) query.set(key, value);
  });
  return query;
}

async function loadWorks() {
  const query = activeQuery();
  const response = await fetch(`/api/works${query.size ? `?${query}` : ""}`);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "读取作品列表失败");
  state.works = data.works || [];
  state.totalWorks = Number(data.total_works ?? state.works.length);
  el.status.value = query.get("status") || "";
  renderActiveFilters(query);
  render();
}

async function scan() {
  try {
    const response = await fetch("/api/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: el.path.value, fetch: el.fetch.checked, proxy: el.proxy.value }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "扫描失败");
    startPolling(data.job_id, "扫描任务已启动");
  } catch (error) {
    alert(error.message);
    render();
  }
}

async function fetchMissing() {
  try {
    const response = await fetch("/api/fetch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ proxy: el.proxy.value }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "抓取失败");
    startPolling(data.job_id, "补抓任务已启动");
  } catch (error) {
    alert(error.message);
    render();
  }
}

async function refreshMetrics() {
  try {
    const response = await fetch("/api/metrics/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ proxy: el.proxy.value, force: el.forceMetrics.checked }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "刷新销量与评价失败");
    startPolling(data.job_id, el.forceMetrics.checked ? "全库指标刷新已启动" : "缺失指标刷新已启动");
  } catch (error) {
    alert(error.message);
    render();
  }
}

function startPolling(jobId, message) {
  if (!jobId) {
    alert("任务创建失败：缺少 job_id");
    return;
  }
  setBusy(true, message);
  showJob({
    status: "running",
    stage: "准备中",
    total: 0,
    completed: 0,
    current_rj: "",
    message,
    last_error: "",
  });
  if (state.pollTimer) clearInterval(state.pollTimer);
  pollJob(jobId);
  state.pollTimer = setInterval(() => pollJob(jobId), 800);
}

async function pollJob(jobId) {
  try {
    const response = await fetch(`/api/jobs/${encodeURIComponent(jobId)}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "读取任务状态失败");
    const job = data.job;
    showJob(job);
    if (job.status !== "running") {
      stopPolling();
      setBusy(false);
      await loadWorks();
      render(job.status === "success" ? "任务完成，列表已刷新" : "任务失败，列表已刷新");
    }
  } catch (error) {
    stopPolling();
    setBusy(false);
    alert(error.message);
    render();
  }
}

function stopPolling() {
  if (state.pollTimer) {
    clearInterval(state.pollTimer);
    state.pollTimer = null;
  }
}

function showJob(job) {
  const total = Number(job.total || 0);
  const completed = Number(job.completed || 0);
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
  el.jobPanel.hidden = false;
  el.jobTitle.textContent = job.stage || "任务进行中";
  el.jobPercent.textContent = `${percent}%`;
  el.jobBar.style.width = `${percent}%`;
  el.jobCount.textContent = `${completed} / ${total}`;
  el.jobCurrent.textContent = `当前 RJ：${job.current_rj || "-"}`;
  el.jobMessage.textContent = job.message || "";
  el.jobError.hidden = !job.last_error;
  el.jobError.textContent = job.last_error ? `最近错误：${job.last_error}` : "";
}

function render(message) {
  const query = el.search.value.trim().toLowerCase();
  const status = el.status.value;
  const rows = state.works.filter((work) => {
    const text = [
      work.rj,
      work.local_title,
      work.official_title,
      work.circle,
      work.voice_actors,
      work.tags,
      (work.local_paths || []).join(" "),
    ].join(" ").toLowerCase();
    return (!query || text.includes(query)) && (!status || work.fetch_status === status);
  });

  const scoped = state.works.length === state.totalWorks
    ? `共 ${state.totalWorks} 个作品`
    : `全库 ${state.totalWorks} 个，筛选得到 ${state.works.length} 个`;
  el.summary.textContent = message || `${scoped}，当前显示 ${rows.length} 个`;
  el.body.innerHTML = rows.map(rowHtml).join("");
}

function renderActiveFilters(query) {
  const entries = [...query.entries()];
  el.activeFilters.hidden = entries.length === 0;
  if (!entries.length) {
    el.activeFilters.innerHTML = "";
    return;
  }
  el.activeFilters.innerHTML = `
    <strong>当前精确筛选</strong>
    <div class="filter-chips">
      ${entries.map(([key, value]) => `
        <button class="filter-chip" type="button" data-filter="${escapeAttr(key)}">
          ${escapeHtml(filterNames[key] || key)}：${escapeHtml(value)} <span aria-hidden="true">×</span>
        </button>
      `).join("")}
      <a class="clear-filters" href="/">清除全部</a>
    </div>
  `;
  el.activeFilters.querySelectorAll("[data-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      const next = activeQuery();
      next.delete(button.dataset.filter);
      window.location.search = next.toString();
    });
  });
}

function rowHtml(work) {
  const statusClass = work.fetch_status === "成功" ? "ok" : work.fetch_status === "失败" ? "fail" : "";
  const pathText = (work.local_paths || []).join("\n");
  const statusTitle = work.failure_reason ? ` title="${escapeAttr(work.failure_reason)}"` : "";
  const metricsTitle = metricTitle(work);
  const metricTitleAttr = metricsTitle ? ` title="${escapeAttr(metricsTitle)}"` : "";
  return `
    <tr>
      <td>${escapeHtml(work.rj)}</td>
      <td>${escapeHtml(work.local_title)}</td>
      <td>${linkOrText(work.official_title, work.work_url)}</td>
      <td>${escapeHtml(work.circle)}</td>
      <td>${escapeHtml(work.voice_actors)}</td>
      <td>${escapeHtml(work.release_date)}</td>
      <td>${escapeHtml(work.tags)}</td>
      <td class="metric"${metricTitleAttr}>${formatCount(work.sales_count)}</td>
      <td class="metric"${metricTitleAttr}>${formatRating(work.rating_average)}</td>
      <td class="metric"${metricTitleAttr}>${formatCount(work.rating_count)}</td>
      <td>${escapeHtml(pathText).replaceAll("\n", "<br>")}</td>
      <td><span class="status ${statusClass}"${statusTitle}>${escapeHtml(work.fetch_status)}</span></td>
    </tr>
  `;
}

function metricTitle(work) {
  const parts = [];
  if (work.metrics_last_fetched_at) parts.push(`指标刷新：${work.metrics_last_fetched_at}`);
  if (work.metrics_failure_reason) parts.push(`指标错误：${work.metrics_failure_reason}`);
  return parts.join("\n");
}

function formatCount(value) {
  if (value === null || value === undefined || value === "") return "—";
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString("zh-CN") : "—";
}

function formatRating(value) {
  if (value === null || value === undefined || value === "") return "—";
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(2) : "—";
}

function linkOrText(text, href) {
  if (!href) return escapeHtml(text || "");
  return `<a href="${escapeAttr(href)}" target="_blank" rel="noreferrer">${escapeHtml(text || href)}</a>`;
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[char]);
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll("\n", " ");
}

function setBusy(isBusy, text = "") {
  el.scan.disabled = isBusy;
  el.fetchButton.disabled = isBusy;
  el.metricsButton.disabled = isBusy;
  if (text) el.summary.textContent = text;
}

el.scan.addEventListener("click", scan);
el.fetchButton.addEventListener("click", fetchMissing);
el.metricsButton.addEventListener("click", refreshMetrics);
el.search.addEventListener("input", () => render());
el.status.addEventListener("change", () => {
  const query = activeQuery();
  if (el.status.value) query.set("status", el.status.value);
  else query.delete("status");
  window.location.search = query.toString();
});

loadWorks().catch((error) => alert(error.message));
