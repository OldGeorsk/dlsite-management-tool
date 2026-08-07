from __future__ import annotations

import os
import socket
import subprocess
import sys
import time
import urllib.request
import webbrowser
from pathlib import Path


HOST = "127.0.0.1"
DEFAULT_PORT = 8765
MAX_PORT_TRIES = 20
SERVER_READY_TIMEOUT_SECONDS = 20
ROOT = Path(__file__).resolve().parent


def find_available_port(start_port: int = DEFAULT_PORT, max_tries: int = MAX_PORT_TRIES) -> int:
    for port in range(start_port, start_port + max_tries):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.settimeout(0.2)
            if sock.connect_ex((HOST, port)) != 0:
                return port
    raise RuntimeError(f"没有找到可用端口：{start_port}-{start_port + max_tries - 1}")


def wait_for_server(url: str, timeout_seconds: int = SERVER_READY_TIMEOUT_SECONDS) -> None:
    deadline = time.monotonic() + timeout_seconds
    last_error = ""
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=1) as response:
                if 200 <= response.status < 500:
                    return
        except Exception as exc:
            last_error = str(exc)
        time.sleep(0.4)
    raise RuntimeError(f"本地服务启动超时：{last_error}")


def start_server(port: int) -> subprocess.Popen[bytes]:
    env = os.environ.copy()
    env["DLSITE_TOOL_PORT"] = str(port)
    return subprocess.Popen(
        [sys.executable, str(ROOT / "server.py")],
        cwd=ROOT,
        env=env,
    )


def main() -> int:
    process: subprocess.Popen[bytes] | None = None
    try:
        port = find_available_port()
        url = f"http://{HOST}:{port}"
        print("DLsite 音声整理工具")
        print("=" * 40)
        print(f"正在启动本地服务：{url}")
        print("请保持这个窗口打开。关闭窗口或按 Ctrl+C 会停止服务。")
        print()

        process = start_server(port)
        wait_for_server(url)
        print(f"服务已启动：{url}")
        print("正在打开浏览器...")
        webbrowser.open(url)
        print()
        print("如果浏览器没有自动打开，请复制上面的地址到浏览器。")
        print("按 Ctrl+C 可退出。")

        process.wait()
        return process.returncode or 0
    except KeyboardInterrupt:
        print()
        print("正在停止本地服务...")
        return 0
    except Exception as exc:
        print()
        print(f"启动失败：{exc}")
        print("请检查 Python、依赖安装或端口占用情况。")
        return 1
    finally:
        if process and process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()


if __name__ == "__main__":
    raise SystemExit(main())
