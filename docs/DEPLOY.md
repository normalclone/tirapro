# Triển khai Tirapro (deploy)

Tirapro là **full-stack**: API (NestJS) + PostgreSQL *có pgvector* + Redis + Web (React/Vite tĩnh).
Mọi phương án đều cần **tài khoản hosting của bạn** — tài liệu này hướng dẫn từng bước.

> Tài khoản demo sau khi seed: `admin@projira.dev` / `Password123` (+ `ba@ / dev@ / tester@tirapro.dev`).

---

## Phương án A — Render Blueprint (khuyến nghị, deploy thẳng từ Git)

Repo đã có sẵn [`render.yaml`](../render.yaml) mô tả 4 thành phần: Postgres, Redis, API, Web.

1. Vào **Render Dashboard → New → Blueprint**, chọn repo `tirapro`, bấm **Apply**.
   Render sẽ tạo: `tirapro-db` (Postgres 16), `tirapro-redis`, `tirapro-api`, `tirapro-web`.
2. Deploy lần đầu **API sẽ báo chờ biến `CORS_ORIGIN`** và **Web chờ `VITE_API_URL`/`VITE_WS_URL`** (đánh dấu `sync: false`). Sau khi Render cấp URL, điền chéo:
   - `tirapro-api` → `CORS_ORIGIN = https://tirapro-web.onrender.com`
   - `tirapro-web` → `VITE_API_URL = https://tirapro-api.onrender.com/api/v1`
   - `tirapro-web` → `VITE_WS_URL = https://tirapro-api.onrender.com`
   Rồi **Manual Deploy** lại cả hai (web phải build lại để nhúng URL API).
3. `preDeployCommand` của API tự chạy: `prisma migrate deploy` → `db:raw` (tạo extension `vector`/`pg_trgm`) → `db:seed` (nạp demo).
   - ⚠️ `db:seed` **làm mới demo về trạng thái chuẩn mỗi lần deploy**. Muốn giữ dữ liệu người dùng nhập thì bỏ `&& ... db:seed` khỏi `preDeployCommand` trong `render.yaml` (chỉ seed 1 lần thủ công qua **Shell** của service: `pnpm --filter @tirapro/api run db:seed`).
4. (Tùy chọn) Bật AI thật: thêm biến `ANTHROPIC_API_KEY` cho `tirapro-api`. Bỏ trống → chạy heuristic.

**Lưu ý gói Free:** web/API free **spin-down khi idle** (cold start ~1 phút); Postgres free **hết hạn ~30 ngày**. Demo lâu dài nên nâng plan.

---

## Phương án B — VPS (Docker cho hạ tầng, Node cho app)

Hợp khi bạn có sẵn 1 server (Ubuntu…). `docker-compose.yml` đã có Postgres(pgvector)+Redis.

```bash
git clone https://github.com/normalclone/tirapro.git && cd tirapro
cp .env.example .env            # sửa secret JWT, CORS_ORIGIN = domain web, DATABASE_URL/REDIS_URL
corepack enable && pnpm install
docker compose up -d postgres redis          # hạ tầng
pnpm --filter @tirapro/shared build
pnpm --filter @tirapro/api exec prisma generate
pnpm --filter @tirapro/api build
pnpm --filter @tirapro/api exec prisma migrate deploy
pnpm --filter @tirapro/api run db:raw         # extension pgvector + FTS
pnpm --filter @tirapro/api run db:seed        # dữ liệu demo (1 lần)
# API: chạy nền bằng pm2/systemd
VITE_API_URL=https://api.your-domain/api/v1 VITE_WS_URL=https://api.your-domain \
  pnpm --filter @tirapro/web build            # → apps/web/dist (phục vụ qua Nginx/Caddy)
node apps/api/dist/main.js                     # nên bọc pm2: pm2 start apps/api/dist/main.js --name tirapro-api
```
Dựng reverse proxy (Nginx/Caddy): `/api` + WebSocket → API `:4000`; còn lại → `apps/web/dist` (SPA fallback về `index.html`).

---

## Phương án C — Railway (tương tự Render)

Tạo project từ repo, thêm plugin **PostgreSQL** + **Redis**, tạo 2 service (API dùng root repo, Web static).
Build/Start/env giống cột trong `render.yaml`. Đặt `DATABASE_URL/DIRECT_URL/REDIS_URL` từ plugin, `PORT` Railway tự cấp (app đã đọc `$PORT`).

---

## Biến môi trường chính

| Biến | Cho | Ghi chú |
|---|---|---|
| `DATABASE_URL`, `DIRECT_URL` | API | Postgres (pgvector). DIRECT_URL cho migrate. |
| `REDIS_URL` | API | realtime/cache; thiếu vẫn chạy REST (degrade). |
| `PORT` | API | PaaS tự cấp; local dùng `API_PORT` (4000). |
| `CORS_ORIGIN` | API | = URL web (phân tách bằng dấu phẩy nếu nhiều). |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | API | ≥32 ký tự; Render `generateValue` tự sinh. |
| `ANTHROPIC_API_KEY` | API | (tùy chọn) bật AI thật. |
| `EMBEDDING_PROVIDER` | API | `none` → tìm kiếm dùng full-text. |
| `VITE_API_URL` | Web | `https://<api>/api/v1` (nhúng lúc build). |
| `VITE_WS_URL` | Web | `https://<api>` (WebSocket). |

Chi tiết đầy đủ: [`.env.example`](../.env.example).
