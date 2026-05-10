#Requires -Version 5.1
# One-time setup for Padel Analytics
# Run from the project root:  .\setup.ps1
#
# If you see "running scripts is disabled", run this first (once):
#   Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser

$ErrorActionPreference = "Stop"
$ROOT       = Split-Path -Parent $MyInvocation.MyCommand.Path
$pythonExe  = Join-Path $ROOT "venv\Scripts\python.exe"
$backendDir = Join-Path $ROOT "backend"

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Padel Analytics - Setup" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# ── 1. Python ─────────────────────────────────────────────────────
Write-Host "[1/5] Checking Python..." -ForegroundColor Yellow
try {
    $pyVer = python --version 2>&1
    if ($LASTEXITCODE -ne 0) { throw }
} catch {
    Write-Host "  ERROR: Python not found. Install Python 3.10+ from https://python.org" -ForegroundColor Red
    Write-Host "  Make sure to check 'Add Python to PATH' during installation." -ForegroundColor Red
    exit 1
}
Write-Host "  Found: $pyVer" -ForegroundColor Green

# ── 2. Virtual environment ────────────────────────────────────────
Write-Host "[2/5] Setting up virtual environment..." -ForegroundColor Yellow
if (-Not (Test-Path $pythonExe)) {
    python -m venv (Join-Path $ROOT "venv")
    Write-Host "  Created venv." -ForegroundColor Green
} else {
    Write-Host "  venv already exists, skipping." -ForegroundColor Green
}
& $pythonExe -m pip install --upgrade pip -q

# ── 3. PyTorch ────────────────────────────────────────────────────
Write-Host "[3/5] Installing PyTorch..." -ForegroundColor Yellow

# Detect CUDA version from nvidia-smi
$cudaVersion = $null
try {
    $smi = & nvidia-smi 2>&1
    if ($LASTEXITCODE -eq 0) {
        $match = [regex]::Match($smi, 'CUDA Version:\s*([\d\.]+)')
        if ($match.Success) { $cudaVersion = $match.Groups[1].Value }
    }
} catch {}

if ($cudaVersion) {
    $major = [int]($cudaVersion.Split('.')[0])
    $minor = [int]($cudaVersion.Split('.')[1])
    Write-Host "  Detected CUDA $cudaVersion — installing GPU torch..." -ForegroundColor Green

    if ($major -ge 12) {
        # CUDA 12.x — default PyPI wheel covers this
        & $pythonExe -m pip install torch torchvision -q
    } elseif ($major -eq 11 -and $minor -ge 8) {
        & $pythonExe -m pip install torch torchvision --index-url https://download.pytorch.org/whl/cu118 -q
    } else {
        Write-Host "  CUDA $cudaVersion is older than 11.8. Falling back to CPU torch." -ForegroundColor Yellow
        & $pythonExe -m pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu -q
    }
} else {
    Write-Host "  No NVIDIA GPU detected — installing CPU-only torch..." -ForegroundColor Yellow
    & $pythonExe -m pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu -q
}

$cudaOk = & $pythonExe -c "import torch; print(torch.cuda.is_available())"
Write-Host "  CUDA available: $cudaOk" -ForegroundColor Green

# ── 4. Backend dependencies ───────────────────────────────────────
Write-Host "[4/5] Installing backend dependencies..." -ForegroundColor Yellow
& $pythonExe -m pip install -r (Join-Path $backendDir "requirements.txt") -q
Write-Host "  Done." -ForegroundColor Green

# ── 5. YOLO models ────────────────────────────────────────────────
Write-Host "[5/5] Checking YOLO models..." -ForegroundColor Yellow
$detModel  = Join-Path $backendDir "yolo11n.pt"
$poseModel = Join-Path $backendDir "yolo11n-pose.pt"

if (-Not (Test-Path $detModel) -or -Not (Test-Path $poseModel)) {
    Write-Host "  Downloading models (this may take a few minutes)..." -ForegroundColor Yellow

    # Run from backend/ so Ultralytics downloads directly there
    Push-Location $backendDir
    & $pythonExe -c @"
import pathlib
from ultralytics import YOLO

for name in ['yolo11n.pt', 'yolo11n-pose.pt']:
    dest = pathlib.Path(name)
    if dest.exists():
        print(f'  {name} already present.')
    else:
        print(f'  Downloading {name}...')
        YOLO(name)
        print(f'  {name} saved to backend/')
"@
    Pop-Location
} else {
    Write-Host "  Models already present, skipping." -ForegroundColor Green
}

# ── Node.js + frontend ────────────────────────────────────────────
Write-Host ""
Write-Host "Checking Node.js..." -ForegroundColor Yellow
try {
    $nodeVer = node --version 2>&1
    if ($LASTEXITCODE -ne 0) { throw }
} catch {
    Write-Host "  ERROR: Node.js not found. Install LTS from https://nodejs.org" -ForegroundColor Red
    exit 1
}
Write-Host "  Found: $nodeVer" -ForegroundColor Green

Write-Host "Installing frontend dependencies..." -ForegroundColor Yellow
Push-Location (Join-Path $ROOT "frontend")
npm install
Pop-Location
Write-Host "  Done." -ForegroundColor Green

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  Setup complete!" -ForegroundColor Green
Write-Host "  Run .\start.ps1 to launch." -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
