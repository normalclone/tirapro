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
3. Khi API khởi động, `startCommand` tự chạy (đều idempotent): `prisma migrate deploy` → `db:raw` (tạo extension `vector`/`pg_trgm`) → `db:seed:init` (chỉ nạp demo **khi DB còn rỗng**) → chạy server.
   - Free tier **không hỗ trợ `preDeployCommand`** nên gộp vào `startCommand`. Seed **không** reset dữ liệu ở các lần cold-start sau (chỉ chạy lần boot đầu, lúc chưa có workspace).
   - Muốn **reset demo về trạng thái chuẩn**: xoá dữ liệu rồi restart, hoặc chạy `pnpm --filter @tirapro/api run db:seed` (gói có Shell/paid).
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
| `INTEGRATION_ENCRYPTION_KEY` | API | Khoá mã hoá token tích hợp (≥32 ký tự, khác mặc định ở production). Render `generateValue` tự sinh. |
| `INTEGRATION_ENCRYPTION_KEY_PREVIOUS` | API | (tùy chọn) khoá CŨ — để vẫn giải mã token đã mã hoá trước khi đổi khoá. Xem mục dưới. |
| `VITE_API_URL` | Web | `https://<api>/api/v1` (nhúng lúc build). |
| `VITE_WS_URL` | Web | `https://<api>` (WebSocket). |

Chi tiết đầy đủ: [`.env.example`](../.env.example).

## Nâng cấp / đổi khoá mã hoá tích hợp (Telegram BYO token)

Token bot Telegram của từng workspace được mã hoá bằng `INTEGRATION_ENCRYPTION_KEY`. Ở production API không cho dùng
khoá mặc định, nên nếu trước đây hệ thống chạy bằng khoá mặc định (hoặc bạn đổi sang khoá mới) thì token cũ sẽ **không giải được**:
API ghi log lỗi, trả "không có token" (không dùng ciphertext làm token) và tích hợp đó ngừng gửi tin.

Cách xử lý (chọn một):
1. **Giữ khoá cũ làm khoá dự phòng** — đặt khoá cũ vào `INTEGRATION_ENCRYPTION_KEY_PREVIOUS` (khoá mặc định cũ là
   `dev_integration_encryption_key_change_me_0001`), khoá mới vào `INTEGRATION_ENCRYPTION_KEY`, rồi khởi động lại API.
   Token cũ giải mã bằng khoá dự phòng; token mới luôn mã hoá bằng khoá mới.
2. **Mã hoá lại một lần** rồi bỏ khoá dự phòng: giữ cả hai biến như trên, chạy
   `pnpm --filter @tirapro/api run integrations:rekey -- --dry-run` để xem trước, rồi chạy không có `--dry-run`.
   Sau đó có thể xoá `INTEGRATION_ENCRYPTION_KEY_PREVIOUS`.
3. Không còn khoá cũ → nhập lại token bot trong Cài đặt → Tích hợp.

`integrations:rekey` cũng mã hoá lại khoá bí mật của webhook automation (`enc:v1:…`) cùng một lần chạy. Nếu đổi
`INTEGRATION_ENCRYPTION_KEY` mà không rekey (hoặc không giữ khoá cũ trong `…_PREVIOUS`), webhook có khoá bí mật sẽ báo lỗi
"Khoá bí mật của webhook không giải mã được" thay vì gửi thiếu chữ ký — nhập lại khoá trong quy tắc để khắc phục.

### Mã hoá khoá bí mật webhook automation (sau khi nâng cấp)

Khoá bí mật ký HMAC của webhook trong Automation giờ được lưu mã hoá (`enc:v1:…`, cùng khoá `INTEGRATION_ENCRYPTION_KEY`)
và API chỉ trả `********`. Quy tắc tạo trước bản nâng cấp vẫn còn khoá dạng chữ thường (vẫn gửi được); mã hoá nốt bằng
script một lần, **idempotent** (chạy lại không mã hoá hai lần, chỉ bỏ qua khoá đã mã hoá):

```bash
pnpm --filter @tirapro/api run automation:seal-secrets -- --dry-run   # xem trước: bao nhiêu khoá sẽ được mã hoá
pnpm --filter @tirapro/api run automation:seal-secrets                # ghi vào DB
```

Cần `DATABASE_URL` và `INTEGRATION_ENCRYPTION_KEY` (đúng giá trị API đang dùng) trong môi trường. Script không đổi schema,
không cần `prisma migrate`. Nếu in "bỏ qua (xung đột)" (có người đang sửa quy tắc) thì chạy lại. Client bên thứ ba từng đọc
`actions[].secret` qua API sẽ không còn lấy lại được khoá.
