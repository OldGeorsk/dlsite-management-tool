from __future__ import annotations

import ctypes
import os
import platform
import re
import struct
from pathlib import Path
from typing import Protocol

from .scanner import extract_rj


ROOT = Path(__file__).resolve().parent.parent
SDK_DLLS = ROOT / "vendor" / "everything-sdk" / "dll"
MAX_RESULTS = 20
SDK_RESULT_WINDOW = 200

ERROR_MESSAGES = {
    1: "Everything SDK 内存不足",
    2: "Everything 未运行或当前版本不支持 IPC",
    3: "Everything SDK 无法注册查询窗口",
    4: "Everything SDK 无法创建查询窗口",
    5: "Everything SDK 无法创建查询线程",
    6: "Everything 返回了无效结果",
    7: "Everything SDK 调用顺序无效",
    8: "Everything 没有返回请求的数据",
    9: "Everything SDK 参数无效",
}


class EverythingError(RuntimeError):
    pass


class SearchBackend(Protocol):
    def search(self, text: str, mode: str = "keyword") -> list[str]: ...


def dll_name_for_runtime(*, system: str | None = None, machine: str | None = None,
                         pointer_bits: int | None = None) -> str:
    system = system or platform.system()
    machine = (machine or platform.machine()).lower()
    pointer_bits = pointer_bits or struct.calcsize("P") * 8
    if system != "Windows":
        raise EverythingError("Everything 联动仅支持 Windows，仍可手动输入路径")
    if machine in {"amd64", "x86_64"}:
        return "Everything64.dll" if pointer_bits == 64 else "Everything32.dll"
    if machine in {"x86", "i386", "i686"}:
        return "Everything32.dll"
    if machine in {"arm64", "aarch64"}:
        return "EverythingARM64.dll" if pointer_bits == 64 else "EverythingARM.dll"
    if machine.startswith("arm"):
        return "EverythingARM.dll"
    raise EverythingError(f"当前 Windows 架构不受 Everything SDK 支持：{machine}")


def literal_terms(text: str) -> list[str]:
    return [term for term in re.split(r"\s+", text.strip()) if term]


def sdk_literal_query(text: str) -> str:
    # Quoting keeps Everything operators inert. Results are filtered again in
    # Python, so the SDK query is only a bounded candidate generator.
    terms = " ".join(f'"{term.replace(chr(34), chr(34) * 2)}"' for term in literal_terms(text))
    return f"folder: {terms}" if terms else ""


def _natural_key(value: str) -> list[object]:
    return [int(part) if part.isdigit() else part.casefold() for part in re.split(r"(\d+)", value)]


def filter_keyword_paths(paths: list[str], text: str, limit: int = MAX_RESULTS) -> list[str]:
    terms = [term.casefold() for term in literal_terms(text)]
    if not terms:
        return []
    unique = {str(Path(path)) for path in paths if all(term in str(path).casefold() for term in terms)}
    return sorted(
        unique,
        key=lambda path: (
            0 if all(term in Path(path).name.casefold() for term in terms) else 1,
            _natural_key(path),
        ),
    )[:limit]


def filter_rj_paths(paths: list[str], rj: str, limit: int = MAX_RESULTS) -> list[str]:
    expected = rj.upper()
    candidates = {
        str(Path(path))
        for path in paths
        if extract_rj(Path(path).name) == expected
    }
    highest: list[str] = []
    for candidate in sorted(candidates, key=lambda path: (len(Path(path).parts), _natural_key(path))):
        current = Path(candidate)
        if any(_is_descendant(current, Path(parent)) for parent in highest):
            continue
        highest.append(candidate)
    return highest[:limit]


def _is_descendant(path: Path, parent: Path) -> bool:
    try:
        path.relative_to(parent)
        return path != parent
    except ValueError:
        return False


class EverythingSDK:
    def __init__(self, dll_dir: Path = SDK_DLLS, instance_name: str | None = None) -> None:
        dll_name = dll_name_for_runtime()
        dll_path = dll_dir / dll_name
        if not dll_path.is_file():
            raise EverythingError(f"缺少匹配当前 Python 架构的 Everything SDK：{dll_name}")
        try:
            self.dll = ctypes.WinDLL(str(dll_path))
        except OSError as exc:
            raise EverythingError("Everything SDK 加载失败，请检查 DLL 与 Python 架构") from exc
        self._configure_signatures()
        self.instance_name = instance_name if instance_name is not None else os.environ.get("EVERYTHING_INSTANCE_NAME", "")
        if self.instance_name:
            raise EverythingError("当前 Everything SDK 不支持命名实例，请使用默认实例或手动输入路径")

    def _configure_signatures(self) -> None:
        d = self.dll
        d.Everything_SetSearchW.argtypes = [ctypes.c_wchar_p]
        d.Everything_SetMatchPath.argtypes = [ctypes.c_int]
        d.Everything_SetMatchCase.argtypes = [ctypes.c_int]
        d.Everything_SetRegex.argtypes = [ctypes.c_int]
        d.Everything_SetMax.argtypes = [ctypes.c_uint32]
        d.Everything_SetRequestFlags.argtypes = [ctypes.c_uint32]
        d.Everything_QueryW.argtypes = [ctypes.c_int]
        d.Everything_QueryW.restype = ctypes.c_int
        d.Everything_GetLastError.restype = ctypes.c_uint32
        d.Everything_GetNumResults.restype = ctypes.c_uint32
        d.Everything_IsFolderResult.argtypes = [ctypes.c_uint32]
        d.Everything_IsFolderResult.restype = ctypes.c_int
        d.Everything_GetResultFullPathNameW.argtypes = [ctypes.c_uint32, ctypes.c_wchar_p, ctypes.c_uint32]
        d.Everything_GetResultFullPathNameW.restype = ctypes.c_uint32
        d.Everything_IsDBLoaded.restype = ctypes.c_int
        d.Everything_Reset.restype = None

    def search(self, text: str, mode: str = "keyword") -> list[str]:
        query = f'folder: "{text}"' if mode == "rj" else sdk_literal_query(text)
        if not query:
            return []
        d = self.dll
        d.Everything_Reset()
        if not d.Everything_IsDBLoaded():
            raise EverythingError("Everything 索引尚未就绪")
        d.Everything_SetSearchW(query)
        d.Everything_SetMatchPath(1)
        d.Everything_SetMatchCase(0)
        d.Everything_SetRegex(0)
        d.Everything_SetMax(SDK_RESULT_WINDOW)
        d.Everything_SetRequestFlags(0x00000004)
        if not d.Everything_QueryW(1):
            code = int(d.Everything_GetLastError())
            raise EverythingError(ERROR_MESSAGES.get(code, f"Everything 查询失败（错误 {code}）"))
        paths: list[str] = []
        for index in range(int(d.Everything_GetNumResults())):
            if not d.Everything_IsFolderResult(index):
                continue
            size = int(d.Everything_GetResultFullPathNameW(index, None, 0)) + 1
            buffer = ctypes.create_unicode_buffer(max(size, 2))
            d.Everything_GetResultFullPathNameW(index, buffer, len(buffer))
            paths.append(buffer.value)
        return paths


def perform_search(mode: str, query: str, backend: SearchBackend | None = None) -> list[str]:
    backend = backend or EverythingSDK()
    raw = backend.search(query, mode)
    if mode == "rj":
        return filter_rj_paths(raw, query)
    if mode == "keyword":
        return filter_keyword_paths(raw, query)
    raise EverythingError("未知的 Everything 查询类型")
