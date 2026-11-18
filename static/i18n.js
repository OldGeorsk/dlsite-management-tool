(() => {
  const STORAGE_KEY = "dlsite-tool.locale";
  const SUPPORTED = new Set(["zh-CN", "en"]);
  const zh = {
    "filter.more": "展开其他 {count} 项",
    "layout.resize": "调整侧栏宽度", "works.settings": "设置", "works.loading": "正在读取作品…",
    "works.emptyLibrary": "资料库暂无作品，请先扫描目录。", "works.retry": "重新加载", "table.work": "作品",
    "table.rating": "评分", "table.dataStatus": "资料状态", "page.label": "分页",
    "page.prev": "上一页", "page.next": "下一页", "page.count": "第 {page} / {total} 页",
    "detail.paths": "本地路径", "detail.metrics": "销量与评价", "detail.metadata": "作品资料",
    "cover.size": "封面尺寸", "cover.compact": "紧凑 72 × 54", "cover.standard": "标准 96 × 72",
    "cover.large": "清晰 120 × 90", "cover.hover": "悬停预览", "cover.unavailable": "封面无法加载",
    "cover.open": "查看封面：{title}",
    "common.chinese": "中文", "common.english": "English", "common.open": "打开", "common.addPath": "添加路径", "common.close": "关闭",
    "common.knownMissing": "{known} 已知 · {missing} 缺失", "common.works": "{count} 部", "common.year": "{year} 年",
    "app.title": "DLsite 音声整理工具", "app.emptySummary": "本地缓存中暂无作品", "nav.label": "页面导航", "nav.works": "作品列表", "nav.stats": "资料库概览",
    "export.current": "导出当前结果", "export.all": "导出全库", "field.library": "音声库目录", "field.libraryPlaceholder": "输入目录名称或路径",
    "field.pathHint": "输入至少 2 个字符可用 Everything 查找，候选不留历史。", "field.proxy": "代理", "field.proxyPlaceholder": "例如 http://127.0.0.1:7892",
    "action.fetchAfterScan": "扫描后抓取官网信息", "action.scan": "扫描目录", "action.fetch": "补抓官网信息", "action.forceMetrics": "强制刷新已有指标", "action.metrics": "刷新销量与评价",
    "job.preparing": "任务准备中", "job.progressLabel": "任务进度", "job.currentRj": "当前 RJ：{rj}", "job.waiting": "等待任务开始", "job.running": "任务进行中", "job.lastError": "最近错误：{detail}",
    "search.title": "作品检索", "search.help": "同类选项任一匹配，不同分类与关键词同时满足。", "search.clear": "清除全部条件", "search.keyword": "关键词", "search.keywordPlaceholder": "多个关键词用空格分隔",
    "search.status": "抓取状态", "search.allStatus": "全部状态", "search.sort": "排序", "search.newest": "发售日：最新优先", "search.ratingHigh": "平均评分：高到低", "search.ratingLow": "平均评分：低到高",
    "search.ratingCountHigh": "评价人数：多到少", "search.ratingCountLow": "评价人数：少到多", "search.advanced": "高级筛选", "search.pathContains": "本地路径包含", "search.pathPlaceholder": "输入完整路径或其中一部分",
    "table.rj": "RJ号", "table.localTitle": "本地标题", "table.officialTitle": "官网标题", "table.circle": "社团", "table.voiceActors": "声优", "table.releaseDate": "发售日", "table.tags": "标签",
    "table.sales": "总售出数", "table.average": "平均评分", "table.ratingCount": "评价人数", "table.paths": "路径", "table.status": "状态",
    "facet.circles": "社团", "facet.voice_actors": "声优", "facet.release_years": "发售年份", "facet.tags": "标签", "facet.search": "搜索{title}", "facet.selected": "已选 {count}", "facet.items": "{count} 项", "facet.empty": "没有匹配选项",
    "filter.keyword": "关键词：{value}", "filter.status": "状态：{value}", "filter.path": "路径：{value}", "filter.value": "{title}：{value}", "filter.sort": "排序：{value}", "filter.metric": "指标", "filter.current": "当前条件",
    "works.summary": "全库 {total} 个，当前结果 {matched} 个", "works.empty": "没有符合当前条件的作品，请调整筛选。", "works.noPath": "没有本地路径", "works.openPath": "点击进入作品目录", "works.pathUpdated": "本地路径已更新",
    "repair.empty": "暂无候选，可尝试标题关键词或手动输入。", "repair.title": "修复 {rj} 的本地路径", "repair.missing": "失效路径：{path}", "repair.locating": "正在按 RJ 定位候选目录…", "repair.searching": "正在搜索候选目录…",
    "repair.keyword": "补充关键词", "repair.keywordPlaceholder": "输入标题或目录片段，至少 2 个字符", "repair.search": "搜索目录", "repair.manual": "手动补充路径", "repair.manualPlaceholder": "选择的目录自身必须包含 {rj}",
    "repair.found": "找到 {count} 个候选，仅当前页面可见。", "repair.none": "没有找到候选，可补充关键词或手动输入。", "repair.fallback": "{message}。你仍可手动补充路径。",
    "path.none": "没有找到目录", "path.found": "找到 {count} 个临时候选", "path.manual": "没有找到目录，可继续手动输入", "path.selected": "已填入目录，点击扫描后才会读取文件夹。", "path.minimum": "至少输入 2 个字符才会查询，不保存搜索历史。", "path.error": "{message}，可继续手动输入。",
    "job.scanStarted": "扫描任务已启动", "job.fetchStarted": "补抓任务已启动", "job.metricsAllStarted": "全库指标刷新已启动", "job.metricsMissingStarted": "缺失指标刷新已启动", "job.startFailed": "任务启动失败", "job.missingId": "任务创建失败：缺少 job_id", "job.readFailed": "读取任务状态失败", "job.doneRefresh": "任务完成，列表已刷新", "job.failedRefresh": "任务失败，列表已刷新",
    "metric.refreshed": "指标刷新：{time}", "metric.error": "指标错误：{detail}", "error.worksRead": "读取作品列表失败", "error.session": "无法建立本地页面会话", "error.localPath": "本地路径操作失败", "error.statsRead": "读取统计失败", "error.statsSummary": "资料库统计读取失败", "error.unexpectedSummary": "操作失败", "error.details": "技术详情",
    "error.not_found": "请求的资源不存在", "error.invalid_json": "请求数据格式无效", "error.invalid_origin": "请求来源无效", "error.json_required": "请求必须使用 JSON", "error.session_expired": "页面会话已失效，请刷新页面", "error.path_query_type": "未知的路径查询类型", "error.query_too_short": "请至少输入 2 个字符", "error.invalid_rj": "RJ 号格式无效", "error.path_not_owned": "该路径不属于当前作品", "error.open_directory": "无法打开该目录", "error.candidate_expired": "候选已失效，请重新搜索", "error.candidate_missing": "候选目录已不存在", "error.path_invalid": "补充路径不存在或不是目录", "error.path_rj_mismatch": "目录自身名称不包含当前作品的同一 RJ 号", "error.work_missing": "作品不存在", "error.scan_path_required": "请输入要扫描的文件夹路径", "error.force_boolean": "force 必须是布尔值", "error.job_missing": "任务不存在", "error.invalid_sort_field": "排序字段无效", "error.invalid_sort_direction": "排序方向必须是 asc 或 desc", "error.sort_field_required": "指定排序方向前必须选择排序字段", "error.invalid_release_year": "发售年份必须是四位数字", "error.invalid_status": "抓取状态无效", "error.everything_busy": "Everything 搜索繁忙，请稍后重试", "error.everything_timeout": "Everything 查询超时，请稍后重试", "error.everything_unavailable": "Everything 查询暂时不可用", "error.unexpected": "操作失败",
    "status.未抓取": "未抓取", "status.成功": "成功", "status.部分成功": "部分成功", "status.失败": "失败",
    "stats.title": "资料库概览 · DLsite 音声整理工具", "stats.heading": "资料库概览", "stats.loading": "正在读取本地资料库…", "stats.releaseYear": "发售年份", "stats.allYears": "全部年份", "stats.localPath": "本地路径", "stats.pathPlaceholder": "输入月份或目录片段", "stats.apply": "应用筛选", "stats.clear": "清除",
    "stats.summaryLabel": "资料库摘要", "stats.glance": "一眼概括", "stats.insightHeading": "你的收藏呈现出这些特征", "stats.rankingLabel": "收藏偏好排行", "stats.note": "占比以当前筛选后的全部唯一 RJ 为分母；一部作品可包含多个标签或声优，因此占比之和可能超过 100%。",
    "stats.releaseDistribution": "发售年份分布", "stats.fetchStatus": "抓取状态", "stats.allSummary": "全库共 {total} 部唯一 RJ 作品", "stats.filteredSummary": "全库 {all} 部，当前筛选 {total} 部", "stats.currentWorks": "当前作品", "stats.fullLibrary": "全库 {count} 部",
    "stats.coverage.tags": "标签覆盖", "stats.coverage.voice_actors": "声优覆盖", "stats.coverage.circles": "社团覆盖", "stats.ranking": "{title}排行", "stats.allRanking": "查看完整排名（{count}）", "stats.emptyRanking": "当前范围没有可统计的{title}数据。",
    "stats.noYears": "当前范围没有可解析的发售年份。", "stats.yearTip": "{year} 年：{count} 部（{percentage}%）", "stats.noWorks": "当前范围没有作品。", "stats.statusRatio": "抓取状态比例",
    "stats.insight.empty": "当前筛选条件下没有作品，可以调整年份、状态或路径。", "stats.insight.total": "当前视图包含 {total} 部唯一 RJ 作品。", "stats.insight.top": "最高频{dimension}是“{name}”，覆盖 {count} 部作品。", "stats.insight.year": "作品发售年份最集中在 {year} 年，共 {count} 部。", "stats.insight.coverage": "{dimension}覆盖率最低，为 {percentage}%，尚有 {missing} 部缺失。",
    "dimension.tags": "标签", "dimension.voice_actors": "声优", "dimension.circles": "社团", "dimension.release_year": "发售年份",
    "job.stage.preparing": "准备中", "job.stage.scan": "扫描目录", "job.stage.write": "写入缓存", "job.stage.fetch": "抓取官网信息", "job.stage.done": "完成",
    "job.message.created": "任务已创建", "job.message.completed": "任务完成", "job.message.failed": "任务失败", "job.message.scanning": "正在扫描目录", "job.message.scan_found": "扫描到 {count} 个作品，正在写入缓存", "job.message.scan_complete": "本次扫描识别 {count} 个作品",
    "job.message.fetch_preparing": "准备抓取 {total} 个作品", "job.message.fetch_none": "没有需要抓取的作品", "job.message.fetching": "正在抓取 {rj}", "job.message.progress": "已完成 {completed}/{total}", "job.message.metrics_preparing": "准备刷新 {total} 个作品的销量与评价", "job.message.metrics_none": "没有缺失销量或评价指标的作品", "job.message.metrics_refreshing": "正在刷新 {rj} 的销量与评价",
  };
  const en = {
    "filter.more": "Show {count} more",
    "layout.resize": "Resize sidebar", "works.settings": "Settings", "works.loading": "Loading works…",
    "works.emptyLibrary": "The library is empty. Scan a folder to add works.", "works.retry": "Reload", "table.work": "Work",
    "table.rating": "Rating", "table.dataStatus": "Metadata status", "page.label": "Pagination",
    "page.prev": "Previous", "page.next": "Next", "page.count": "Page {page} of {total}",
    "detail.paths": "Local paths", "detail.metrics": "Sales and ratings", "detail.metadata": "Work details",
    "cover.size": "Cover size", "cover.compact": "Compact 72 × 54", "cover.standard": "Standard 96 × 72",
    "cover.large": "Large 120 × 90", "cover.hover": "Hover preview", "cover.unavailable": "Cover unavailable",
    "cover.open": "View cover: {title}",
    ...zh,
    "app.title": "DLsite Audio Library Tool", "app.emptySummary": "No works in the local cache", "nav.label": "Page navigation", "nav.works": "Works", "nav.stats": "Library Overview",
    "export.current": "Export Current Results", "export.all": "Export Full Library", "field.library": "Audio Library Folder", "field.libraryPlaceholder": "Enter a folder name or path", "field.pathHint": "Enter at least 2 characters to search with Everything. Suggestions are not saved.", "field.proxy": "Proxy", "field.proxyPlaceholder": "For example, http://127.0.0.1:7892",
    "action.fetchAfterScan": "Fetch official information after scanning", "action.scan": "Scan Directory", "action.fetch": "Fetch Missing Metadata", "action.forceMetrics": "Force refresh existing metrics", "action.metrics": "Refresh Sales and Ratings",
    "job.preparing": "Preparing task", "job.progressLabel": "Task progress", "job.currentRj": "Current RJ: {rj}", "job.waiting": "Waiting for the task to start", "job.running": "Task in progress", "job.lastError": "Latest error: {detail}",
    "search.title": "Work Search", "search.help": "Values within a category use OR; categories and keywords use AND.", "search.clear": "Clear All Filters", "search.keyword": "Keywords", "search.keywordPlaceholder": "Separate multiple keywords with spaces", "search.status": "Fetch Status", "search.allStatus": "All Statuses", "search.sort": "Sort", "search.newest": "Release Date: Newest First", "search.ratingHigh": "Average Rating: High to Low", "search.ratingLow": "Average Rating: Low to High", "search.ratingCountHigh": "Rating Count: High to Low", "search.ratingCountLow": "Rating Count: Low to High", "search.advanced": "Advanced Filters", "search.pathContains": "Local Path Contains", "search.pathPlaceholder": "Enter a full path or part of one",
    "table.rj": "RJ ID", "table.localTitle": "Local Title", "table.officialTitle": "Official Title", "table.circle": "Circle", "table.voiceActors": "Voice Actors", "table.releaseDate": "Release Date", "table.tags": "Tags", "table.sales": "Sales", "table.average": "Average Rating", "table.ratingCount": "Rating Count", "table.paths": "Paths", "table.status": "Status",
    "facet.circles": "Circles", "facet.voice_actors": "Voice Actors", "facet.release_years": "Release Years", "facet.tags": "Tags", "facet.search": "Search {title}", "facet.selected": "{count} selected", "facet.items": "{count} items", "facet.empty": "No matching options",
    "filter.keyword": "Keyword: {value}", "filter.status": "Status: {value}", "filter.path": "Path: {value}", "filter.value": "{title}: {value}", "filter.sort": "Sort: {value}", "filter.metric": "Metric", "filter.current": "Active Filters",
    "works.summary": "{total} works in library; {matched} results", "works.empty": "No works match the current filters.", "works.noPath": "No local paths", "works.openPath": "Open work folder", "works.pathUpdated": "Local paths updated",
    "repair.empty": "No candidates. Try title keywords or enter a path manually.", "repair.title": "Repair local paths for {rj}", "repair.missing": "Missing path: {path}", "repair.locating": "Locating candidate folders by RJ ID…", "repair.searching": "Searching for candidate folders…", "repair.keyword": "Additional keywords", "repair.keywordPlaceholder": "Enter at least 2 characters from the title or folder", "repair.search": "Search Folders", "repair.manual": "Manual path", "repair.manualPlaceholder": "The selected folder name must contain {rj}", "repair.found": "Found {count} candidates, visible only on this page.", "repair.none": "No candidates found. Add keywords or enter a path manually.", "repair.fallback": "{message}. You can still enter a path manually.",
    "path.none": "No folders found", "path.found": "Found {count} temporary candidates", "path.manual": "No folders found; you can continue with manual entry", "path.selected": "Folder selected. Select Scan Directory to read it.", "path.minimum": "Enter at least 2 characters. Search history is not saved.", "path.error": "{message}; you can continue with manual entry.",
    "job.scanStarted": "Scan task started", "job.fetchStarted": "Metadata task started", "job.metricsAllStarted": "Full metrics refresh started", "job.metricsMissingStarted": "Missing metrics refresh started", "job.startFailed": "Could not start task", "job.missingId": "Task creation failed: missing job_id", "job.readFailed": "Could not read task status", "job.doneRefresh": "Task completed; list refreshed", "job.failedRefresh": "Task failed; list refreshed",
    "metric.refreshed": "Metrics refreshed: {time}", "metric.error": "Metrics error: {detail}", "error.worksRead": "Could not load works", "error.session": "Could not create a local page session", "error.localPath": "Local path operation failed", "error.statsRead": "Could not load statistics", "error.statsSummary": "Could not load library statistics", "error.unexpectedSummary": "The operation failed", "error.details": "Technical details",
    "error.not_found": "The requested resource was not found", "error.invalid_json": "The request data is invalid", "error.invalid_origin": "The request origin is invalid", "error.json_required": "The request must use JSON", "error.session_expired": "The page session has expired; refresh the page", "error.path_query_type": "Unknown path query type", "error.query_too_short": "Enter at least 2 characters", "error.invalid_rj": "Invalid RJ ID", "error.path_not_owned": "This path does not belong to the current work", "error.open_directory": "Could not open the folder", "error.candidate_expired": "The candidate has expired; search again", "error.candidate_missing": "The candidate folder no longer exists", "error.path_invalid": "The additional path does not exist or is not a folder", "error.path_rj_mismatch": "The folder name does not contain the same RJ ID", "error.work_missing": "The work does not exist", "error.scan_path_required": "Enter a folder to scan", "error.force_boolean": "force must be a boolean", "error.job_missing": "The task does not exist", "error.invalid_sort_field": "Invalid sort field", "error.invalid_sort_direction": "Sort direction must be asc or desc", "error.sort_field_required": "Select a sort field before specifying a direction", "error.invalid_release_year": "Release year must contain four digits", "error.invalid_status": "Invalid fetch status", "error.everything_busy": "Everything search is busy; try again shortly", "error.everything_timeout": "Everything query timed out; try again", "error.everything_unavailable": "Everything search is temporarily unavailable", "error.unexpected": "The operation failed",
    "status.未抓取": "Not Fetched", "status.成功": "Success", "status.部分成功": "Partial Success", "status.失败": "Failed",
    "stats.title": "Library Overview · DLsite Audio Library Tool", "stats.heading": "Library Overview", "stats.loading": "Loading the local library…", "stats.releaseYear": "Release Year", "stats.allYears": "All Years", "stats.localPath": "Local Path", "stats.pathPlaceholder": "Enter a month or folder fragment", "stats.apply": "Apply Filters", "stats.clear": "Clear", "stats.summaryLabel": "Library summary", "stats.glance": "AT A GLANCE", "stats.insightHeading": "What your collection looks like", "stats.rankingLabel": "Collection preference rankings", "stats.note": "Percentages use all unique RJ works in the current result as the denominator. A work may have multiple tags or voice actors, so percentages may total more than 100%.", "stats.releaseDistribution": "Release Year Distribution", "stats.fetchStatus": "Fetch Status", "stats.allSummary": "{total} unique RJ works in the library", "stats.filteredSummary": "{all} works in library; {total} in current filter", "stats.currentWorks": "Current Works", "stats.fullLibrary": "{count} in full library", "stats.coverage.tags": "Tag Coverage", "stats.coverage.voice_actors": "Voice Actor Coverage", "stats.coverage.circles": "Circle Coverage", "stats.ranking": "{title} Ranking", "stats.allRanking": "View full ranking ({count})", "stats.emptyRanking": "No {title} data is available in the current range.", "stats.noYears": "No parseable release years in the current range.", "stats.yearTip": "{year}: {count} works ({percentage}%)", "stats.noWorks": "No works in the current range.", "stats.statusRatio": "Fetch status distribution",
    "stats.insight.empty": "No works match the current filters. Adjust the year, status, or path.", "stats.insight.total": "The current view contains {total} unique RJ works.", "stats.insight.top": "The most frequent {dimension} is “{name}”, covering {count} works.", "stats.insight.year": "Works are most concentrated in {year}, with {count} releases.", "stats.insight.coverage": "{dimension} has the lowest coverage at {percentage}%, with {missing} works missing data.", "dimension.tags": "tag", "dimension.voice_actors": "voice actor", "dimension.circles": "circle", "dimension.release_year": "release year",
    "job.stage.preparing": "Preparing", "job.stage.scan": "Scanning Directory", "job.stage.write": "Writing Cache", "job.stage.fetch": "Fetching Official Information", "job.stage.done": "Done", "job.message.created": "Task created", "job.message.completed": "Task completed", "job.message.failed": "Task failed", "job.message.scanning": "Scanning directory", "job.message.scan_found": "Found {count} works; writing cache", "job.message.scan_complete": "Scan identified {count} works", "job.message.fetch_preparing": "Preparing to fetch {total} works", "job.message.fetch_none": "No works need metadata", "job.message.fetching": "Fetching {rj}", "job.message.progress": "Completed {completed}/{total}", "job.message.metrics_preparing": "Preparing to refresh sales and ratings for {total} works", "job.message.metrics_none": "No sales or rating metrics are missing", "job.message.metrics_refreshing": "Refreshing sales and ratings for {rj}",
  };
  Object.assign(zh, {
    "stats.brand": "DLsite 音声库", "stats.subtitle": "当前收藏的规模、分布与资料完整度。", "stats.unit": "统计单位：唯一 RJ 作品", "stats.retry": "重新加载",
    "stats.workUnit": "部", "stats.entryUnit": "项", "stats.entries.circles": "社团条目", "stats.entries.voice_actors": "声优条目", "stats.entries.tags": "标签条目",
    "stats.releaseHint": "作品发行分布", "stats.yearAction": "点击柱形，筛选该年份", "stats.yearsKnown": "年份已知 {known} 部 · 缺失 {missing} 部",
    "stats.statusHint": "每部作品只属于一种状态", "stats.statusLink": "查看{status}的 {count} 部作品，占 {percentage}%", "stats.statusFoot": "成功 {percentage}% · 其余 {count} 部为部分成功、失败或未抓取；点击图例查看作品。", "stats.emptyStatus": "暂无作品，环图保留为空；没有可计算的状态占比。",
    "stats.completeness": "资料完整度", "stats.coverageHint": "按字段独立计算", "stats.known": "已知 {count}", "stats.missing": "缺失 {count}", "stats.coverageValue": "覆盖率 {percentage}%",
    "stats.emptyCoverage": "暂无作品，覆盖率显示 0%；已知与缺失均为 0。", "stats.fullCoverage": "四项字段均已覆盖当前作品。", "stats.lowCoverage": "{dimension}覆盖率最低：{percentage}%，{missing} 部尚无该字段；字段缺失不代表抓取失败。",
    "stats.rankCount": "{count} 项 · 按作品数", "stats.searchEmpty": "没有匹配项，请换个关键词。",
    "stats.emptyLibrary": "资料库还是空的", "stats.emptyLibraryHelp": "前往作品列表，扫描本地音声目录后即可查看收藏概览。", "stats.noMatch": "没有符合条件的作品", "stats.noMatchHelp": "试试清除筛选，或换一个年份、状态和路径片段。",
  });
  Object.assign(en, {
    "stats.brand": "DLsite Audio Library", "stats.subtitle": "Your collection's size, distribution, and metadata coverage.", "stats.unit": "Counted by unique RJ work", "stats.retry": "Reload",
    "stats.workUnit": "works", "stats.entryUnit": "entries", "stats.entries.circles": "Distinct Circles", "stats.entries.voice_actors": "Distinct Voice Actors", "stats.entries.tags": "Distinct Tags",
    "stats.releaseHint": "Release distribution", "stats.yearAction": "Select a bar to filter by year", "stats.yearsKnown": "Year known: {known} · Missing: {missing}",
    "stats.statusHint": "One status per work", "stats.statusLink": "View {count} works with status {status}, {percentage}%", "stats.statusFoot": "Success: {percentage}% · {count} other works are partial, failed, or unfetched. Select a status to view works.", "stats.emptyStatus": "No works; the ring is empty and no status share can be calculated.",
    "stats.completeness": "Metadata Coverage", "stats.coverageHint": "Each field counted separately", "stats.known": "Known: {count}", "stats.missing": "Missing: {count}", "stats.coverageValue": "Coverage: {percentage}%",
    "stats.emptyCoverage": "No works; coverage is 0%, with 0 known and 0 missing.", "stats.fullCoverage": "All four fields cover every work in this view.", "stats.lowCoverage": "Lowest coverage: {dimension}, {percentage}% ({missing} missing). Missing fields do not imply fetch failure.",
    "stats.rankCount": "{count} entries · By works", "stats.searchEmpty": "No matching entries. Try another search.",
    "stats.emptyLibrary": "Your library is empty", "stats.emptyLibraryHelp": "Go to the work list and scan a local audio folder to see your collection here.", "stats.noMatch": "No works match these filters", "stats.noMatchHelp": "Clear the filters, or try another year, status, or path fragment.",
  });
  const messages = { "zh-CN": zh, en };
  function detect(storage = window.localStorage, language = navigator.language) {
    let saved = "";
    try { saved = storage.getItem(STORAGE_KEY) || ""; } catch (_) { /* unavailable */ }
    if (SUPPORTED.has(saved)) return saved;
    return String(language || "").toLowerCase().startsWith("zh") ? "zh-CN" : "en";
  }
  let locale = detect();
  function format(template, params = {}) { return String(template).replace(/\{(\w+)\}/g, (_match, key) => params[key] ?? `{${key}}`); }
  function t(key, params = {}) { return format(messages[locale][key] ?? messages["zh-CN"][key] ?? key, params); }
  function apply(root = document) {
    document.documentElement.lang = locale;
    root.querySelectorAll("[data-i18n]").forEach((node) => { node.textContent = t(node.dataset.i18n); });
    root.querySelectorAll("[data-i18n-placeholder]").forEach((node) => { node.placeholder = t(node.dataset.i18nPlaceholder); });
    root.querySelectorAll("[data-i18n-aria]").forEach((node) => { node.setAttribute("aria-label", t(node.dataset.i18nAria)); });
    root.querySelectorAll("[data-locale]").forEach((node) => { node.setAttribute("aria-pressed", String(node.dataset.locale === locale)); });
  }
  function setLocale(next) {
    if (!SUPPORTED.has(next) || next === locale) return;
    locale = next;
    try { window.localStorage.setItem(STORAGE_KEY, locale); } catch (_) { /* unavailable */ }
    apply();
    window.dispatchEvent(new CustomEvent("localechange", { detail: { locale } }));
  }
  function bindSwitcher(root = document) { root.querySelectorAll("[data-locale]").forEach((node) => node.addEventListener("click", () => setLocale(node.dataset.locale))); apply(root); }
  window.I18n = { STORAGE_KEY, detect, t, apply, setLocale, bindSwitcher, get locale() { return locale; } };
})();
