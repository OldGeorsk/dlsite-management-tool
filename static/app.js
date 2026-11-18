const state = {
  works: [],
  page: 1,
  loaded: false,
  textPending: false,
  detailWork: null,
  detailSession: 0,
  pathOpenId: 0,
  pathUpdated: false,
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
  repairLocale: null,
  repairController: null,
  repairRequestId: 0,
  lastJob: null,
};

const PAGE_SIZE = 12;
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
  table: document.querySelector(".table-wrap"),
  pagination: document.querySelector("#pagination"),
  prev: document.querySelector("#prevPage"),
  next: document.querySelector("#nextPage"),
  pageCount: document.querySelector("#pageCount"),
  details: document.querySelector("#workDetails"),
  detailPaths: document.querySelector("#detailPaths"),
  detailRepair: document.querySelector("#detailRepair"),
  preview: document.querySelector("#coverPreview"),
  viewer: document.querySelector("#coverViewer"),
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

async function loadWorks(query = queryFromUrl(), { updateHistory = false, replace = false, resetPage = updateHistory } = {}) {
  const params = paramsFromQuery(query);
  if (resetPage) state.page = 1;
  if (updateHistory) {
    const url = `${window.location.pathname}${params.size ? `?${params}` : ""}`;
    window.history[replace ? "replaceState" : "pushState"]({}, "", url);
  }
  state.requestController?.abort();
  const controller = new AbortController();
  state.requestController = controller;
  setSearchLoading(true);
  try {
    const response = await fetch(`/api/works${params.size ? `?${params}` : ""}`, { signal: controller.signal });
    const data = await response.json();
    if (controller.signal.aborted) return false;
    if (!response.ok) throw apiError(data, "error.worksRead");
    state.works = data.works || [];
    state.totalWorks = Number(data.total_works || 0);
    state.matchedWorks = Number(data.matched_works || 0);
    state.query = data.query || emptyQuery();
    state.facets = data.facets || {};
    state.loaded = true;
    renderWorkbench();
    renderWorks();
    if (el.details.open) {
      state.detailWork = state.works.find((work) => work.rj === state.detailWork?.rj) || state.detailWork;
      renderDetails();
    }
    showSearchError("");
    return true;
  } catch (error) {
    if (!controller.signal.aborted) {
      showSearchError(error.message, error.detail);
      if (!state.loaded) el.summary.textContent = "";
    }
    return false;
  } finally {
    if (state.requestController === controller) setSearchLoading(false);
  }
}

function renderWorkbench() {
  if (!state.textPending && document.activeElement !== el.search) el.search.value = state.query.q;
  if (!state.textPending && document.activeElement !== el.pathFilter) el.pathFilter.value = state.query.path;
  el.status.value = state.query.status;
  el.sort.value = state.query.sort_by ? `${state.query.sort_by}:${state.query.sort_dir}` : "";
  const exportParams = paramsFromQuery(state.query); exportParams.set("lang", I18n.locale);
  el.exportCurrent.href = `/api/export?${exportParams}`;
  el.exportAll.href = `/api/export?lang=${encodeURIComponent(I18n.locale)}`;
  renderFacets();
  renderActiveFilters();
}

function renderFacets() {
  Object.entries(facetMeta).forEach(([key, meta]) => {
    const title = t(meta.titleKey);
    const items = state.facets[key] || [];
    const selectedCount = (state.query[key] || []).length;
    let panel = el.facets.querySelector(`[data-facet="${key}"]`);
    if (!panel) {
      panel = document.createElement("details");
      panel.className = "facet-panel";
      panel.dataset.facet = key;
      panel.innerHTML = `<summary></summary>
        <div class="facet-content">
          <input class="facet-search" data-facet-search="${key}">
          <div class="facet-options"></div>
        </div>`;
      el.facets.append(panel);
      const input = panel.querySelector("[data-facet-search]");
      bindTextInput(input, () => {
        state.facetSearch[key] = input.value;
        renderFacetOptions(key, panel);
      });
    }
    // Keep the focused input attached: replacing it cancels native IME composition.
    panel.querySelector("summary").innerHTML = `${title}<span>${selectedCount ? t("facet.selected", { count: selectedCount }) : t("facet.items", { count: items.length })}</span>`;
    const input = panel.querySelector("[data-facet-search]");
    input.placeholder = t("facet.search", { title });
    if (document.activeElement !== input) input.value = state.facetSearch[key] || "";
    input.setAttribute("aria-label", input.placeholder);
    renderFacetOptions(key, panel);
  });
}

function renderFacetOptions(key, panel) {
  const term = (state.facetSearch[key] || "").toLocaleLowerCase();
  const visible = (state.facets[key] || []).filter((item) => !term || item.name.toLocaleLowerCase().includes(term));
  const options = panel.querySelector(".facet-options");
  const focusedValue = options.contains(document.activeElement) ? document.activeElement.value : null;
  const scroll = options.scrollTop;
  const selected = queryFromUrl()[key];
  options.innerHTML = visible.length ? visible.map((item) => `
    <label class="facet-option">
      <input type="checkbox" data-facet-value="${key}" value="${escapeAttr(item.name)}"${selected.includes(item.name) ? " checked" : ""}>
      <span title="${escapeAttr(item.name)}">${escapeHtml(item.name)}</span>
      <strong>${item.count}</strong>
    </label>`).join("") : `<p class="facet-empty">${t("facet.empty")}</p>`;
  options.scrollTop = scroll;
  options.querySelectorAll("[data-facet-value]").forEach((input) => {
    if (input.value === focusedValue) input.focus({ preventScroll: true });
    input.addEventListener("change", () => {
      const next = queryFromUrl();
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
  const expanded = el.activeFilters.querySelector("details")?.open;
  el.activeFilters.innerHTML = chips.length ? `
    <strong>${t("filter.current")}</strong>
    <div class="filter-chips">
      ${chips.slice(0, 6).map(chipHtml).join("")}
    </div>
    ${chips.length > 6 ? `<details ${expanded ? "open" : ""}><summary>${t("filter.more", { count: chips.length - 6 })}</summary>
      <div class="filter-chips">${chips.slice(6).map(chipHtml).join("")}</div></details>` : ""}` : "";
  el.activeFilters.querySelectorAll("[data-chip-key]").forEach((button) => {
    button.addEventListener("click", () => removeCondition(button.dataset.chipKey, button.dataset.chipValue));
  });
}

function chipHtml(chip) {
  return `<button class="filter-chip" type="button" data-chip-key="${chip.key}" data-chip-value="${escapeAttr(chip.value || "")}">${escapeHtml(chip.label)} <span aria-hidden="true">×</span></button>`;
}

function removeCondition(key, value) {
  const next = queryFromUrl();
  if (facetMeta[key]) next[key] = next[key].filter((item) => item !== value);
  else if (key === "sort") { next.sort_by = ""; next.sort_dir = ""; }
  else next[key] = "";
  loadWorks(next, { updateHistory: true });
}

function renderWorks() {
  const totalPages = Math.max(1, Math.ceil(state.works.length / PAGE_SIZE));
  state.page = Math.min(state.page, totalPages);
  el.summary.textContent = state.loaded ? t("works.summary", { total: state.totalWorks, matched: state.matchedWorks }) : "";
  el.pagination.hidden = state.matchedWorks === 0;
  el.prev.disabled = state.page === 1;
  el.next.disabled = state.page === totalPages;
  el.pageCount.textContent = t("page.count", { page: state.page, total: totalPages });
  const start = (state.page - 1) * PAGE_SIZE;
  const focused = document.activeElement?.closest("[data-work-title], [data-cover]");
  hideCoverPreview();
  el.body.innerHTML = state.works.length
    ? state.works.slice(start, start + PAGE_SIZE).map(rowHtml).join("")
    : state.loaded ? `<tr><td class="empty-results" colspan="5">${t(state.totalWorks ? "works.empty" : "works.emptyLibrary")}</td></tr>` : "";
  if (focused) {
    const key = focused.hasAttribute("data-work-title") ? "data-work-title" : "data-cover";
    el.body.querySelector(`[${key}="${CSS.escape(focused.getAttribute(key))}"]`)?.focus({ preventScroll: true });
  }
}

function workTitle(work) {
  return work.official_title || work.local_title || work.rj;
}

function webUrl(value) {
  if (!value) return "";
  const url = value.startsWith("//") ? `https:${value}` : value;
  return /^https?:\/\//i.test(url) ? url : "";
}

function rowHtml(work) {
  const statusClass = { "成功": "ok", "部分成功": "partial", "失败": "fail" }[work.fetch_status] || "";
  const title = workTitle(work);
  const cover = webUrl(work.cover_url);
  const placeholder = `<span class="cover-placeholder" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="m3 16 5-5 4 4 3-3 6 6"/><circle cx="15" cy="8" r="1"/></svg></span>`;
  const coverHtml = cover
    ? `<button class="work-cover" type="button" data-cover="${escapeAttr(work.rj)}" aria-haspopup="dialog" aria-label="${escapeAttr(t("cover.open", { title }))}">
      ${placeholder}<img alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" src="${escapeAttr(cover)}"></button>`
    : `<span class="work-cover">${placeholder}</span>`;
  return `<tr data-work-row="${escapeAttr(work.rj)}">
    <td><div class="work-cell">${coverHtml}<div>
      <button class="work-title" type="button" data-work-title="${escapeAttr(work.rj)}" aria-haspopup="dialog">${escapeHtml(title)}</button>
      <small class="work-rj">${escapeHtml(work.rj)}</small>
    </div></div></td>
    <td class="secondary-column">${escapeHtml(work.circle || "—")}</td>
    <td class="secondary-column">${escapeHtml(work.voice_actors || "—")}</td>
    <td class="secondary-column metric"><strong>${formatRating(work.rating_average)}</strong><small>${formatCount(work.rating_count)}</small></td>
    <td><span class="status ${statusClass}">${escapeHtml(statusLabel(work.fetch_status))}</span></td>
  </tr>`;
}

function renderDetails() {
  const work = state.detailWork;
  if (!work) return;
  document.querySelector("#detailRj").textContent = work.rj;
  document.querySelector("#workDetailsTitle").textContent = workTitle(work);
  const activePath = el.detailPaths.contains(document.activeElement) ? document.activeElement.dataset.path : null;
  const paths = pathButtons(work);
  if (el.detailPaths.innerHTML !== paths) {
    el.detailPaths.innerHTML = paths;
    [...el.detailPaths.querySelectorAll("[data-path]")].find((button) => button.dataset.path === activePath)?.focus({ preventScroll: true });
  }
  document.querySelector("#detailPathStatus").textContent = state.pathUpdated ? t("works.pathUpdated") : "";
  const metrics = [
    ["table.sales", formatCount(work.sales_count)],
    ["table.average", formatRating(work.rating_average)],
    ["table.ratingCount", formatCount(work.rating_count)],
  ];
  const fields = [
    ["table.rj", escapeHtml(work.rj)], ["table.localTitle", escapeHtml(work.local_title || "—")],
    ["table.officialTitle", linkOrText(work.official_title, webUrl(work.work_url)) || "—"],
    ["table.circle", escapeHtml(work.circle || "—")], ["table.voiceActors", escapeHtml(work.voice_actors || "—")],
    ["table.releaseDate", escapeHtml(work.release_date || "—")], ["table.tags", escapeHtml(work.tags || "—")],
    ["table.status", escapeHtml(statusLabel(work.fetch_status))],
  ];
  const metricNote = metricTitle(work);
  document.querySelector("#detailMetadata").innerHTML = `
    <section><h3>${t("detail.metrics")}</h3><dl class="detail-metrics">
      ${metrics.map(([label, value]) => `<div><dt>${t(label)}</dt><dd>${value}</dd></div>`).join("")}</dl>
      ${metricNote ? `<p class="detail-note">${escapeHtml(metricNote)}</p>` : ""}
    </section>
    <section><h3>${t("detail.metadata")}</h3><dl class="detail-fields">
      ${fields.map(([label, value]) => `<dt>${t(label)}</dt><dd>${value}</dd>`).join("")}</dl>
      ${work.failure_reason ? `<p class="detail-note">${escapeHtml(work.failure_reason)}</p>` : ""}
    </section>`;
}

function showDetails(rj) {
  const work = state.works.find((item) => item.rj === rj);
  if (!work) return;
  hideCoverPreview();
  state.detailWork = work;
  state.detailSession += 1;
  state.pathUpdated = false;
  renderDetails();
  el.details.querySelector(".detail-body").scrollTop = 0;
  el.details.showModal();
}

function pathButtons(work) {
  const paths = work.local_paths || [];
  if (!paths.length) return `<span class="path-empty">${t("works.noPath")}</span>`;
  return paths.map((path) => `<button class="path-link" type="button" data-open-saved data-rj="${escapeAttr(work.rj)}" data-path="${escapeAttr(path)}" title="${escapeAttr(t("works.openPath"))}">${escapeHtml(path)}</button>`).join("");
}

function repairCandidatesHtml(work) {
  return state.repairCandidates.length ? state.repairCandidates.map((item) => `
    <li class="repair-candidate">
      <span title="${escapeAttr(item.path)}">${escapeHtml(item.path)}</span>
      <div>
        ${item.open_token ? `<button type="button" class="mini-button" data-open-candidate="${escapeAttr(item.open_token)}" data-rj="${escapeAttr(work.rj)}">${t("common.open")}</button>` : ""}
        ${item.save_token ? `<button type="button" class="mini-button primary" data-save-candidate="${escapeAttr(item.save_token)}" data-rj="${escapeAttr(work.rj)}">${t("common.addPath")}</button>` : ""}
      </div>
    </li>`).join("") : `<li class="repair-empty">${t("repair.empty")}</li>`;
}

function repairFormHtml(work) {
  return `<section class="path-repair">
      <div class="repair-heading"><div><strong>${t("repair.title", { rj: escapeHtml(work.rj) })}</strong><p>${t("repair.missing", { path: escapeHtml(state.repairMissingPath) })}</p></div><button type="button" class="text-button" data-close-repair>${t("common.close")}</button></div>
      <p class="repair-message" role="status"></p>
      <ul class="repair-candidates"></ul>
      <div class="repair-tools">
        <label><span>${t("repair.keyword")}</span><input data-repair-query placeholder="${escapeAttr(t("repair.keywordPlaceholder"))}"></label>
        <button type="button" class="button secondary" data-repair-search data-rj="${escapeAttr(work.rj)}">${t("repair.search")}</button>
        <label><span>${t("repair.manual")}</span><input data-manual-path placeholder="${escapeAttr(t("repair.manualPlaceholder", { rj: work.rj }))}"></label>
        <button type="button" class="button secondary" data-add-manual data-rj="${escapeAttr(work.rj)}">${t("common.addPath")}</button>
      </div>
    </section>`;
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

function clearRepair() {
  state.repairController?.abort();
  state.repairRequestId += 1;
  state.repairRj = "";
  state.repairMissingPath = "";
  state.repairCandidates = [];
  state.repairLocale = null;
  el.detailRepair.replaceChildren();
}

function renderRepair({ relabel = false } = {}) {
  const work = state.detailWork;
  if (!el.details.open || state.repairRj !== work?.rj) return;
  if (!el.detailRepair.firstElementChild || relabel) {
    const values = [...el.detailRepair.querySelectorAll("input")].map((input) => input.value);
    el.detailRepair.innerHTML = repairFormHtml(work);
    el.detailRepair.querySelectorAll("input").forEach((input, index) => { input.value = values[index] || ""; });
  }
  el.detailRepair.querySelector(".repair-message").textContent = t(...state.repairLocale);
  const list = el.detailRepair.querySelector(".repair-candidates");
  if (list.contains(document.activeElement)) el.detailRepair.querySelector("[data-repair-query]").focus();
  list.innerHTML = repairCandidatesHtml(work);
}

async function openSavedPath(rj, path) {
  const session = state.detailSession;
  const openId = ++state.pathOpenId;
  try {
    await sensitivePost("/api/paths/open-saved", { rj, path });
  } catch (error) {
    if (!el.details.open || session !== state.detailSession || openId !== state.pathOpenId) return;
    if (error.status === 404 && error.data?.status === "missing") {
      clearRepair();
      state.pathUpdated = false;
      document.querySelector("#detailPathStatus").textContent = "";
      state.repairRj = rj;
      state.repairMissingPath = path;
      const pending = searchRepairPaths(rj, rj, "rj");
      el.detailRepair.querySelector("[data-repair-query]")?.focus();
      await pending;
      return;
    }
    alert(error.message);
  }
}

async function searchRepairPaths(rj, query, mode = "keyword", retried = false) {
  const requestId = ++state.repairRequestId;
  state.repairController?.abort();
  state.repairController = new AbortController();
  state.repairCandidates = [];
  state.repairLocale = ["repair.searching"];
  renderRepair();
  try {
    const data = await sensitivePost("/api/local-paths", { mode, query, rj }, state.repairController.signal);
    if (requestId !== state.repairRequestId) return;
    state.repairCandidates = data.candidates || [];
    state.repairLocale = state.repairCandidates.length ? ["repair.found", { count: state.repairCandidates.length }] : ["repair.none"];
  } catch (error) {
    if (error.name === "AbortError" || requestId !== state.repairRequestId) return;
    if (!retried && error.status === 503 && error.code === "error.everything_busy") {
      await new Promise((resolve) => setTimeout(resolve, 80));
      if (requestId === state.repairRequestId) return searchRepairPaths(rj, query, mode, true);
      return;
    }
    state.repairCandidates = [];
    state.repairLocale = ["repair.fallback", { message: error.message }];
  }
  renderRepair();
}

el.details.addEventListener("click", async (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  const { rj, path, openCandidate, saveCandidate } = button.dataset;
  if (button.matches("[data-open-saved]")) return openSavedPath(rj, path);
  if (button.matches("[data-close-repair]")) {
    const missing = state.repairMissingPath;
    clearRepair();
    [...el.detailPaths.querySelectorAll("[data-path]")].find((item) => item.dataset.path === missing)?.focus();
    return;
  }
  if (button.matches("[data-repair-search]")) {
    const query = el.detailRepair.querySelector("[data-repair-query]").value.trim();
    if (query.length < 2) return alert(t("path.minimum"));
    return searchRepairPaths(rj, query);
  }
  if (!button.matches("[data-open-candidate], [data-save-candidate], [data-add-manual]")) return;

  const session = state.detailSession;
  button.disabled = true;
  try {
    if (openCandidate) {
      await sensitivePost("/api/paths/open-candidate", { rj, token: openCandidate });
      return;
    }
    if (saveCandidate) {
      await sensitivePost("/api/paths/add-candidate", { rj, token: saveCandidate });
    } else {
      const path = el.detailRepair.querySelector("[data-manual-path]").value.trim();
      await sensitivePost("/api/paths/add-manual", { rj, path });
    }
    if (session === state.detailSession && el.details.open) {
      clearRepair();
      state.pathUpdated = true;
      renderDetails();
      el.detailPaths.querySelector("button")?.focus();
    }
    await loadWorks(queryFromUrl());
  } catch (error) {
    button.disabled = false;
    if (session === state.detailSession && el.details.open) alert(error.message);
  }
});

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
  setBusy(true);
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
function setBusy(busy) {
  for (const button of [el.scan, el.fetchButton, el.metricsButton]) button.disabled = busy;
}
function setSearchLoading(loading) {
  document.body.classList.toggle("search-loading", loading);
  el.table.setAttribute("aria-busy", String(loading));
}
function showSearchError(message, detail = "") {
  el.searchError.hidden = !message;
  el.searchError.innerHTML = message ? `<p>${escapeHtml(message)}</p>
    ${detail ? `<details><summary>${t("error.details")}</summary><pre>${escapeHtml(detail)}</pre></details>` : ""}
    <button type="button" class="text-button">${t("works.retry")}</button>` : "";
}
function statusLabel(status) { return t(`status.${status}`); }
function apiError(data, fallbackKey) { const key = data?.error_code || fallbackKey; const error = new Error(t(key, data?.error_params || {}) === key ? t(fallbackKey) : t(key, data?.error_params || {})); error.code = key; error.detail = data?.error_detail || ((data?.error && key === "error.unexpected") ? data.error : ""); return error; }
function debounce(callback, delay = 250) {
  let timer;
  const update = (...args) => { clearTimeout(timer); timer = setTimeout(() => callback(...args), delay); };
  update.cancel = () => clearTimeout(timer);
  return update;
}

function bindTextInput(input, callback) {
  let composing = false;
  input.addEventListener("compositionstart", () => { composing = true; callback.cancel?.(); });
  input.addEventListener("compositionend", () => { composing = false; callback(); });
  input.addEventListener("input", (event) => { if (!composing && !event.isComposing) callback(); });
}

const submitTextQuery = debounce((q, path) => {
  state.textPending = false;
  loadWorks({ ...queryFromUrl(), q, path }, { updateHistory: true, replace: true });
});

function updateTextQuery() {
  state.textPending = true;
  submitTextQuery(el.search.value.trim(), el.pathFilter.value.trim());
}

updateTextQuery.cancel = () => {
  state.textPending = false;
  submitTextQuery.cancel();
};

el.scan.addEventListener("click", scan);
bindTextInput(el.path, updatePathSuggestions);
el.path.addEventListener("keydown", (event) => {
  if (event.isComposing || event.keyCode === 229) return;
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
bindTextInput(el.search, updateTextQuery);
bindTextInput(el.pathFilter, updateTextQuery);
el.status.addEventListener("change", () => { const next = queryFromUrl(); next.status = el.status.value; loadWorks(next, { updateHistory: true }); });
el.sort.addEventListener("change", () => { const next = queryFromUrl(); [next.sort_by, next.sort_dir] = el.sort.value ? el.sort.value.split(":") : ["", ""]; loadWorks(next, { updateHistory: true }); });
el.clearAll.addEventListener("click", () => { updateTextQuery.cancel(); state.facetSearch = {}; loadWorks(emptyQuery(), { updateHistory: true }); });
window.addEventListener("popstate", () => {
  updateTextQuery.cancel();
  loadWorks(queryFromUrl(), { resetPage: true });
});
window.addEventListener("localechange", () => {
  renderWorkbench();
  renderWorks();
  if (el.details.open) {
    renderDetails();
    renderRepair({ relabel: true });
  }
  if (state.lastJob) showJob(state.lastJob);
});

el.searchError.addEventListener("click", (event) => {
  if (event.target.closest("button")) loadWorks(queryFromUrl());
});

function changePage(delta) {
  state.page += delta;
  renderWorks();
  (delta > 0 && !el.next.disabled ? el.next : el.prev.disabled ? el.next : el.prev).focus({ preventScroll: true });
  el.table.scrollIntoView({ block: "nearest" });
}

el.prev.addEventListener("click", () => changePage(-1));
el.next.addEventListener("click", () => changePage(1));

const settingsMenu = document.querySelector(".settings");
document.addEventListener("click", (event) => {
  document.querySelectorAll(".facet-panel[open], .settings[open]").forEach((menu) => {
    if (!menu.contains(event.target)) menu.open = false;
  });
});
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || event.defaultPrevented || event.isComposing || el.details.open || el.viewer.open) return;
  hideCoverPreview();
  const menu = event.target.closest(".facet-panel[open], .settings[open]")
    || el.facets.querySelector(".facet-panel[open]") || (settingsMenu.open ? settingsMenu : null);
  if (menu) {
    menu.open = false;
    menu.querySelector("summary").focus();
  }
});

for (const dialog of [el.details, el.viewer]) {
  dialog.querySelector(".close-button").addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) {
      const { left, top, right, bottom } = dialog.getBoundingClientRect();
      if (event.clientX < left || event.clientX > right || event.clientY < top || event.clientY > bottom) dialog.close();
    }
  });
}

el.details.addEventListener("close", () => {
  const rj = state.detailWork?.rj;
  clearRepair();
  state.detailWork = null;
  (el.body.querySelector(`[data-work-title="${CSS.escape(rj || "")}"]`) || el.search).focus({ preventScroll: true });
});

const coverSize = document.querySelector("#coverSize");
const coverHover = document.querySelector("#coverHover");
const previewImage = el.preview.querySelector("img");
const viewerImage = el.viewer.querySelector("img");
const hoverPointer = matchMedia("(hover: hover) and (pointer: fine)");
let coverTimer;

function hideCoverPreview() {
  clearTimeout(coverTimer);
  el.preview.hidden = true;
  previewImage.removeAttribute("src");
}

el.body.addEventListener("pointerover", (event) => {
  const button = event.target.closest("[data-cover]");
  const img = button?.querySelector("img");
  if (!img || img.hidden || button.contains(event.relatedTarget) || event.pointerType === "touch"
    || !coverHover.checked || !hoverPointer.matches || !img.naturalWidth) return;
  coverTimer = setTimeout(() => {
    const bounds = button.getBoundingClientRect();
    const width = Math.min(320, document.documentElement.clientWidth - 16);
    const height = Math.min(254, window.innerHeight - 16);
    const left = bounds.right + width + 8 <= document.documentElement.clientWidth
      ? bounds.right + 8 : Math.max(8, bounds.left - width - 8);
    el.preview.style.left = `${left}px`;
    el.preview.style.top = `${Math.max(8, Math.min(bounds.top, window.innerHeight - height - 8))}px`;
    previewImage.src = img.src;
    el.preview.hidden = false;
  }, 300);
});
el.body.addEventListener("pointerout", (event) => {
  const button = event.target.closest("[data-cover]");
  if (button && !button.contains(event.relatedTarget)) hideCoverPreview();
});
el.body.addEventListener("error", (event) => {
  if (event.target.matches?.(".work-cover img")) {
    event.target.hidden = true;
    event.target.parentElement.disabled = true;
  }
}, true);
window.addEventListener("scroll", hideCoverPreview, { passive: true });
window.addEventListener("resize", hideCoverPreview);
coverHover.addEventListener("change", hideCoverPreview);
coverSize.addEventListener("change", () => {
  document.body.dataset.coverSize = coverSize.value;
  hideCoverPreview();
});

el.body.addEventListener("click", (event) => {
  const title = event.target.closest("[data-work-title]");
  if (title) return showDetails(title.dataset.workTitle);
  const button = event.target.closest("[data-cover]");
  if (!button || button.disabled) return;
  const work = state.works.find((item) => item.rj === button.dataset.cover);
  if (!work) return;
  hideCoverPreview();
  el.viewer.querySelector("h2").textContent = workTitle(work);
  viewerImage.hidden = false;
  el.viewer.querySelector(".cover-art p").hidden = true;
  viewerImage.src = webUrl(work.cover_url);
  el.viewer.showModal();
});

viewerImage.addEventListener("error", () => {
  viewerImage.hidden = true;
  el.viewer.querySelector(".cover-art p").hidden = false;
});
el.viewer.addEventListener("close", () => {
  viewerImage.removeAttribute("src");
});

I18n.bindSwitcher();
loadWorks(queryFromUrl());
