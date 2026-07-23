<#
  start_local.ps1 — Bật toàn bộ stack Tirapro trên máy local.

  Trình tự:
    1) Docker: Postgres (pgvector) + Redis  (docker compose up -d)
    2) Chờ Postgres healthy
    3) Build package dùng chung (@tirapro/types, @tirapro/shared)
    4) (tuỳ chọn -Fresh) migrate + seed làm mới DB
    5) Chạy app: API (:4000) + Web (:5173) song song qua turbo  (Ctrl+C để dừng app)

  Yêu cầu: đã chạy `pnpm install` (hoặc `pnpm setup`) ít nhất một lần để có node_modules
  + Prisma client. Nếu đổi schema Prisma: chạy `pnpm db:generate` thủ công rồi mới start.

  Cách dùng:
    powershell -ExecutionPolicy Bypass -File .\start_local.ps1
    .\start_local.ps1 -Fresh        # migrate + seed lại dữ liệu demo trước khi chạy
    .\start_local.ps1 -NoApp        # chỉ bật Docker + chuẩn bị, không chạy app
    .\start_local.ps1 -Tools        # bật thêm Adminer (UI xem DB) ở :8080
    .\start_local.ps1 -NoBrowser     # không tự mở trình duyệt
    .\start_local.ps1 -KeepServices  # khi thoát vẫn GIỮ Docker chạy (mặc định: tắt hết)
  Hoặc bấm đúp start_local.cmd
  Mặc định: tự mở http://localhost:5173 khi web sẵn sàng; Ctrl+C/đóng → tắt app + Docker.
#>
[CmdletBinding()]
param(
  [switch]$Fresh,
  [switch]$NoApp,
  [switch]$Tools,
  [switch]$NoBrowser,
  [switch]$KeepServices
)

$ErrorActionPreference = 'Stop'
Set-Location -Path $PSScriptRoot
# Hiển thị tiếng Việt/emoji đúng trên console (PowerShell 5.1 mặc định ANSI).
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}

function Info($m) { Write-Host "`n▶ $m" -ForegroundColor Cyan }
function Ok($m)   { Write-Host "  ✓ $m" -ForegroundColor Green }
function Warn($m) { Write-Host "  ! $m" -ForegroundColor Yellow }

# Dọn dẹp khi thoát: kill app trên 4000/5173 rồi stop Docker.
function Stop-AllServices {
  Info "Đang tắt dịch vụ (app + Docker)…"
  foreach ($port in @(4000, 5173)) {
    $owners = (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue).OwningProcess | Select-Object -Unique
    foreach ($procId in $owners) { try { Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue } catch { } }
  }
  try { docker compose stop 2>$null | Out-Null } catch { }
  Ok "Đã tắt API/Web + dịch vụ Docker (Postgres/Redis)."
}

# Nạp biến môi trường từ .env gốc (cho seed/prisma khi -Fresh; vô hại với phần còn lại).
function Import-DotEnv([string]$path) {
  if (-not (Test-Path $path)) { return }
  foreach ($raw in Get-Content $path) {
    $line = $raw.Trim()
    if ($line -eq '' -or $line.StartsWith('#')) { continue }
    $idx = $line.IndexOf('=')
    if ($idx -lt 1) { continue }
    $key = $line.Substring(0, $idx).Trim()
    $val = $line.Substring($idx + 1).Trim()
    if ($val.Length -ge 2) {
      $q = $val.Substring(0, 1)
      if (($q -eq '"' -or $q -eq "'") -and $val.Substring($val.Length - 1, 1) -eq $q) {
        $val = $val.Substring(1, $val.Length - 2)
      }
    }
    Set-Item -Path ("Env:" + $key) -Value $val
  }
}

# 0) Kiểm tra công cụ
foreach ($tool in @('docker', 'pnpm')) {
  if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
    throw "Không tìm thấy '$tool' trong PATH. Cài đặt rồi chạy lại."
  }
}
Import-DotEnv (Join-Path $PSScriptRoot '.env')

# 1) Docker: Postgres + Redis (+ Adminer nếu -Tools)
Info "Khởi động dịch vụ Docker (Postgres + Redis)…"
if ($Tools) { docker compose --profile tools up -d | Out-Host }
else        { docker compose up -d postgres redis | Out-Host }
if ($LASTEXITCODE -ne 0) { throw "docker compose up thất bại. Docker Desktop đã chạy chưa?" }

# 2) Chờ Postgres healthy (tối đa ~60s)
Info "Chờ Postgres sẵn sàng…"
$health = ''
$deadline = (Get-Date).AddSeconds(60)
while ((Get-Date) -lt $deadline) {
  $health = (docker inspect -f '{{.State.Health.Status}}' projira-postgres 2>$null)
  if ($null -ne $health) { $health = $health.Trim() }
  if ($health -eq 'healthy') { break }
  Start-Sleep -Seconds 2
}
if ($health -eq 'healthy') { Ok "Postgres healthy." } else { Warn "Postgres chưa healthy sau 60s (status=$health) — vẫn tiếp tục." }
$rh = (docker inspect -f '{{.State.Health.Status}}' projira-redis 2>$null)
if ($null -ne $rh) { Ok ("Redis: " + $rh.Trim()) }

# 3) Build package dùng chung (API/Web phụ thuộc dist của @tirapro/types + @tirapro/shared)
Info "Build @tirapro/types + @tirapro/shared…"
pnpm --filter @tirapro/types build | Out-Host
if ($LASTEXITCODE -ne 0) { throw "Build @tirapro/types thất bại." }
pnpm --filter @tirapro/shared build | Out-Host
if ($LASTEXITCODE -ne 0) { throw "Build @tirapro/shared thất bại." }

# 4) (tuỳ chọn) làm mới DB
if ($Fresh) {
  Info "Migrate (deploy) + seed lại dữ liệu demo…"
  pnpm --filter @tirapro/api db:migrate:deploy | Out-Host
  pnpm --filter @tirapro/api db:seed | Out-Host
  Ok "Đã migrate + seed."
}

if ($NoApp) {
  Ok "Dịch vụ hạ tầng đã sẵn sàng (bỏ qua app theo -NoApp)."
  Write-Host "  Chạy app khi cần: pnpm dev" -ForegroundColor DarkGray
  exit 0
}

# 4b) Giải phóng cổng app nếu còn tiến trình cũ giữ
#     (Vite chạy --strictPort → sẽ lỗi "Port 5173 is already in use" nếu cổng bận).
Info "Giải phóng cổng 4000/5173 (nếu còn tiến trình cũ)…"
foreach ($port in @(4000, 5173)) {
  $owners = (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue).OwningProcess | Select-Object -Unique
  foreach ($procId in $owners) {
    try {
      Stop-Process -Id $procId -Force -ErrorAction Stop
      Ok ("Đã dừng tiến trình cũ trên :{0} (PID {1})" -f $port, $procId)
    } catch { }
  }
}
Start-Sleep -Milliseconds 500

# 4c) Tự mở trình duyệt vào Web khi cổng 5173 sẵn sàng (job nền, không chặn pnpm dev).
if (-not $NoBrowser) {
  $null = Start-Job -ScriptBlock {
    for ($i = 0; $i -lt 90; $i++) {
      Start-Sleep -Seconds 1
      if (Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue) {
        Start-Sleep -Milliseconds 800  # chờ Vite phục vụ trang xong
        Start-Process 'http://localhost:5173'
        break
      }
    }
  }
  Ok "Sẽ tự mở http://localhost:5173 khi web sẵn sàng."
}

# 5) Chạy app (foreground). Khi thoát (Ctrl+C / app dừng) → finally tắt luôn dịch vụ.
Info "Khởi động app (API + Web)…"
Write-Host "  API    : http://localhost:4000/api/v1" -ForegroundColor DarkGray
Write-Host "  Swagger: http://localhost:4000/api/docs" -ForegroundColor DarkGray
Write-Host "  Web    : http://localhost:5173" -ForegroundColor DarkGray
if ($Tools) { Write-Host "  Adminer: http://localhost:8080" -ForegroundColor DarkGray }
if ($KeepServices) {
  Write-Host "  (Ctrl+C để dừng app — Docker vẫn chạy theo -KeepServices)`n" -ForegroundColor DarkGray
} else {
  Write-Host "  (Ctrl+C để dừng — sẽ tắt LUÔN app + Postgres + Redis)`n" -ForegroundColor DarkGray
}
try {
  pnpm dev
} finally {
  if (-not $KeepServices) { Stop-AllServices }
}
