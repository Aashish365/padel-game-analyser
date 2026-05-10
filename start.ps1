#Requires -Version 5.1
# Start Padel Game Analyser (backend + frontend)
# Run from the project root:  .\start.ps1

$ROOT        = Split-Path -Parent $MyInvocation.MyCommand.Path
$pythonExe   = Join-Path $ROOT "venv\Scripts\python.exe"
$backendDir  = Join-Path $ROOT "backend"
$frontendDir = Join-Path $ROOT "frontend"

if (-Not (Test-Path $pythonExe)) {
    Write-Host "ERROR: venv not found. Run .\setup.ps1 first." -ForegroundColor Red
    exit 1
}

if (-Not (Test-Path (Join-Path $frontendDir "node_modules"))) {
    Write-Host "ERROR: node_modules not found. Run .\setup.ps1 first." -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Padel Game Analyser" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Backend  -> http://localhost:8000" -ForegroundColor Green
Write-Host "  Frontend -> http://localhost:5173" -ForegroundColor Green
Write-Host ""

# ── Backend ───────────────────────────────────────────────────────
$backendCmd = "& `"$pythonExe`" -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload"
$backendScript = @"
`$host.UI.RawUI.WindowTitle = 'Padel Backend'
Set-Location '$backendDir'
Write-Host '[Backend] Starting on http://localhost:8000 ...' -ForegroundColor Cyan
$backendCmd
"@

Start-Process powershell -ArgumentList "-NoExit -ExecutionPolicy Bypass -Command $backendScript"

Start-Sleep -Seconds 3

# ── Frontend ──────────────────────────────────────────────────────
$frontendScript = @"
`$host.UI.RawUI.WindowTitle = 'Padel Frontend'
Set-Location '$frontendDir'
Write-Host '[Frontend] Starting on http://localhost:5173 ...' -ForegroundColor Cyan
npm run dev
"@

Start-Process powershell -ArgumentList "-NoExit -ExecutionPolicy Bypass -Command $frontendScript"

Write-Host "Both servers launched in separate windows." -ForegroundColor Green
Write-Host "Open http://localhost:5173 in your browser." -ForegroundColor Yellow
Write-Host ""
