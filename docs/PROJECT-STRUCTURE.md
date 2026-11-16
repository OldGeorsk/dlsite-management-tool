# 项目目录索引 / Project structure

本索引用于定位源码、入口、测试和本地数据。使用说明见 [中文 README](../README.zh-CN.md) / [English README](../README.md)。所有命令均在项目根目录执行。

## 目录职责

| 路径 | 主要职责 | Git 边界 |
| --- | --- | --- |
| `README.md`、`README.zh-CN.md` | 双语使用说明和导航 | 跟踪 |
| `.gitignore`、`.gitattributes` | 本地文件排除、第三方文件属性 | 跟踪 |
| `requirements.txt` | 运行依赖，目前为 openpyxl | 跟踪 |
| `启动 DLsite 工具.bat` | Windows 双击启动入口 | 跟踪 |
| `start-dlsite-tool.ps1` | 检查 Python、准备虚拟环境和依赖 | 跟踪 |
| `launcher.py` | 选择端口、启动服务、等待就绪、打开浏览器 | 跟踪 |
| `server.py` | HTTP 路由、应用组装、后台任务调用 | 跟踪 |
| `dlsite_tool/` | Python 业务包 | 跟踪源码 |
| `static/` | HTML、CSS、原生 JavaScript；直接提供给浏览器，无构建步骤 | 跟踪 |
| `scripts/` | 按需运行的维护脚本 | 跟踪源码 |
| `tests/` | Python 自动化测试与 Node.js 双语界面测试 | 跟踪源码 |
| `vendor/everything-sdk/` | 官方 SDK DLL、头文件、来源与许可证 | 跟踪；保留完整配套文件 |
| `docs/PROJECT-STRUCTURE.md` | 本目录索引 | 跟踪 |
| `docs/PRD/v{N}/` | 新阶段需求，文件为 `prd-v{N}.md` | 忽略，不进入公开提交 |
| `docs/DEVLOG/v{N}/` | 同版本开发记录，文件为 `dev-log-v{N}.md` | 忽略，不进入公开提交 |
| `docs/DEVLOG/dev/` | 保留原位的历史日志、运行记录与 v1 基线 | 忽略，不进入公开提交 |
| `AGENTS.md` | 本地 agent 工作约束与文档导航 | 忽略，不进入公开提交 |
| `data/` | 用户 SQLite 数据库及历史备份 | 忽略 |
| `exports/` | 用户导出的 Excel | 忽略 |
| `logs/` | 本地运行日志（如由运行方式重定向生成） | 忽略 |
| `reports/` | 运维脚本生成的历史 HTML 报告 | 忽略 |
| `.venv/` | 本地 Python 虚拟环境 | 忽略 |
| `__pycache__/`、`.pytest_cache/` | 可再生的 Python 与测试缓存，可出现于子目录 | 忽略 |
| `.git/` | 本地版本历史与回退点 | Git 自身管理 |

`docs/PRD/` 当前为空，下一新阶段开始时再按版本创建文档；Git 不保存空目录，程序也不依赖它。旧内部文档路径 `docs/dev/` 继续保留忽略与公开检查规则。

## 业务包定位

| 模块 | 职责 |
| --- | --- |
| `dlsite_tool/scanner.py` | RJ 识别与只读目录扫描 |
| `dlsite_tool/scraper.py` | DLsite 页面访问、元数据和动态指标解析 |
| `dlsite_tool/models.py` | 作品模型和内部状态 |
| `dlsite_tool/db.py` | SQLite 结构、合并、路径保留和指标更新 |
| `dlsite_tool/stats.py` | 检索、分面、稳定排序与统计 |
| `dlsite_tool/exporter.py` | Excel 导出与双语表头 |
| `dlsite_tool/jobs.py` | 进程内后台任务与进度管理 |
| `dlsite_tool/everything.py` | Everything SDK 定位、架构选择和查询 |
| `dlsite_tool/everything_worker.py` | Everything 查询子进程、超时与生命周期 |
| `dlsite_tool/local_access.py` | 本地路径操作令牌、候选与匿名耗时缓冲 |

## 稳定入口与位置依赖

Windows 启动链：

```text
启动 DLsite 工具.bat
  -> start-dlsite-tool.ps1
  -> .venv/Scripts/python.exe launcher.py
  -> server.py
  -> dlsite_tool/ + static/
```

- `.bat` 和 PowerShell 脚本将工作目录设为项目根目录。
- `launcher.py` 按自身位置调用根目录 `server.py`，并传递 `DLSITE_TOOL_PORT`。
- `server.py` 按自身位置查找 `static/`、`data/dlsite_tool.sqlite3` 和 `exports/`。
- `dlsite_tool/everything.py` 按包的位置查找根目录 `vendor/everything-sdk/dll/`，不能把 DLL 当作构建产物清理。
- `Store()` 的默认数据库路径与增量抓取脚本的默认 `--db` 都相对当前工作目录；维护命令应在根目录执行。
- 测试会导入根目录 `server`，前端测试也从根目录读取 `static/`。移动入口或资源时必须同步检查这些引用。

开发者启动：

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe server.py
```

直接运行服务默认访问 `http://127.0.0.1:8765`。也可执行 `.\.venv\Scripts\python.exe launcher.py`，由启动器选择可用端口并打开浏览器。

## 维护脚本

```powershell
.\.venv\Scripts\python.exe -B -m scripts.check_public_repo
.\.venv\Scripts\python.exe -B -m scripts.run_incremental_crawl --help
```

使用 `-m scripts.run_incremental_crawl`，使 Python 从根目录正确导入业务包；不要直接执行 `python scripts/run_incremental_crawl.py`。

增量抓取脚本接收 `root`、`--db`、`--report`、`--proxy` 等参数。`--help` 仅显示说明；正式执行会扫描指定目录、写入数据库、创建运行前备份并生成报告，只应在用户明确要求数据维护时运行。其批次停止策略独立于网页后台任务。

公开仓库检查扫描已跟踪及未忽略的候选文件，同时检查路径和文本；即便内部记录被强制加入 Git，也应报告。官方 DLL 会继续提示二进制文件需人工复核，应依据 [SDK 来源与哈希](../vendor/everything-sdk/SOURCE.md) 和相邻许可证核对；该提示不能直接等同于检查全部通过。

## 测试与验证

pytest 是开发测试工具，不属于运行依赖；Node.js 仅用于 JavaScript 检查和测试，运行应用无需 Node.js。

```powershell
.\.venv\Scripts\python.exe -m pip install pytest
.\.venv\Scripts\python.exe -B -m pytest -q -p no:cacheprovider
node tests/test_i18n.js
Get-ChildItem static/*.js,tests/*.js | ForEach-Object { node --check $_.FullName }
```

Python 测试使用临时目录、临时数据库和替身请求；运行维护脚本不属于测试步骤。代码修改后还需执行对应语言的语法检查；涉及启动链调整时，应验证端口选择、页面资源及进程退出。

## 用户数据与生成物

- 当前数据库：`data/dlsite_tool.sqlite3`；历史备份：`data/*.before-*.sqlite3`。数据库与备份都不是可再生缓存。
- 网页 Excel 导出：`exports/dlsite_works.xlsx`，后续导出会复用该文件名；需要保留的版本应由用户另行保存。
- 运维 HTML 报告：位置由脚本 `--report` 指定，通常放入 `reports/`。旧报告包含历史状态，不能用当前库无损重建。
- 日志位于 `logs/` 时同样只留本地；现有启动器不自动向此处重定向输出。
- `.env`、`.env.*`（示例文件除外）、私钥、数据库、Excel 和日志文件也受忽略规则保护。

目录整理和生成物清理分开执行。保留已有备份、报告和用户导出；不要把缓存清理扩展为删除 `.venv/`、SDK 或用户数据。

## 本地开发文档与 Git 回退

以下路径为本地内部资料，公开克隆不包含这些文件：

- `AGENTS.md`：开发约束、阶段确认和主题文档索引。
- `docs/PRD/v{N}/prd-v{N}.md`：新阶段需求，记录背景、目标、范围、非目标和验收标准，不超过 150 行。
- `docs/DEVLOG/v{N}/dev-log-v{N}.md`：同版本开发记录，引用 PRD，记录任务、实际变更、验证与结论。
- `docs/DEVLOG/dev/dev-log-v{N}.md`：保留原位的历史阶段日志。
- `docs/DEVLOG/dev/dev-log-ops.md`：真实资料库运行和数据维护记录。
- `docs/DEVLOG/dev/v1/`：v1 PRD、路线图与开发日志，是历史基线，不是待办。

PRD 与 DEVLOG 共用一个 `vN` 阶段编号，取全部现有阶段的最高编号加一，不独立计数。新规则从下一开发阶段开始；普通文案维护不创建新阶段，同阶段修复更新同版本文档。

保留历史文件名与路径，不因采用新规则而重命名、覆盖或迁入其他归档目录。`docs/PRD/`、`docs/DEVLOG/` 整体作为内部文档排除，公开目录索引继续跟踪。内部文档不会随源码提交形成 Git 回退点，需要保留本地副本。源码修改与目录维护分别提交，提交前按文件检查暂存区，不把用户数据或内部记录纳入提交。
