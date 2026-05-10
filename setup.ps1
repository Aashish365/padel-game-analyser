#Requires -Version 5.1
# One-time setup for Padel Analytics
# Run from the project root:  .\setup.ps1
#
# If you see "running scripts is disabled", run this once in PowerShell as Admin:
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
$pyVer = python --version 2>&1
if ($LASTEXITCODE -ne 0) {
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

$cudaVersion = $null
$smiOut = nvidia-smi 2>&1
if ($LASTEXITCODE -eq 0) {
    $m = [regex]::Match($smiOut, 'CUDA Version:\s*([\d]+)\.([\d]+)')
    if ($m.Success) {
        $cudaVersion = $m.Groups[1].Value + "." + $m.Groups[2].Value
    }
}

if ($null -ne $cudaVersion) {
    $major = [int]($cudaVersion.Split('.')[0])
    $minor = [int]($cudaVersion.Split('.')[1])
    Write-Host "  Detected CUDA $cudaVersion - installing GPU torch..." -ForegroundColor Green
    if ($major -ge 12) {
        & $pythonExe -m pip install torch torchvision -q
    } elseif ($major -eq 11 -and $minor -ge 8) {
        & $pythonExe -m pip install torch torchvision --index-url https://download.pytorch.org/whl/cu118 -q
    } else {
        Write-Host "  CUDA $cudaVersion is older than 11.8 - installing CPU torch." -ForegroundColor Yellow
        & $pythonExe -m pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu -q
    }
} else {
    Write-Host "  No NVIDIA GPU found - installing CPU-only torch..." -ForegroundColor Yellow
    & $pythonExe -m pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu -q
}

$cudaOk = & $pythonExe -c 'import torch; print(torch.cuda.is_available())'
Write-Host "  CUDA available: $cudaOk" -ForegroundColor Green

# ── 4. Backend dependencies ───────────────────────────────────────
Write-Host "[4/5] Installing backend dependencies..." -ForegroundColor Yellow
& $pythonExe -m pip install -r (Join-Path $backendDir "requirements.txt") -q
Write-Host "  Done." -ForegroundColor Green

# ── 5. YOLO models (auto-download via Ultralytics) ───────────────
Write-Host "[5/5] Checking YOLO models..." -ForegroundColor Yellow

$detModel  = Join-Path $backendDir "yolo11n.pt"
$poseModel = Join-Path $backendDir "yolo11n-pose.pt"

if ((-Not (Test-Path $detModel)) -or (-Not (Test-Path $poseModel))) {
    Write-Host "  Downloading models from Ultralytics (one-time, ~12 MB each)..." -ForegroundColor Yellow

    $dlScript = Join-Path $backendDir "_dl_models.py"
    Set-Content -Path $dlScript -Encoding utf8 -Value @'
import pathlib
from ultralytics import YOLO

models = ["yolo11n.pt", "yolo11n-pose.pt"]
for name in models:
    dest = pathlib.Path(name)
    if dest.exists():
        print("  " + name + " already present.")
    else:
        print("  Downloading " + name + " ...")
        YOLO(name)
        print("  " + name + " saved.")
'@

    Push-Location $backendDir
    & $pythonExe $dlScript
    Pop-Location
    Remove-Item $dlScript -ErrorAction SilentlyContinue
} else {
    Write-Host "  Models already present, skipping." -ForegroundColor Green
}

# ── Node.js + frontend ────────────────────────────────────────────
Write-Host ""
Write-Host "Checking Node.js..." -ForegroundColor Yellow
$nodeVer = node --version 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "  ERROR: Node.js not found. Install LTS from https://nodejs.org" -ForegroundColor Red
    exit 1
}
Write-Host "  Found: $nodeVer" -ForegroundColor Green

Write-Host "Installing frontend dependencies..." -ForegroundColor Yellow
Push-Location (Join-Path $ROOT "frontend")
npm install
Pop-Location
Write-Host "  Done." -ForegroundColor Green

# ── Ensure uploads dir exists ─────────────────────────────────────
$uploadsDir = Join-Path $backendDir "uploads"
if (-Not (Test-Path $uploadsDir)) {
    New-Item -ItemType Directory -Path $uploadsDir | Out-Null
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  Setup complete!" -ForegroundColor Green
Write-Host "  Run .\start.ps1 to launch." -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
