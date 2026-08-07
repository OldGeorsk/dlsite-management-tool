$ErrorActionPreference = "Stop"

Set-Location -LiteralPath $PSScriptRoot

function Write-Title {
    Write-Host "DLsite Tool"
    Write-Host "========================================"
}

function Test-PythonCandidate {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Command,
        [string[]]$Arguments = @()
    )

    try {
        $versionArgs = @($Arguments) + @("-c", "import sys; raise SystemExit(0 if sys.version_info >= (3, 11) else 1)")
        & $Command @versionArgs *> $null
        if ($LASTEXITCODE -eq 0) {
            return [pscustomobject]@{
                Command = $Command
                Arguments = $Arguments
            }
        }
    } catch {
        Write-Host "Python check failed: $($_.Exception.Message)"
        return $null
    }
    return $null
}

function Find-Python {
    $commandCandidates = @(
        [pscustomobject]@{ Command = "py"; Arguments = @("-3") },
        [pscustomobject]@{ Command = "python"; Arguments = @() },
        [pscustomobject]@{ Command = "python3"; Arguments = @() }
    )

    foreach ($candidate in $commandCandidates) {
        $command = $candidate.Command
        $arguments = $candidate.Arguments
        Write-Host "Checking Python: $command $($arguments -join ' ')"
        if (Get-Command $command -ErrorAction SilentlyContinue) {
            $result = Test-PythonCandidate -Command $command -Arguments $arguments
            if ($result) {
                Write-Host "Found Python: $command $($arguments -join ' ')"
                return $result
            }
        }
    }

    $pathCandidates = @()
    foreach ($version in "314", "313", "312", "311") {
        if ($env:LOCALAPPDATA) {
            $pathCandidates += Join-Path $env:LOCALAPPDATA "Programs\Python\Python$version\python.exe"
        }
        if ($env:ProgramFiles) {
            $pathCandidates += Join-Path $env:ProgramFiles "Python$version\python.exe"
        }
        if (${env:ProgramFiles(x86)}) {
            $pathCandidates += Join-Path ${env:ProgramFiles(x86)} "Python$version\python.exe"
        }
    }

    foreach ($path in $pathCandidates) {
        Write-Host "Checking Python: $path"
        if (Test-Path -LiteralPath $path) {
            $result = Test-PythonCandidate -Command $path
            if ($result) {
                Write-Host "Found Python: $path"
                return $result
            }
        }
    }

    return $null
}

function Invoke-Python {
    param(
        [Parameter(Mandatory = $true)]
        [pscustomobject]$Python,
        [Parameter(Mandatory = $true)]
        [string[]]$Arguments
    )

    $pythonCommand = $Python.Command
    $pythonArguments = $Python.Arguments
    & $pythonCommand @pythonArguments @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Python command failed: $pythonCommand $($Arguments -join ' ')"
    }
}

Write-Title
Write-Host "Preparing local runtime..."
Write-Host ""

$python = Find-Python
if (-not $python) {
    Write-Host "Python 3.11 or newer was not found."
    Write-Host "Please install Python and enable Add python.exe to PATH."
    Write-Host "Download: https://www.python.org/downloads/windows/"
    exit 1
}

$venvPython = Join-Path $PSScriptRoot ".venv\Scripts\python.exe"
if (-not (Test-Path -LiteralPath $venvPython)) {
    Write-Host "First run: creating .venv..."
    Invoke-Python -Python $python -Arguments @("-m", "venv", ".venv")
}

Write-Host "Installing or checking dependencies..."
& $venvPython -m pip install --disable-pip-version-check -r requirements.txt
if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "Dependency installation failed. Please check your network and try again."
    exit 1
}

Write-Host ""
Write-Host "Runtime is ready. Starting DLsite Tool..."
Write-Host ""
& $venvPython launcher.py
exit $LASTEXITCODE
