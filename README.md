# DLsite Tool

**English** | [简体中文](README.zh-CN.md)

A local web application for organizing DLsite audio collections. It scans work folders containing RJ product IDs, retrieves metadata from Japanese DLsite product pages, and provides search, filtering, library statistics, and Excel export.

The application runs locally. Your collection records and scan results remain on your computer, with no account or cloud service required.

## Features

- Recursively scan local directories for work folders whose names contain `RJ` followed by 6–9 digits.
- Use the local Everything index to suggest library roots, open work folders, and locate replacements for outdated paths by RJ ID.
- Merge duplicate RJ IDs into one work record while retaining all known local paths.
- Retrieve official titles, circles, voice actors, release dates, tags, cover URLs, and other metadata from Japanese DLsite pages.
- Refresh sales counts, average ratings, and rating counts without allowing one failed work to stop the entire batch.
- Search across the library with multiple keywords and combine filters for circles, voice actors, release years, and tags.
- Sort by average rating or rating count and view live result counts for each filter option.
- Export the current filtered results or the complete library, including the latest metrics, as an `.xlsx` workbook.

## Quick Start

### Windows one-click launcher (recommended)

Requirements:

- Windows 10 or Windows 11
- Python 3.11 or later. Select `Add python.exe to PATH` when installing Python.

To start the application:

1. Download or clone this repository to a local folder.
2. Double-click `启动 DLsite 工具.bat` in the repository root.
3. On the first launch, the script creates a `.venv` virtual environment and installs the packages listed in `requirements.txt`.
4. Once the server is ready, the application opens automatically in your browser.

Keep the terminal window open while using the application. Closing it or pressing `Ctrl+C` stops the local server.

### Developer setup

Run the following commands from the repository root:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe server.py
```

Then open:

```text
http://127.0.0.1:8765
```

Running `server.py` directly uses port 8765 by default. The Windows launcher starts at that port and automatically selects another available port when necessary.

## Usage

The interface supports English and Simplified Chinese without any additional setup. On the first visit it follows the browser language (Chinese browsers use Chinese; all others use English). Use the **中文 / English** switch in the page header to change languages; the choice is remembered locally for both pages. Excel sheet names, headers, and status labels follow the active interface language.

1. Enter the root directory of your audio library in the web interface.
2. Select **Scan Directory** to find RJ work folders.
3. To retrieve DLsite metadata, enable **Fetch Official Information After Scanning**, or run the metadata fetch separately after scanning.
4. Enter keywords under **Work Search**, or combine the circle, voice actor, release year, and tag filters. Multiple values within one category use OR logic; different categories use AND logic.
5. Sort by average rating or rating count, or open **Library Overview** to view statistics.
6. Select **Export Current Results** to preserve the current filters and order, or **Export Full Library** to export every work.

### Recommended folder structure

Store each work in a separate folder. The recommended naming convention is `RJ ID + space + local title`:

```text
Audio Library/
├─ RJ00000001 Work Title/
│  ├─ Audio/
│  └─ Illustrations/
└─ RJ00000002 Another Work/
```

Detection is intentionally flexible. A folder is recognized when its name contains `RJ` followed by 6–9 digits, case-insensitively. All of the following names are valid:

```text
RJ00000001 Work Title
Work Title [RJ00000001]
rj00000001_Work_Title
```

Text other than the RJ ID is used as the local title.

The scanner searches recursively. Once a directory is recognized as a work root, nested folders such as `Audio`, `Bonus`, or `Images` are not treated as separate works. Put the RJ ID in the outermost folder for each work, and avoid placing RJ IDs in category folders. If the same RJ ID exists in multiple locations, the application merges it into one work record and retains every path.

After at least two characters are entered in the path field, Everything can suggest up to 20 directories. Selecting a suggestion only fills the field; you must still select **Scan Directory**. Saved paths in the work list can be opened directly. When an old path no longer exists, the application can suggest alternatives by RJ ID, search using additional title keywords, or accept a manually entered path. A new path is saved only after you explicitly select **Add Path** and the directory name contains the same RJ ID. Existing paths are never removed automatically.

### Proxy configuration

The proxy field is currently prefilled with `http://127.0.0.1:7892`. Use it only if a matching local proxy service is running. Otherwise, clear the field to try a direct connection or replace it with your own HTTP proxy address.

## Advanced Operations

- Select **Refresh Sales and Ratings** to fill missing sales counts, average ratings, and rating counts.
- Enable **Force Refresh Existing Metrics** before refreshing to update metrics that are already present. This task runs sequentially and can take time for a large library.
- Scanning, metadata retrieval, and metric refresh operations display progress in the interface. Only one background job runs at a time.
- **Library Overview** supports combined filters for year, fetch status, and local path, with drill-down links from rankings to the work list.
- Separate search terms with spaces. Every term must match, although terms may appear across different fields such as titles, RJ IDs, circles, voice actors, tags, or paths.
- Counts displayed in the four filter panels show how many works match under the other active conditions. Selected filters appear as removable chips, and the page URL preserves the complete search state.
- Sorting by average rating or rating count places unknown values last. Without a metric sort, works are ordered by release date, newest first.
- Unknown metrics are displayed as `—`. Hover over the value to see the last refresh time or failure reason.

## Data Safety and Privacy

- Directory scanning is read-only. The application does not rename, move, delete, or modify audio files.
- Everything queries use only the existing local index. The application does not enable Everything's HTTP Server or upload disk contents. Query text, candidate paths, and access tokens are not written to URLs, SQLite, browser storage, or log files; candidates exist only in the current page and short-lived server memory.
- The SQLite database, runtime logs, and exported Excel files are stored locally within the project directory.
- Scanning and statistics are computed entirely on your computer. Network requests are sent only when retrieving metadata or refreshing metrics from DLsite.
- A failed RJ fetch records a readable error and does not stop later works from being processed.
- Only the latest successfully retrieved dynamic metrics are stored. Historical snapshots and trends are not retained, and a failed refresh does not erase the last successful values.
- This project is not affiliated with DLsite. Changes to DLsite pages, endpoints, or access rules may temporarily break metadata retrieval.
- Use the retrieval features responsibly and in accordance with applicable laws, DLsite's terms, and your network environment. Avoid excessive requests.

## Everything Integration

- Requires Windows and a running standard edition of Everything with IPC support. Everything Lite does not support the required SDK/IPC interface.
- The application selects the x86, x64, ARM, or ARM64 DLL from `vendor/everything-sdk/dll/` according to the Python runtime architecture.
- The official SDK connects only to the default unnamed Everything instance. Named instances are not supported. If Everything 1.4 and 1.5 are installed side by side, make sure the instance you want to query is the default unnamed instance.
- If Everything is unavailable, its index is not ready, the SDK is incompatible, or a query is busy or times out, the interface displays a readable message and keeps manual path entry available. The application does not start Everything automatically or fall back to a full-disk traversal.
- SDK queries run in a dedicated local worker process. A query that exceeds one second terminates and recreates the worker so it cannot block the web server. The warm-query target is a P95 latency below 400 ms from the last keystroke to suggestion display.

## Troubleshooting

### The launcher does not start correctly

Confirm that Python 3.11 or later is installed and available on `PATH`. You can also open PowerShell in the repository directory and run `.\start-dlsite-tool.ps1` to view the error details.

### The browser does not open automatically

Keep the terminal window open and copy the displayed `http://127.0.0.1:port` address into your browser.

### DLsite information cannot be retrieved

Check your network connection and proxy settings. If no proxy service is listening at `127.0.0.1:7892`, clear the proxy field to try a direct connection or enter a working HTTP proxy. Failure details appear in the task progress or work record.

### Where is my data stored?

- SQLite database: `data/dlsite_tool.sqlite3`
- Excel export: `exports/dlsite_works.xlsx`
- Runtime logs: `logs/`

These directories contain information about your local library and should not be uploaded or shared without review.

## Technology Stack

- Python 3.11+
- Python standard library: `ThreadingHTTPServer`, `urllib`, and `threading`
- SQLite
- `openpyxl`
- Vanilla HTML, CSS, JavaScript, and SVG

## Project Status

This project is primarily designed for personal, local use. It currently supports directory scanning, metadata retrieval, metric refreshes, work filtering, library statistics, and Excel export, and may continue to evolve around practical collection-management needs.
