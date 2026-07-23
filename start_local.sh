#!/usr/bin/env bash
# start_local.sh — Bật toàn bộ stack Tirapro trên máy local (bản Git Bash/WSL).
#   1) Docker: Postgres + Redis   2) Chờ Postgres healthy
#   3) Build @tirapro/types + @tirapro/shared
#   4) (--fresh) migrate + seed   5) pnpm dev (API :4000 + Web :5173)
# Yêu cầu: đã `pnpm install` (hoặc `pnpm setup`) >=1 lần. Đổi schema Prisma → `pnpm db:generate` trước.
#
# Dùng:  ./start_local.sh                 # bật dịch vụ + chạy app + tự mở trình duyệt
#        ./start_local.sh --fresh         # migrate + seed lại dữ liệu demo trước
#        ./start_local.sh --no-app        # chỉ bật hạ tầng, không chạy app
#        ./start_local.sh --tools         # bật thêm Adminer (:8080)
#        ./start_local.sh --no-browser    # không tự mở trình duyệt
#        ./start_local.sh --keep-services # khi thoát vẫn giữ Docker (mặc định: tắt hết)
# Mặc định: Ctrl+C / đóng terminal -> tắt LUÔN app + Postgres + Redis.
set -euo pipefail
cd "$(dirname "$0")"

FRESH=0; NO_APP=0; TOOLS=0; NO_BROWSER=0; KEEP=0
for arg in "$@"; do
  case "$arg" in
    --fresh) FRESH=1 ;;
    --no-app) NO_APP=1 ;;
    --tools) TOOLS=1 ;;
    --no-browser) NO_BROWSER=1 ;;
    --keep-services) KEEP=1 ;;   # khi thoát vẫn giữ Docker chạy (mặc định: tắt hết)
    *) echo "Cờ không rõ: $arg" >&2; exit 2 ;;
  esac
done

info(){ printf '\n\033[36m▶ %s\033[0m\n' "$1"; }
ok(){ printf '\033[32m  ✓ %s\033[0m\n' "$1"; }
warn(){ printf '\033[33m  ! %s\033[0m\n' "$1"; }

for tool in docker pnpm; do
  command -v "$tool" >/dev/null 2>&1 || { echo "Không tìm thấy '$tool' trong PATH." >&2; exit 1; }
done

# 1) Docker
info "Khởi động dịch vụ Docker (Postgres + Redis)…"
if [ "$TOOLS" = 1 ]; then docker compose --profile tools up -d; else docker compose up -d postgres redis; fi

# 2) Chờ Postgres healthy (~60s)
info "Chờ Postgres sẵn sàng…"
health=""
for _ in $(seq 1 30); do
  health="$(docker inspect -f '{{.State.Health.Status}}' projira-postgres 2>/dev/null || echo none)"
  [ "$health" = healthy ] && break
  sleep 2
done
if [ "$health" = healthy ]; then ok "Postgres healthy."; else warn "Postgres chưa healthy sau 60s (status=$health) — vẫn tiếp tục."; fi
ok "Redis: $(docker inspect -f '{{.State.Health.Status}}' projira-redis 2>/dev/null || echo '?')"

# 3) Build package dùng chung + Prisma client
info "Build @tirapro/types + @tirapro/shared…"
pnpm --filter @tirapro/types build
pnpm --filter @tirapro/shared build

# 4) (tuỳ chọn) làm mới DB — cần DATABASE_URL + DIRECT_URL từ .env
if [ "$FRESH" = 1 ]; then
  info "Migrate (deploy) + seed lại dữ liệu demo…"
  export DATABASE_URL="$(grep -E '^DATABASE_URL=' .env | head -1 | cut -d= -f2- | sed 's/^"//; s/"$//')"
  export DIRECT_URL="$(grep -E '^DIRECT_URL=' .env | head -1 | cut -d= -f2- | sed 's/^"//; s/"$//')"
  [ -n "${DIRECT_URL:-}" ] || export DIRECT_URL="$DATABASE_URL"
  pnpm --filter @tirapro/api db:migrate:deploy
  pnpm --filter @tirapro/api db:seed
  ok "Đã migrate + seed."
fi

if [ "$NO_APP" = 1 ]; then
  ok "Dịch vụ hạ tầng đã sẵn sàng (bỏ qua app theo --no-app). Chạy app: pnpm dev"
  exit 0
fi

# 4b) Giải phóng cổng app nếu còn tiến trình cũ (Vite --strictPort sẽ lỗi nếu :5173 bận).
info "Giải phóng cổng 4000/5173 (nếu còn tiến trình cũ)…"
free_port() {
  local port="$1"
  if command -v lsof >/dev/null 2>&1; then            # Linux / WSL / macOS
    local pids; pids="$(lsof -ti:"$port" 2>/dev/null || true)"
    [ -n "$pids" ] && kill -9 $pids 2>/dev/null && ok "Đã dừng tiến trình cũ trên :$port" || true
  else                                                  # Git Bash trên Windows
    for p in $(netstat -ano 2>/dev/null | grep -E "LISTENING" | grep -E ":$port[[:space:]]" | awk '{print $NF}' | sort -u); do
      taskkill //PID "$p" //F >/dev/null 2>&1 && ok "Đã dừng tiến trình cũ trên :$port (PID $p)" || true
    done
  fi
}
free_port 4000
free_port 5173
sleep 1

# 4c) Tự mở trình duyệt khi web sẵn sàng (chạy nền, không chặn pnpm dev).
if [ "$NO_BROWSER" != 1 ]; then
  ( for _ in $(seq 1 90); do
      if curl -s -o /dev/null --max-time 2 http://localhost:5173 2>/dev/null; then
        if command -v xdg-open >/dev/null 2>&1; then xdg-open http://localhost:5173 >/dev/null 2>&1
        elif command -v open >/dev/null 2>&1; then open http://localhost:5173 >/dev/null 2>&1
        else powershell.exe -NoProfile -Command "Start-Process 'http://localhost:5173'" >/dev/null 2>&1; fi
        break
      fi
      sleep 1
    done ) &
  ok "Sẽ tự mở http://localhost:5173 khi web sẵn sàng."
fi

# 5) Chạy app. Khi thoát (Ctrl+C / đóng terminal) → trap EXIT tắt luôn dịch vụ.
#    KHÔNG dùng `exec` để trap còn chạy được.
cleanup() {
  [ "$KEEP" = 1 ] && exit 0
  echo
  info "Đang tắt dịch vụ (app + Docker)…"
  free_port 4000; free_port 5173
  docker compose stop >/dev/null 2>&1 || true
  ok "Đã tắt API/Web + dịch vụ Docker (Postgres/Redis)."
}
trap cleanup EXIT

info "Khởi động app (API + Web)…"
echo "  API : http://localhost:4000/api/v1"
echo "  Web : http://localhost:5173"
[ "$TOOLS" = 1 ] && echo "  Adminer: http://localhost:8080"
if [ "$KEEP" = 1 ]; then echo "  (Ctrl+C để dừng app — Docker vẫn chạy theo --keep-services)"
else echo "  (Ctrl+C để dừng — sẽ tắt LUÔN app + Postgres + Redis)"; fi
pnpm dev
