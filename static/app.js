const state = {
  works: [],
  totalWorks: 0,
  matchedWorks: 0,
  query: emptyQuery(),
  facets: {},
  facetSearch: {},
  pollTimer: null,
  requestController: null,
  localSession: "",
  pathController: null,
  pathRequestId: 0,
  repairRj: "",
  repairMissingPath: "",
  repairCandidates: [],
  repairMessage: "",
  repairController: null,
  repairRequestId: 0,
  lastJob: null,
  summaryKey: "",
};

const t = (key, params = {}) => I18n.t(key, params);

const facetMeta = {
  circles: { titleKey: "facet.circles", param: "circle" },
  voice_actors: { titleKey: "facet.voice_actors", param: "voice_actor" },
  release_years: { titleKey: "facet.release_years", param: "release_year" },
  tags: { titleKey: "facet.tags", param: "tag" },
};

const el = {
  path: document.querySelector("#pathInput"),
  pathSuggestions: document.querySelector("#pathSuggestions"),
  pathHint: document.querySelector("#pathHint"),
  proxy: document.querySelector("#proxyInput"),
  fetch: document.querySelector("#fetchInput"),
  scan: document.querySelector("#scanButton"),
  fetchButton: document.querySelector("#fetchButton"),
  forceMetrics: document.querySelector("#forceMetricsInput"),
  metricsButton: document.querySelector("#metricsButton"),
  search: document.querySelector("#searchInput"),
  status: document.querySelector("#statusFilter"),
  sort: document.querySelector("#sortFilter"),
  pathFilter: document.querySelector("#pathFilter"),
  facets: document.querySelector("#facetPanels"),
  clearAll: document.querySelector("#clearAll"),
  exportCurrent: document.querySelector("#exportCurrent"),
  exportAll: document.querySelector("#exportAll"),
  body: document.querySelector("#worksBody"),
  summary: document.querySelector("#summary"),
  searchError: document.querySelector("#searchError"),
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

function emptyQuery() {
  return {
    q: "", release_years: [], status: "", path: "", tags: [],
    voice_actors: [], circles: [], sort_by: "", sort_dir: "",
  };
}

function queryFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return {
    q: params.get("q") || "",
    release_years: params.getAll("release_year"),
    status: params.get("status") || "",
    path: params.get("path") || "",
    tags: params.getAll("tag"),
    voice_actors: params.getAll("voice_actor"),
    circles: params.getAll("circle"),
    sort_by: params.get("sort_by") || "",
    sort_dir: params.get("sort_dir") || "",
  };
}

function paramsFromQuery(query) {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  Object.entries(facetMeta).forEach(([key, meta]) => {
    (query[key] || []).forEach((value) => params.append(meta.param, value));
  });
  if (query.status) params.set("status", query.status);
  if (query.path) params.set("path", query.path);
  if (query.sort_by) {
    params.set("sort_by", query.sort_by);
    params.set("sort_dir", query.sort_dir);
  }
  return params;
}

async function loadWorks(query = queryFromUrl(), { updateHistory = false, replace = false } = {}) {
  const params = paramsFromQuery(query);
  if (updateHistory) {
    const url = `${window.location.pathname}${params.size ? `?${params}` : ""}`;
    window.history[replace ? "replaceState" : "pushState"]({}, "", url);
  }
  if (state.requestController) state.requestController.abort();
  state.requestController = new AbortController();
  setSearchLoading(true);
  try {
    const response = await fetch(`/api/works${params.size ? `?${params}` : ""}`, {
      signal: state.requestController.signal,
    });
    const data = await response.json();
    if (!response.ok) throw apiError(data, "error.worksRead");
    state.works = data.works || [];
    state.totalWorks = Number(data.total_works || 0);
    state.matchedWorks = Number(data.matched_works || 0);
    state.query = data.query || emptyQuery();
    state.facets = data.facets || {};
    renderWorkbench();
    renderWorks();
    showSearchError("");
  } catch (error) {
    if (error.name !== "AbortError") showSearchError(error.message, error.detail);
  } finally {
    setSearchLoading(false);
  }
}

function renderWorkbench() {
  if (document.activeElement !== el.search) el.search.value = state.query.q;
  if (document.activeElement !== el.pathFilter) el.pathFilter.value = state.query.path;
  el.status.value = state.query.status;
  el.sort.value = state.query.sort_by ? `${state.query.sort_by}:${state.query.sort_dir}` : "";
  const exportParams = paramsFromQuery(state.query); exportParams.set("lang", I18n.locale);
  el.exportCurrent.href = `/api/export?${exportParams}`;
  el.exportAll.href = `/api/export?lang=${encodeURIComponent(I18n.locale)}`;
  renderFacets();
  renderActiveFilters();
}

function renderFacets() {
  const open = new Set([...el.facets.querySelectorAll("details[open]")].map((item) => item.dataset.facet));
  el.facets.innerHTML = Object.entries(facetMeta).map(([key, meta]) => {
    const title = t(meta.titleKey);
    const items = state.facets[key] || [];
    const visible = items.filter((item) => {
      const term = (state.facetSearch[key] || "").toLocaleLowerCase();
      return !term || item.name.toLocaleLowerCase().includes(term);
    });
    const selectedCount = (state.query[key] || []).length;
    return `
      <details class="facet-panel" data-facet="${key}"${open.has(key) || selectedCount ? " open" : ""}>
        <summary>${title}<span>${selectedCount ? t("facet.selected", { count: selectedCount }) : t("facet.items", { count: items.length })}</span></summary>
        <div class="facet-content">
          <input class="facet-search" data-facet-search="${key}" value="${escapeAttr(state.facetSearch[key] || "")}" placeholder="${escapeAttr(t("facet.search", { title }))}">
          <div class="facet-options">
            ${visible.length ? visible.map((item) => `
              <label class="facet-option">
                <input type="checkbox" data-facet-value="${key}" value="${escapeAttr(item.name)}"${item.selected ? " checked" : ""}>
                <span title="${escapeAttr(item.name)}">${escapeHtml(item.name)}</span>
                <strong>${item.count}</strong>
              </label>`).join("") : `<p class="facet-empty">${t("facet.empty")}</p>`}
          </div>
        </div>
      </details>`;
  }).join("");
  el.facets.querySelectorAll("[data-facet-search]").forEach((input) => {
    input.addEventListener("input", () => {
      state.facetSearch[input.dataset.facetSearch] = input.value;
      renderFacets();
      const next = el.facets.querySelector(`[data-facet-search="${input.dataset.facetSearch}"]`);
      next.focus();
      next.setSelectionRange(input.value.length, input.value.length);
    });
  });
  el.facets.querySelectorAll("[data-facet-value]").forEach((input) => {
    input.addEventListener("change", () => {
      const next = structuredClone(state.query);
      const values = new Set(next[input.dataset.facetValue] || []);
      if (input.checked) values.add(input.value); else values.delete(input.value);
      next[input.dataset.facetValue] = [...values];
      loadWorks(next, { updateHistory: true });
    });
  });
}

function renderActiveFilters() {
  const chips = [];
  if (state.query.q) chips.push({ key: "q", label: t("filter.keyword", { value: state.query.q }) });
  if (state.query.status) chips.push({ key: "status", label: t("filter.status", { value: statusLabel(state.query.status) }) });
  if (state.query.path) chips.push({ key: "path", label: t("filter.path", { value: state.query.path }) });
  Object.entries(facetMeta).forEach(([key, meta]) => {
    state.query[key].forEach((value) => chips.push({ key, value, label: t("filter.value", { title: t(meta.titleKey), value }) }));
  });
  if (state.query.sort_by) {
    chips.push({ key: "sort", label: t("filter.sort", { value: el.sort.selectedOptions[0]?.textContent || t("filter.metric") }) });
  }
  el.activeFilters.hidden = chips.length === 0;
  el.activeFilters.innerHTML = chips.length ? `
    <strong>${t("filter.current")}</strong>
    <div class="filter-chips">
      ${chips.map((chip) => `<button class="filter-chip" type="button" data-chip-key="${chip.key}" data-chip-value="${escapeAttr(chip.value || "")}">${escapeHtml(chip.label)} <span aria-hidden="true">×</span></button>`).join("")}
    </div>` : "";
  el.activeFilters.querySelectorAll("[data-chip-key]").forEach((button) => {
    button.addEventListener("click", () => removeCondition(button.dataset.chipKey, button.dataset.chipValue));
  });
}

function removeCondition(key, value) {
  const next = structuredClone(state.query);
  if (facetMeta[key]) next[key] = next[key].filter((item) => item !== value);
  else if (key === "sort") { next.sort_by = ""; next.sort_dir = ""; }
  else next[key] = "";
  loadWorks(next, { updateHistory: true });
}

function renderWorks(messageKey = "") {
  if (messageKey) state.summaryKey = messageKey;
  el.summary.textContent = state.summaryKey ? t(state.summaryKey) : t("works.summary", { total: state.totalWorks, matched: state.matchedWorks });
  el.body.innerHTML = state.works.length
    ? state.works.map(rowHtml).join("")
    : `<tr><td class="empty-results" colspan="12">${t("works.empty")}</td></tr>`;
  bindPathActions();
}

function rowHtml(work) {
  const statusClass = work.fetch_status === "成功" ? "ok" : work.fetch_status === "失败" ? "fail" : "";
  const statusTitle = work.failure_reason ? ` title="${escapeAttr(work.failure_reason)}"` : "";
  const metricsTitle = metricTitle(work);
  const metricTitleAttr = metricsTitle ? ` title="${escapeAttr(metricsTitle)}"` : "";
  const repairOpen = state.repairRj === work.rj;
  return `<tr data-work-row="${escapeAttr(work.rj)}">
    <td>${escapeHtml(work.rj)}</td><td>${escapeHtml(work.local_title)}</td>
    <td>${linkOrText(work.official_title, work.work_url)}</td><td>${escapeHtml(work.circle)}</td>
    <td>${escapeHtml(work.voice_actors)}</td><td>${escapeHtml(work.release_date)}</td>
    <td>${escapeHtml(work.tags)}</td><td class="metric"${metricTitleAttr}>${formatCount(work.sales_count)}</td>
    <td class="metric"${metricTitleAttr}>${formatRating(work.rating_average)}</td>
    <td class="metric"${metricTitleAttr}>${formatCount(work.rating_count)}</td>
    <td class="local-paths">${pathButtons(work)}</td>
    <td><span class="status ${statusClass}"${statusTitle}>${escapeHtml(statusLabel(work.fetch_status))}</span></td>
  </tr>${repairOpen ? repairRowHtml(work) : ""}`;
}

function pathButtons(work) {
  const paths = work.local_paths || [];
  if (!paths.length) return `<span class="path-empty">${t("works.noPath")}</span>`;
  return paths.map((path) => `<button class="path-link" type="button" data-open-saved data-rj="${escapeAttr(work.rj)}" data-path="${escapeAttr(path)}" title="${escapeAttr(t("works.openPath"))}">${escapeHtml(path)}</button>`).join("");
}

function repairRowHtml(work) {
  const candidates = state.repairCandidates.length ? state.repairCandidates.map((item) => `
    <li class="repair-candidate">
      <span title="${escapeAttr(item.path)}">${escapeHtml(item.path)}</span>
      <div>
        ${item.open_token ? `<button type="button" class="mini-button" data-open-candidate="${escapeAttr(item.open_token)}" data-rj="${escapeAttr(work.rj)}">${t("common.open")}</button>` : ""}
        ${item.save_token ? `<button type="button" class="mini-button primary" data-save-candidate="${escapeAttr(item.save_token)}" data-rj="${escapeAttr(work.rj)}">${t("common.addPath")}</button>` : ""}
      </div>
    </li>`).join("") : `<li class="repair-empty">${t("repair.empty")}</li>`;
  return `<tr class="repair-row"><td colspan="12">
    <section class="path-repair" aria-live="polite">
      <div class="repair-heading"><div><strong>${t("repair.title", { rj: escapeHtml(work.rj) })}</strong><p>${t("repair.missing", { path: escapeHtml(state.repairMissingPath) })}</p></div><button type="button" class="text-button" data-close-repair>${t("common.close")}</button></div>
      <p class="repair-message">${escapeHtml(state.repairMessage || t("repair.locating"))}</p>
      <ul class="repair-candidates">${candidates}</ul>
      <div class="repair-tools">
        <label><span>${t("repair.keyword")}</span><input data-repair-query placeholder="${escapeAttr(t("repair.keywordPlaceholder"))}"></label>
        <button type="button" class="button secondary" data-repair-search data-rj="${escapeAttr(work.rj)}">${t("repair.search")}</button>
        <label><span>${t("repair.manual")}</span><input data-manual-path placeholder="${escapeAttr(t("repair.manualPlaceholder", { rj: work.rj }))}"></label>
        <button type="button" class="button secondary" data-add-manual data-rj="${escapeAttr(work.rj)}">${t("common.addPath")}</button>
      </div>
    </section>
  </td></tr>`;
}

async function ensureLocalSession() {
  if (state.localSession) return state.localSession;
  const response = await fetch("/api/session", { cache: "no-store" });
  const data = await response.json();
  if (!response.ok || !data.token) throw apiError(data, "error.session");
  state.localSession = data.token;
  return state.localSession;
}

async function sensitivePost(url, body, signal) {
  const token = await ensureLocalSession();
  const response = await fetch(url, { method: "POST", signal, headers: { "Content-Type": "application/json", "X-Local-Session": token }, body: JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) {
    const error = apiError(data, "error.localPath");
    error.status = response.status; error.data = data;
    throw error;
  }
  return data;
}

async function openSavedPath(rj, path) {
  try {
    await sensitivePost("/api/paths/open-saved", { rj, path });
  } catch (error) {
    if (error.status === 404 && error.data?.status === "missing") {
      state.repairRj = rj; state.repairMissingPath = path; state.repairCandidates = []; state.repairMessage = t("repair.locating");
      renderWorks();
      await searchRepairPaths(rj, rj, "rj");
      return;
    }
    alert(error.message);
  }
}

async function searchRepairPaths(rj, query, mode = "keyword", retried = false) {
  state.repairRequestId += 1;
  const requestId = state.repairRequestId;
  if (state.repairController) state.repairController.abort();
  state.repairController = new AbortController();
  state.repairMessage = t("repair.searching"); renderWorks();
  try {
    const data = await sensitivePost("/api/local-paths", { mode, query, rj }, state.repairController.signal);
    if (requestId !== state.repairRequestId) return;
    state.repairCandidates = data.candidates || [];
    state.repairMessage = state.repairCandidates.length ? t("repair.found", { count: state.repairCandidates.length }) : t("repair.none");
  } catch (error) {
    if (error.name === "AbortError" || requestId !== state.repairRequestId) return;
    if (!retried && error.status === 503 && error.code === "error.everything_busy") {
      await new Promise((resolve) => setTimeout(resolve, 80));
      return searchRepairPaths(rj, query, mode, true);
    }
    state.repairCandidates = []; state.repairMessage = t("repair.fallback", { message: error.message });
  }
  renderWorks();
}

function bindPathActions() {
  el.body.querySelectorAll("[data-open-saved]").forEach((button) => button.addEventListener("click", () => openSavedPath(button.dataset.rj, button.dataset.path)));
  el.body.querySelector("[data-close-repair]")?.addEventListener("click", () => { state.repairRj = ""; state.repairCandidates = []; renderWorks(); bindPathActions(); });
  el.body.querySelector("[data-repair-search]")?.addEventListener("click", (event) => {
    const input = el.body.querySelector("[data-repair-query]");
    if ((input?.value.trim().length || 0) < 2) return alert(t("path.minimum"));
    searchRepairPaths(event.currentTarget.dataset.rj, input.value.trim());
  });
  el.body.querySelectorAll("[data-open-candidate]").forEach((button) => button.addEventListener("click", async () => {
    try { await sensitivePost("/api/paths/open-candidate", { rj: button.dataset.rj, token: button.dataset.openCandidate }); button.disabled = true; } catch (error) { alert(error.message); }
  }));
  el.body.querySelectorAll("[data-save-candidate]").forEach((button) => button.addEventListener("click", async () => {
    try { await sensitivePost("/api/paths/add-candidate", { rj: button.dataset.rj, token: button.dataset.saveCandidate }); await refreshAfterPathAdded(); } catch (error) { alert(error.message); }
  }));
  el.body.querySelector("[data-add-manual]")?.addEventListener("click", async (event) => {
    const input = el.body.querySelector("[data-manual-path]");
    try { await sensitivePost("/api/paths/add-manual", { rj: event.currentTarget.dataset.rj, path: input.value.trim() }); await refreshAfterPathAdded(); } catch (error) { alert(error.message); }
  });
}

async function refreshAfterPathAdded() {
  state.repairRj = ""; state.repairCandidates = [];
  await loadWorks(state.query);
  renderWorks("works.pathUpdated");
}

async function loadPathSuggestions(text, requestId, retried = false) {
  if (state.pathController) state.pathController.abort();
  state.pathController = new AbortController();
  try {
    const data = await sensitivePost("/api/local-paths", { mode: "keyword", query: text, root_only: true }, state.pathController.signal);
    if (requestId !== state.pathRequestId) return;
    const candidates = data.candidates || [];
    el.pathSuggestions.innerHTML = candidates.length ? candidates.map((item) => `<button type="button" role="option" data-path-choice="${escapeAttr(item.path)}">${escapeHtml(item.path)}</button>`).join("") : `<p>${t("path.none")}</p>`;
    el.pathSuggestions.hidden = false; el.pathHint.textContent = candidates.length ? t("path.found", { count: candidates.length }) : t("path.manual");
    el.pathSuggestions.querySelectorAll("[data-path-choice]").forEach((button) => button.addEventListener("click", () => { el.path.value = button.dataset.pathChoice; el.pathSuggestions.hidden = true; el.pathHint.textContent = t("path.selected"); }));
  } catch (error) {
    if (error.name === "AbortError") return;
    if (!retried && error.status === 503 && error.code === "error.everything_busy") { await new Promise((resolve) => setTimeout(resolve, 80)); return loadPathSuggestions(text, requestId, true); }
    if (requestId === state.pathRequestId) { el.pathSuggestions.hidden = true; el.pathHint.textContent = t("path.error", { message: error.message }); }
  }
}

const updatePathSuggestions = debounce(() => {
  const text = el.path.value.trim(); state.pathRequestId += 1;
  if (text.length < 2) { if (state.pathController) state.pathController.abort(); el.pathSuggestions.hidden = true; el.pathHint.textContent = t("path.minimum"); return; }
  loadPathSuggestions(text, state.pathRequestId);
}, 150);

async function scan() {
  await startJob("/api/scan", { path: el.path.value, fetch: el.fetch.checked, proxy: el.proxy.value }, "job.scanStarted");
}

async function fetchMissing() {
  await startJob("/api/fetch", { proxy: el.proxy.value }, "job.fetchStarted");
}

async function refreshMetrics() {
  await startJob("/api/metrics/refresh", { proxy: el.proxy.value, force: el.forceMetrics.checked }, el.forceMetrics.checked ? "job.metricsAllStarted" : "job.metricsMissingStarted");
}

async function startJob(url, body, message) {
  try {
    const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await response.json();
    if (!response.ok) throw apiError(data, "job.startFailed");
    startPolling(data.job_id, message);
  } catch (error) { alert(error.message); }
}

function startPolling(jobId, message) {
  if (!jobId) return alert(t("job.missingId"));
  setBusy(true, t(message));
  showJob({ status: "running", stage_code: "job.stage.preparing", total: 0, completed: 0, current_rj: "", message_code: message, message_params: {}, last_error: "" });
  if (state.pollTimer) clearInterval(state.pollTimer);
  pollJob(jobId);
  state.pollTimer = setInterval(() => pollJob(jobId), 800);
}

async function pollJob(jobId) {
  try {
    const response = await fetch(`/api/jobs/${encodeURIComponent(jobId)}`);
    const data = await response.json();
    if (!response.ok) throw apiError(data, "job.readFailed");
    showJob(data.job);
    if (data.job.status !== "running") {
      stopPolling(); setBusy(false); await loadWorks(queryFromUrl());
      renderWorks(data.job.status === "success" ? "job.doneRefresh" : "job.failedRefresh");
    }
  } catch (error) { stopPolling(); setBusy(false); alert(error.message); }
}

function stopPolling() {
  if (state.pollTimer) clearInterval(state.pollTimer);
  state.pollTimer = null;
}

function showJob(job) {
  state.lastJob = job;
  const total = Number(job.total || 0), completed = Number(job.completed || 0);
  const percent = total > 0 ? Math.round(completed / total * 100) : 0;
  el.jobPanel.hidden = false; el.jobTitle.textContent = job.stage_code ? t(job.stage_code) : (job.stage || t("job.running"));
  el.jobPercent.textContent = `${percent}%`; el.jobBar.style.width = `${percent}%`;
  el.jobCount.textContent = `${completed} / ${total}`; el.jobCurrent.textContent = t("job.currentRj", { rj: job.current_rj || "-" });
  el.jobMessage.textContent = job.message_code ? t(job.message_code, job.message_params || {}) : (job.message || ""); el.jobError.hidden = !job.last_error;
  el.jobError.textContent = job.last_error ? t("job.lastError", { detail: job.last_error }) : "";
}

function metricTitle(work) {
  const parts = [];
  if (work.metrics_last_fetched_at) parts.push(t("metric.refreshed", { time: work.metrics_last_fetched_at }));
  if (work.metrics_failure_reason) parts.push(t("metric.error", { detail: work.metrics_failure_reason }));
  return parts.join("\n");
}

function formatCount(value) {
  if (value === null || value === undefined || value === "") return "—";
  const number = Number(value); return Number.isFinite(number) ? number.toLocaleString(I18n.locale) : "—";
}

function formatRating(value) {
  if (value === null || value === undefined || value === "") return "—";
  const number = Number(value); return Number.isFinite(number) ? number.toFixed(2) : "—";
}

function linkOrText(text, href) {
  if (!href) return escapeHtml(text || "");
  return `<a href="${escapeAttr(href)}" target="_blank" rel="noreferrer">${escapeHtml(text || href)}</a>`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char]);
}

function escapeAttr(value) { return escapeHtml(value).replaceAll("\n", " "); }
function setBusy(busy, text = "") { el.scan.disabled = busy; el.fetchButton.disabled = busy; el.metricsButton.disabled = busy; if (text) el.summary.textContent = text; }
function setSearchLoading(loading) { document.body.classList.toggle("search-loading", loading); }
function showSearchError(message, detail = "") { el.searchError.hidden = !message; el.searchError.innerHTML = message ? `${escapeHtml(message)}${detail ? `<details><summary>${t("error.details")}</summary><pre>${escapeHtml(detail)}</pre></details>` : ""}` : ""; }
function statusLabel(status) { return t(`status.${status}`); }
function apiError(data, fallbackKey) { const key = data?.error_code || fallbackKey; const error = new Error(t(key, data?.error_params || {}) === key ? t(fallbackKey) : t(key, data?.error_params || {})); error.code = key; error.detail = data?.error_detail || ((data?.error && key === "error.unexpected") ? data.error : ""); return error; }
function debounce(callback, delay = 250) { let timer; return (...args) => { clearTimeout(timer); timer = setTimeout(() => callback(...args), delay); }; }

const updateTextQuery = debounce(() => {
  const next = structuredClone(state.query);
  next.q = el.search.value.trim(); next.path = el.pathFilter.value.trim();
  loadWorks(next, { updateHistory: true, replace: true });
});

el.scan.addEventListener("click", scan);
el.path.addEventListener("input", updatePathSuggestions);
el.path.addEventListener("keydown", (event) => {
  if (event.key === "Escape") el.pathSuggestions.hidden = true;
  if (event.key === "ArrowDown" && !el.pathSuggestions.hidden) { event.preventDefault(); el.pathSuggestions.querySelector("button")?.focus(); }
});
el.pathSuggestions.addEventListener("keydown", (event) => {
  const buttons = [...el.pathSuggestions.querySelectorAll("button")];
  const index = buttons.indexOf(document.activeElement);
  if (event.key === "ArrowDown" && index >= 0) { event.preventDefault(); buttons[Math.min(index + 1, buttons.length - 1)]?.focus(); }
  if (event.key === "ArrowUp" && index >= 0) { event.preventDefault(); if (index === 0) el.path.focus(); else buttons[index - 1]?.focus(); }
  if (event.key === "Escape") { el.pathSuggestions.hidden = true; el.path.focus(); }
  if ((event.key === "Enter" || event.key === " ") && index >= 0) { event.preventDefault(); buttons[index].click(); }
});
el.fetchButton.addEventListener("click", fetchMissing);
el.metricsButton.addEventListener("click", refreshMetrics);
el.search.addEventListener("input", updateTextQuery);
el.pathFilter.addEventListener("input", updateTextQuery);
el.status.addEventListener("change", () => { const next = structuredClone(state.query); next.status = el.status.value; loadWorks(next, { updateHistory: true }); });
el.sort.addEventListener("change", () => { const next = structuredClone(state.query); [next.sort_by, next.sort_dir] = el.sort.value ? el.sort.value.split(":") : ["", ""]; loadWorks(next, { updateHistory: true }); });
el.clearAll.addEventListener("click", () => { state.facetSearch = {}; loadWorks(emptyQuery(), { updateHistory: true }); });
window.addEventListener("popstate", () => loadWorks(queryFromUrl()));
window.addEventListener("localechange", () => { if (state.repairRj) state.repairMessage = t("repair.locating"); renderWorkbench(); renderWorks(); if (state.lastJob) showJob(state.lastJob); });

I18n.bindSwitcher();
loadWorks(queryFromUrl());
