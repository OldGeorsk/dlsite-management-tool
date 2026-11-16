from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path, PurePosixPath


ROOT = Path(__file__).resolve().parents[1]
SELF = "scripts/check_public_repo.py"
MAX_TEXT_FILE_BYTES = 2 * 1024 * 1024

FORBIDDEN_PATHS = {
    "AGENTS.md",
}
FORBIDDEN_PREFIXES = (
    ".venv/",
    "data/",
    "docs/dev/",
    "docs/DEVLOG/",
    "docs/PRD/",
    "exports/",
    "logs/",
    "reports/",
)
FORBIDDEN_SUFFIXES = (
    ".db",
    ".key",
    ".log",
    ".pem",
    ".sqlite",
    ".sqlite3",
    ".xls",
    ".xlsx",
)
ALLOWED_SAMPLE_RJS = {f"RJ{number:08d}" for number in range(1, 10)}

TEXT_RULES = (
    ("Windows 绝对路径", re.compile(r"(?i)\b[A-Z]:\\")),
    (
        "用户主目录路径",
        re.compile(
            r"(?i)(?:C:/Users/[^/\s'\"<>]+|"
            r"(?<![A-Za-z0-9:/])/(?:Users|home)/[^/\s'\"<>]+(?:/|\\))"
        ),
    ),
    (
        "带认证信息的 URL",
        re.compile(r"(?i)https?://[^\s/:@]+:[^\s/@]+@"),
    ),
    (
        "疑似私钥",
        re.compile(r"-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----"),
    ),
    ("疑似 OpenAI 密钥", re.compile(r"\bsk-[A-Za-z0-9_-]{16,}\b")),
    ("疑似 GitHub 令牌", re.compile(r"\bgh[pousr]_[A-Za-z0-9_]{20,}\b")),
    (
        "疑似硬编码凭据",
        re.compile(
            r"(?i)\b(?:api[_-]?key|client[_-]?secret|access[_-]?token|password|passwd)\b"
            r"\s*[:=]\s*['\"][^'\"]{6,}['\"]"
        ),
    ),
)
RJ_PATTERN = re.compile(r"\bRJ\d{6,9}\b", re.IGNORECASE)


def publishable_files() -> list[str]:
    result = subprocess.run(
        [
            "git",
            "-c",
            f"safe.directory={ROOT.as_posix()}",
            "ls-files",
            "--cached",
            "--others",
            "--exclude-standard",
            "-z",
        ],
        cwd=ROOT,
        check=True,
        capture_output=True,
    )
    return sorted(
        path.decode("utf-8", errors="surrogateescape").replace("\\", "/")
        for path in result.stdout.split(b"\0")
        if path
    )


def path_findings(path: str) -> list[str]:
    normalized = str(PurePosixPath(path))
    findings: list[str] = []
    if normalized in FORBIDDEN_PATHS:
        findings.append("内部文件不应公开")
    if normalized == "docs/dev-log-template.md":
        findings.append("内部开发日志模板不应公开")
    if normalized.startswith(FORBIDDEN_PREFIXES):
        findings.append("本地数据、输出或内部文档目录不应公开")
    if normalized.lower().endswith(FORBIDDEN_SUFFIXES):
        findings.append("本地数据、凭据或生成文件类型不应公开")
    if Path(normalized).name.startswith(".env") and normalized != ".env.example":
        findings.append("本地环境配置不应公开")
    return findings


def read_text(path: Path) -> tuple[str | None, str | None]:
    data = path.read_bytes()
    if len(data) > MAX_TEXT_FILE_BYTES:
        return None, "文件超过 2 MiB，需要人工检查"
    if b"\0" in data:
        return None, "二进制文件，需要人工确认是否应公开"
    try:
        return data.decode("utf-8"), None
    except UnicodeDecodeError:
        return None, "非 UTF-8 文件，需要人工检查"


def text_findings(path: str, text: str) -> list[str]:
    if path == SELF:
        return []
    findings = [label for label, pattern in TEXT_RULES if pattern.search(text)]
    unexpected_rjs = {
        match.group(0).upper()
        for match in RJ_PATTERN.finditer(text)
        if match.group(0).upper() not in ALLOWED_SAMPLE_RJS
    }
    if unexpected_rjs:
        findings.append("包含非占位 RJ 编号")
    return findings


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    findings: dict[str, list[str]] = {}
    try:
        candidates = publishable_files()
    except (OSError, subprocess.CalledProcessError) as exc:
        print(f"无法读取 Git 候选文件：{exc}", file=sys.stderr)
        return 2

    for relative in candidates:
        reasons = path_findings(relative)
        full_path = ROOT / relative
        if full_path.is_file() and not reasons:
            text, read_warning = read_text(full_path)
            if read_warning:
                reasons.append(read_warning)
            elif text is not None:
                reasons.extend(text_findings(relative, text))
        if reasons:
            findings[relative] = sorted(set(reasons))

    if findings:
        print("公开仓库隐私检查失败：")
        for path, reasons in findings.items():
            print(f"- {path}: {'；'.join(reasons)}")
        print("未输出任何匹配内容，请人工打开上述文件检查。")
        return 1

    print(f"公开仓库隐私检查通过：已检查 {len(candidates)} 个 Git 候选文件。")
    print("提交前仍需运行 git diff --cached 进行人工复核。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
