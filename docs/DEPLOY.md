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
3. Khi API khởi động, `startCommand` tự chạy (đều idempotent): `prisma migrate deploy` → `db:raw` (extension `vector`/`pg_trgm`/`unaccent`, cột tìm kiếm `Issue.searchVector`, chỉ mục trigram — **lần đầu nâng cấp khoá bảng `Issue`, xem [Checklist triển khai](#checklist-triển-khai--nâng-cấp)**) → `db:seed:init` (chỉ nạp demo **khi DB còn rỗng**) → chạy server.
   - Free tier **không có Shell** nên không chạy tay được script một lần (`automation:seal-secrets`, `integrations:rekey`) từ Dashboard — xem cách chạy từ máy của bạn ở mục Checklist bên dưới.
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

## Checklist triển khai / nâng cấp

Thứ tự **duy nhất** cho mọi lần nâng cấp (bản đầu tiên của đợt này có thay đổi `db:raw` lớn — xem bước 2). Mỗi bước idempotent, chạy lại an toàn.

| # | Bước | Lệnh | Khi nào |
|---|---|---|---|
| 0 | Sao lưu DB | `pg_dump` / snapshot của nhà cung cấp | Luôn, trước khi đụng DB prod |
| 1 | Áp migration Prisma | `prisma migrate deploy` | Luôn. PR này không thêm migration riêng, nhưng **nếu prod chưa chạy 6 migration của base `22c116c` thì bước này áp cả 6** — xem "Bước 1" bên dưới |
| 2 | SQL thô (extension, `searchVector`, chỉ mục) | `pnpm --filter @tirapro/api run db:raw` | Luôn. **DB lớn: chạy TAY trong giờ thấp điểm TRƯỚC khi rollout image mới** (xem cảnh báo bên dưới) |
| 3 | Mã hoá lại token/khoá bí mật khi ĐỔI `INTEGRATION_ENCRYPTION_KEY` | `integrations:rekey` | Chỉ khi đổi khoá (xem mục "đổi khoá mã hoá" bên dưới) |
| 4 | Mã hoá khoá bí mật webhook automation cũ | `automation:seal-secrets` | Một lần, **sau khi bản mới đã ổn định** (xem cảnh báo rollback) |

Render/Docker (`render.yaml` `startCommand`, `Dockerfile` `CMD`) tự chạy bước 1 + 2 mỗi lần khởi động; bước 3-4 luôn là thao tác tay.

### Bước 1 — `migrate deploy`: 6 migration của base có thể chưa chạy trên prod

Nhánh này không thêm migration, nhưng base `22c116c` có 6 migration mà prod có thể chưa từng áp: `sprint_sequence_unique`, `perf_indexes`, `mail_invite_reset`, `project_archive`, `worklog_rules`, `ai_log_index`. Kiểm bằng `prisma migrate status`. Nếu còn pending, `migrate deploy` sẽ áp chúng, hệ quả:

- **`project_archive`**: đặt `archivedAt = updatedAt` cho mọi dự án đang `isArchived` → các dự án đó trở thành **chỉ-đọc và bị ẩn** (thông báo cho quản trị dự án trước).
- **`perf_indexes`**: `CREATE INDEX` thường (không `CONCURRENTLY`, vì chạy trong transaction migration) trên `"Issue"` → **khoá ghi bảng `Issue` trong lúc build index** (đọc vẫn được). Với bảng lớn hãy coi như cửa sổ bảo trì, cùng lúc với bước 2.
- **`sprint_sequence_unique`**: nếu có sprint trùng `(projectId, sequence)` thì **đánh lại số** các bản trùng (giữ bản cũ nhất) rồi tạo unique index.
- `mail_invite_reset`, `worklog_rules`, `ai_log_index`: thêm bảng/cột/chỉ mục nhỏ.

### Bước 2 — `db:raw`: khoá bảng `Issue` (cửa sổ bảo trì)

Bản này thay `Issue.searchVector` (bỏ dấu tiếng Việt, không còn chứa mã issue) và thêm 4 chỉ mục GIN trigram. Lần đầu trên DB đã có dữ liệu, `db:raw`:

- **xoá + tạo lại cột sinh `searchVector`** → ghi lại toàn bộ bảng và giữ khoá `ACCESS EXCLUSIVE` trên `"Issue"` **đến hết file** (cả đọc lẫn ghi đều chờ). Đo trên PG 18, 100 041 issue: **~9 giây** (tăng tuyến tính; 1 triệu issue ~ vài chục giây đến vài phút, build GIN còn phụ thuộc `maintenance_work_mem`). Bảng phình gấp đôi tạm thời đến khi VACUUM;
- tạo 4 chỉ mục `issue_description_trgm`, `issue_key_trgm`, `issue_summary_unaccent_trgm`, `issue_description_unaccent_trgm` (thêm dung lượng, chút chi phí ghi);
- lần chạy sau là no-op (~0,5 giây).

Việc cần làm:
1. **Báo trước** người dùng: ghi/đọc issue có thể chậm ~9 giây mỗi 100k issue trong lúc nâng cấp.
2. DB **> ~300k issue** (hoặc Postgres nhỏ/chậm): chạy `db:raw` TAY giờ thấp điểm **trước** khi rollout image mới. Image mới sau đó chạy `db:raw` như no-op. Không để orchestrator tự chạy lần đầu: `HEALTHCHECK --start-period=40s` có thể giết container giữa chừng → transaction rollback (an toàn dữ liệu) nhưng lần khởi động sau lặp lại y hệt, không bao giờ xong (crash-loop).
3. Nhiều instance khởi động cùng lúc (rolling deploy, `--scale`) là an toàn: file SQL mở đầu bằng `pg_advisory_xact_lock` nên các `db:raw` đồng thời xếp hàng, bên đến sau thấy mọi thứ đã có và chạy như no-op.
4. Quyền DB: cần tạo extension — `unaccent`, `pg_trgm`, `btree_gin` là extension "trusted" từ PG13 (chỉ cần quyền `CREATE` trên database; RDS/Render/Supabase đều có sẵn). `vector` (pgvector) vẫn như trước. Cần quyền `CREATE` trên schema `public` để tạo hàm `immutable_unaccent`. Hàm gọi cứng `public.unaccent` — nếu extension `unaccent` đã cài ở schema khác (vd Supabase `extensions`) thì `db:raw` sẽ lỗi; cài lại trong `public` hoặc báo lại.
5. Chưa chạy `db:raw` thì tìm kiếm **vẫn chạy** (rơi về `translate()`/ILIKE, chậm hơn) và `/health` báo thiếu `searchVector`/`immutable_unaccent`.

Cách chạy tay: VPS — `set -a; . ./.env; set +a; pnpm --filter @tirapro/api run db:raw` (Prisma **không** nạp `.env` ở gốc repo khi chạy từ `apps/api`, nên phải nạp biến vào shell như vậy). Render — không có Shell: từ máy của bạn, trỏ vào *External Database URL* (Dashboard → `tirapro-db` → Connect; cần cho phép IP của bạn) rồi `DATABASE_URL='<external-url>' DIRECT_URL='<external-url>' pnpm --filter @tirapro/api run db:raw`; làm TRƯỚC khi deploy bản mới. Docker:

```bash
docker run --rm --env-file .env tirapro-api \
  ./node_modules/.bin/prisma db execute --file ./prisma/sql/01_pgvector_fts.sql --schema ./prisma/schema.prisma
```

### Bước 3-4 — chạy `integrations:rekey` / `automation:seal-secrets` ở từng môi trường

Hai script là `node scripts/*.mjs` — chỉ cần `DATABASE_URL` + `INTEGRATION_ENCRYPTION_KEY` (+ `INTEGRATION_ENCRYPTION_KEY_PREVIOUS` cho rekey) trong **môi trường của tiến trình**; không cần pnpm hay mã nguồn.

- **VPS (Phương án B):** nạp `.env` rồi chạy từ gốc repo:
  ```bash
  set -a; . ./.env; set +a
  pnpm --filter @tirapro/api run automation:seal-secrets -- --dry-run
  pnpm --filter @tirapro/api run automation:seal-secrets
  ```
- **Docker:** image runtime có sẵn hai script ở `/app/scripts/`. Chạy như job một lần với **cùng env** của container API (đặc biệt cùng `INTEGRATION_ENCRYPTION_KEY`; nếu DB nằm ở máy host dùng `host.docker.internal` hoặc `--network host` thay cho `localhost` trong `DATABASE_URL`):
  ```bash
  docker run --rm --env-file .env tirapro-api node scripts/seal-webhook-secrets.mjs --dry-run
  docker run --rm --env-file .env tirapro-api node scripts/seal-webhook-secrets.mjs --i-verified-key   # xem cảnh báo bên dưới
  docker run --rm --env-file .env tirapro-api node scripts/rekey-integrations.mjs --dry-run   # nếu đổi khoá
  ```
  Lưu ý `--env-file` của Docker: giá trị lấy **nguyên văn** (dấu nháy `"…"`/`'…'` trong file không bị bóc — bỏ nháy đi), và `localhost` trong `DATABASE_URL` là chính container chứ không phải máy host.
  (Kubernetes/ECS: tạo Job/one-off task dùng cùng image + `command: ["node","scripts/seal-webhook-secrets.mjs"]` + secret env của API.)
- **Render (không Shell, Free):** không có chỗ chạy trực tiếp. Chọn một:
  1. Chạy từ **máy của bạn** trỏ vào Postgres Render qua *External Database URL* (Dashboard → `tirapro-db` → Connect; cần mở IP cho phép) với đúng `INTEGRATION_ENCRYPTION_KEY` của dịch vụ API (Dashboard → Environment): `DATABASE_URL='<external-url>' INTEGRATION_ENCRYPTION_KEY='<key>' node apps/api/scripts/seal-webhook-secrets.mjs --dry-run` (cần `pnpm install` + `prisma generate` ở bản clone, hoặc dùng cách Docker ở trên với image build từ repo).
  2. Gói trả phí có Shell/One-off Job: chạy `node apps/api/scripts/seal-webhook-secrets.mjs` trong đó.
  3. **Chấp nhận bỏ qua** `seal-secrets`: khoá cũ dạng chữ thường vẫn gửi webhook bình thường và tự được mã hoá khi người dùng lưu lại quy tắc. Chỉ mất lợi ích "không còn plaintext trong DB" cho đến lúc đó.

### Cảnh báo cho bước 4 (`seal-secrets`)

- **Không hoàn tác được và không an toàn khi rollback.** Sau khi seal, quay về image cũ thì code cũ dùng nguyên chuỗi `enc:v1:…` làm khoá HMAC → chữ ký webhook sai âm thầm. Chỉ seal **sau** khi bản mới đã chạy ổn định và bạn không còn định rollback.
- Phải dùng **đúng** `INTEGRATION_ENCRYPTION_KEY` mà API đang chạy. Script tự thử giải một **mẫu đã mã hoá sẵn** — khoá webhook `enc:v1:…` có sẵn, hoặc token bot Telegram đã mã hoá — bằng khoá hiện tại; không giải được (khoá trong shell khác khoá API) → **dừng, exit 1** thay vì mã hoá bằng khoá lạ.
- **Giới hạn của guard:** lần seal đầu mà DB **chưa có secret/token nào đã mã hoá** (không Telegram, không webhook `enc:v1:`) thì không có mẫu để đối chiếu — script in cảnh báo và **từ chối ghi** trừ khi bạn thêm `--i-verified-key` (bạn tự đối chiếu khoá với env của dịch vụ API) hoặc `--force`. `--dry-run` không cần cờ. `--force` bỏ qua mọi kiểm tra — chỉ dùng khi chắc chắn.
- Exit code: `0` xong, `1` thiếu khoá/sai khoá/chưa xác nhận khoá, `2` có quy tắc bị bỏ qua (xung đột đúng lúc có người sửa / khoá > 200 ký tự) → chạy lại.

---

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

Cần `DATABASE_URL` và `INTEGRATION_ENCRYPTION_KEY` (đúng giá trị API đang dùng) trong môi trường — cách nạp biến và chạy trong Docker/Render: xem [Checklist triển khai](#checklist-triển-khai--nâng-cấp). Script không đổi schema,
không cần `prisma migrate`. Nếu in "bỏ qua (xung đột)" (có người đang sửa quy tắc) thì chạy lại. Client bên thứ ba từng đọc
`actions[].secret` qua API sẽ không còn lấy lại được khoá.
