# Everything SDK third-party files

This directory contains the minimal runtime and API-reference subset retained
from the official Everything SDK.

## Provenance

- Publisher: voidtools / David Carpenter
- Official SDK archive: https://www.voidtools.com/Everything-SDK.zip
- Official SDK documentation: https://www.voidtools.com/support/everything/sdk/
- Official license page: https://www.voidtools.com/License.txt
- Downloaded and reviewed: 2026-08-12
- SDK API version: `2` (`EVERYTHING_SDK_VERSION` in `include/Everything.h`)

The downloaded SDK archive did not contain a standalone license file. The
adjacent `LICENSE.txt` transcribes the license published at the official
license URL above on the review date, with whitespace normalized.

## Retained files

The application will select the DLL that matches the architecture of the
running Python interpreter. The header is retained as the authoritative local
reference for constants and function signatures used by the future `ctypes`
binding.

| File | Purpose | SHA-256 |
| --- | --- | --- |
| `dll/Everything32.dll` | 32-bit x86 Windows runtime | `C28CD066AF36CAE4403A9933847AFF01DB928787D86751F014A1FA60D8B97FDA` |
| `dll/Everything64.dll` | 64-bit x86-64 Windows runtime | `C7AB8B47F7DD4C41AA735F4BA40B35AD5460A86FA7ABE0C94383F12BCE33BFB6` |
| `dll/EverythingARM.dll` | 32-bit ARM Windows runtime | `11620A496539BC63C62985CDF0079B757F7988CF3CBDF465CD97940A081700A3` |
| `dll/EverythingARM64.dll` | 64-bit ARM Windows runtime | `8531EA393677DD8FD37BED7420AC93344CD458B9A1324BA65C4A75D024D61886` |
| `include/Everything.h` | SDK API declarations and constants | `09CBE00C0E2B024CE49EC098BACFC4272F1D998F334E19E1D427AA8357D3AF78` |

The examples, import libraries, SDK implementation source, raw IPC header and
legacy Visual Studio projects were omitted because they are not required at
runtime and can be restored from the official archive.
