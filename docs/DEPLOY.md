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
pnpm --filter @tirapro/types build
pnpm --filter @tirapro/shared build
pnpm --filter @tirapro/api exec prisma generate
pnpm --filter @tirapro/api build
pnpm --filter @tirapro/api exec prisma migrate deploy
pnpm --filter @tirapro/api run db:raw         # extension pgvector + FTS
pnpm --filter @tirapro/api run db:seed:roles  # quyền + vai trò hệ thống (BẮT BUỘC với DB mới, không có demo)
# hoặc: pnpm --filter @tirapro/api run db:seed  # demo (1 lần, đã gồm vai trò) — KHÔNG dùng cho dữ liệu thật
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
| `DATABASE_URL`, `DIRECT_URL` | API | Postgres (pgvector). DIRECT_URL cho migrate. **Nên đặt `connection_limit` tường minh trong `DATABASE_URL`** (khuyến nghị `&connection_limit=10`): thiếu thì Prisma dùng `num_cpus*2+1` (1 vCPU = 3 kết nối) và `render.yaml` lấy chuỗi kết nối của DB quản lý, vốn KHÔNG có tham số này. API tự tính số lần đếm xem trước đồng thời (`common/bounded-count.ts`) = clamp(⌊pool/3⌋, 1, 3), nên pool 3 chỉ nhường 1 chỗ, pool ≥ 9 nhường 3. |
| `REDIS_URL` | API | realtime/cache; thiếu vẫn chạy REST (degrade). |
| `PORT` | API | PaaS tự cấp; local dùng `API_PORT` (4000). |
| `CORS_ORIGIN` | API | = URL web (phân tách bằng dấu phẩy nếu nhiều). |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | API | ≥32 ký tự; Render `generateValue` tự sinh. |
| `ANTHROPIC_API_KEY` | API | (tùy chọn) bật AI thật. |
| `EMBEDDING_PROVIDER` | API | `none` → tìm kiếm dùng full-text. |
| `INTEGRATION_ENCRYPTION_KEY` | API | Khoá mã hoá token tích hợp (≥32 ký tự, khác mặc định ở production). Render `generateValue` tự sinh. |
| `INTEGRATION_ENCRYPTION_KEY_PREVIOUS` | API | (tùy chọn) khoá CŨ — để vẫn giải mã token đã mã hoá trước khi đổi khoá. Xem mục dưới. |
| `STORAGE_DRIVER` | API | `local` (mặc định, ghi `STORAGE_LOCAL_DIR`) hoặc `s3` (S3/MinIO). Khi `s3` bắt buộc `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` (thiếu → API không khởi động, báo rõ). Xem mục "Lưu tệp trên S3/MinIO". |
| `S3_KEY_PREFIX` | API | tiền tố khoá — **BẮT BUỘC khi dùng chung bucket** với app khác, vd `tirapro/`. Để trống chỉ khi bucket riêng của Tirapro. Giá trị lưu trong DB (`storageKey`) không có tiền tố nên sau này chuyển sang bucket riêng chỉ cần sao chép và bỏ tiền tố. |
| `STORAGE_STARTUP_STRICT` | API | (tuỳ chọn) khi `s3`: `true` = lỗi cấu hình dứt khoát (bucket thiếu, 403, sai khoá) làm API dừng ngay. Mặc định `true` ở production, `false` còn lại. Lỗi mạng không bao giờ làm API dừng. |
| `VITE_API_URL` | Web | `https://<api>/api/v1` (nhúng lúc build). |
| `VITE_WS_URL` | Web | `https://<api>` (WebSocket). |
| `VITE_SHOW_DEMO_ACCOUNTS` | Web | (tùy chọn) `true` = hiện khối "Tài khoản demo" + mật khẩu chung ở trang đăng nhập và trang tài liệu. Chỉ bật cho staging/demo; production để trống (bản build không chứa mật khẩu demo). |
| `VITE_FEATURE_REPOS` | Web | (tùy chọn) `1` = bật lại mục Kho mã (GitHub/GitLab) + khối "Liên kết code" trên công việc. Mặc định **ẩn** (hoãn tới đợt sau). Nhúng lúc build. |

Chi tiết đầy đủ: [`.env.example`](../.env.example).

## Lưu tệp trên S3/MinIO

Mặc định tệp (đính kèm, ảnh đại diện, tệp phân tích import Jira, cờ hệ thống `system-settings.json`) nằm trên đĩa ở `STORAGE_LOCAL_DIR`. Đặt `STORAGE_DRIVER=s3` để lưu trên S3/MinIO. Tệp vẫn tải về **qua API** (giữ nguyên kiểm quyền; không dùng đường dẫn presigned công khai) và khoá object giống hệt đường dẫn local (`{workspaceId}/{id}-{tên}`, `avatars/…`, `imports/…`, `system-settings.json`).

**Thứ tự triển khai khi chuyển một hệ thống đang chạy từ local sang S3**

1. **Bucket**: lý tưởng là bucket RIÊNG cho Tirapro (vd `tirapro`) với access key chỉ có quyền trên bucket đó. Nếu key chỉ có quyền trên một bucket **dùng chung** có sẵn (không tạo được bucket mới), dùng bucket đó và đặt `S3_KEY_PREFIX=tirapro/` (xem bước 2). Quyền cần có (`s3:GetObject`, `PutObject`, `DeleteObject`, `ListBucket`, `GetBucketLocation`). **Ứng dụng không tự tạo bucket.** Ví dụ MinIO: `mc mb company/tirapro`.
2. Đặt biến môi trường của API: `S3_ENDPOINT` (URL **API S3**, dạng `http://<host>:<cổng API S3>`; `http://` được phép), `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, tuỳ chọn `S3_REGION` (mặc định `us-east-1`), `S3_FORCE_PATH_STYLE` (mặc định `true`, đúng cho MinIO), `S3_KEY_PREFIX` (**dùng chung bucket với app khác thì BẮT BUỘC đặt tiền tố, vd `tirapro/`** — để trống chỉ khi bucket riêng của Tirapro; nếu key chỉ có quyền theo tiền tố thì HeadBucket 403 lúc khởi động được chấp nhận khi liệt kê trong tiền tố được, API ghi log ghi chú; mọi object của Tirapro có khoá `<tiền tố><storageKey>`, Tirapro không bao giờ đọc/ghi/xoá/liệt kê ngoài tiền tố; không bắt đầu bằng `/`, không `..`; tự thêm `/` cuối). MinIO tách hai cổng (API S3 và trang quản trị) và **cổng nào là cổng nào tuỳ cài đặt** (MinIO công ty có API ở 9001, 9000 là console — ngược với mặc định của MinIO): không chắc thì **thử HeadBucket để xác định cổng API** (cổng sai trả lỗi kết nối/403/trang HTML). **Chưa** đổi `STORAGE_DRIVER` ở bước này.
3. **Cắt chuyển theo ĐÚNG thứ tự này**:
   1. **Dừng API** (hoặc bật bảo trì) để không còn ai ghi tệp/cờ mới.
   2. **Chép tệp** (từ máy/container đọc được `STORAGE_LOCAL_DIR`, kết nối được DB + MinIO; cần `pnpm --filter @tirapro/api build` trước, hoặc dùng image). Chạy `--dry-run` xem trước, rồi chạy thật; có thể chạy trước vài lần khi API còn chạy để giảm khối lượng, **nhưng lần cuối phải chạy khi API đã dừng**:

      ```bash
      pnpm --filter @tirapro/api run storage:migrate-local-to-s3 -- --dry-run   # chỉ báo cáo
      pnpm --filter @tirapro/api run storage:migrate-local-to-s3                # chép thật
      # Docker: docker run --rm --env-file .env -v <thư-mục-uploads>:/app/uploads <image> node scripts/storage-migrate-local-to-s3.mjs
      ```

      Script tôn trọng `S3_KEY_PREFIX` (khoá đích = tiền tố + khoá; `--dry-run` in từng khoá đích `s3://<bucket>/<tiền tố><khoá>` để kiểm tra). Script đọc mọi khoá DB đang tham chiếu (đính kèm, ảnh đại diện người dùng/không gian/dự án) + `system-settings.json`, **idempotent**: tệp bất biến bỏ qua nếu S3 đã có cùng kích thước; `system-settings.json` so theo **nội dung (sha256)**. **Không bao giờ ghi đè object S3 mới hơn bản local mà khác nội dung** (báo "xung đột", thoát mã 2; chắc chắn muốn đè mới dùng `-- --force`). Không xoá tệp local, không tạo bucket. Kết thúc báo số đã chép / bỏ qua / thiếu trên đĩa / xung đột / lỗi (kèm nguyên nhân từng khoá lỗi); mã 2 nếu còn lỗi hoặc xung đột (chạy lại để thử lại), mã 1 nếu cấu hình sai hoặc không tới được bucket. Khoá "thiếu trên đĩa" là tệp DB có tham chiếu nhưng đã mất từ trước (không do script). Script cảnh báo nếu môi trường của nó đang đặt `STORAGE_DRIVER=s3`.
   3. Đổi `STORAGE_DRIVER=s3`.
   4. Khởi động API.
4. **Kiểm HeadBucket**: log khởi động có dòng `S3 sẵn sàng: bucket "…" truy cập được` (logger `Storage`). Chính sách khi HeadBucket lỗi (`STORAGE_STARTUP_STRICT`, mặc định **bật ở production**, tắt ở môi trường khác):
   - **Lỗi cấu hình dứt khoát** (bucket không tồn tại, 403/AccessDenied, sai access key/secret): ở chế độ chặt **API dừng ngay** với thông báo tiếng Việt nêu nguyên nhân (cổng API sai, quên tạo bucket, sai khoá…). Không chặt (`STORAGE_STARTUP_STRICT=false`, chỉ để chữa cháy): API lên nhưng upload/tải tệp lỗi, log `Kho tệp S3 KHÔNG dùng được`.
   - **Lỗi mạng/timeout** (MinIO tạm tắt, mạng chập chờn): API **vẫn khởi động**, log lỗi, thử lại HeadBucket mỗi **30 giây** và log khi kho phục hồi; cờ hệ thống tự đọc lại (backoff 2s → 30s), trong lúc chưa đọc được cờ thì đăng ký công khai tạm đóng và **không lưu được** cờ mới (tránh ghi đè cờ thật).
   - Khi kho khởi động ổn, API thăm dò ghi có điều kiện (`If-None-Match: *`) một lần; nếu máy chủ S3 bỏ qua header sẽ log lỗi rõ (chống chạy trùng import Jira vẫn được bảo vệ bởi claim ở DB).
   - Console quản trị → Tổng quan, đèn "Lưu trữ" hiện `s3 · <bucket>` và đỏ khi HeadBucket lỗi (kết quả được nhớ ~30 giây); Cấu hình hiện driver + bucket (không bao giờ có khoá).
5. Tải thử một đính kèm và một ảnh đại diện cũ trên giao diện; khi chắc chắn, giữ thư mục local làm bản lưu thêm một thời gian rồi mới xoá tay.
6. **(Tuỳ chọn) Sửa tên tệp tiếng Việt đã lưu méo** — bản trước đợt này lưu tên "báo cáo" thành "bÃ¡o cÃ¡o" (multer giải mã latin1). Từ giờ tên mới được lưu đúng. Muốn sửa các dòng cũ (chỉ đổi cột hiển thị `fileName`, không đụng tệp): `pnpm --filter @tirapro/api run attachments:fix-filenames -- --dry-run` rồi chạy không `--dry-run`. Chỉ đổi tên giải mã sạch được; idempotent.

**Hành vi cần biết**

- Upload khi S3 không tới được/quá hạn (client: timeout 15 giây, thử tối đa 2 lần) → lỗi 422 "Không lưu được tệp, thử lại"; chi tiết kỹ thuật chỉ vào log. Xoá đính kèm/ảnh mà xoá object lỗi → chỉ log cảnh báo, thao tác của người dùng vẫn thành công (có thể còn object mồ côi, dọn tay).
- Phiên phân tích import Jira (`imports/`, giữ tối đa 1 giờ) cũng nằm trong bucket. Chống chạy trùng ("Chạy" hai lần/song song) dựa vào **DB** (khoá advisory Postgres + kiểm `ImportJob` đã có `analyzeId`, trong một transaction, không cần migration), nên không phụ thuộc phiên bản máy chủ S3; dấu `.claimed` ghi có điều kiện chỉ là lớp phụ. Bấm lại/thử lại nhận đúng job cũ.
- Giới hạn dung lượng upload được cắt ngay ở multer theo `MAX_FILE_SIZE_MB` (ảnh đại diện 5MB) để tệp lớn không đệm hết vào RAM; **đặt thêm `client_max_body_size` ở reverse proxy** (nginx) lớn hơn `MAX_FILE_SIZE_MB` một chút.
- Tổng dung lượng đính kèm trên console lấy từ DB (không liệt kê bucket).
- Test tích hợp với MinIO thật (opt-in): xem đầu `apps/api/src/common/storage/s3-storage.int-spec.ts`.

## Checklist triển khai / nâng cấp

Thứ tự **duy nhất** cho mọi lần nâng cấp (bản đầu tiên của đợt này có thay đổi `db:raw` lớn — xem bước 2). Mỗi bước idempotent, chạy lại an toàn.

| # | Bước | Lệnh | Khi nào |
|---|---|---|---|
| 0 | Sao lưu DB | `pg_dump` / snapshot của nhà cung cấp | Luôn, trước khi đụng DB prod |
| 1 | Áp migration Prisma | `prisma migrate deploy` | Luôn. Đợt UX round 2 thêm **28 migration** (xem "Bước 1b") và **nếu prod chưa chạy 6 migration của base `22c116c` thì bước này áp cả 6** (tổng 34) — xem "Bước 1" bên dưới |
| 2 | SQL thô (extension, `searchVector`, chỉ mục) | `pnpm --filter @tirapro/api run db:raw` | Luôn. **DB lớn: chạy TAY trong giờ thấp điểm TRƯỚC khi rollout image mới** (xem cảnh báo bên dưới) |
| 3 | Mã hoá lại token/khoá bí mật khi ĐỔI `INTEGRATION_ENCRYPTION_KEY` | `integrations:rekey` | Chỉ khi đổi khoá (xem mục "đổi khoá mã hoá" bên dưới) |
| 4 | Mã hoá khoá bí mật webhook automation cũ | `automation:seal-secrets` | Một lần, **sau khi bản mới đã ổn định** (xem cảnh báo rollback) |
| 1c | Nạp quyền + vai trò hệ thống (DB mới, không demo) | `pnpm --filter @tirapro/api run db:seed:roles [-- --dry-run]` | **Bắt buộc lần đầu với DB sạch** — thiếu thì đăng ký/tạo workspace lỗi 500 "System role chưa được seed". Chỉ THÊM quyền/vai trò/lượt gán còn thiếu, không gỡ gì nên chạy lại an toàn; cũng dùng để bù phần `+thiếu` mà bước 5 báo. Trong container: `node scripts/seed-system-roles.mjs` |
| 5 | Kiểm bộ quyền vai trò hệ thống khớp code | `pnpm --filter @tirapro/api run db:check-roles` | Sau `migrate deploy` (tuỳ chọn): in `+thiếu`/`-thừa` theo `SYSTEM_ROLE_PERMISSIONS`, thoát mã 1 nếu lệch. Migration chỉ THÊM quyền, không gỡ. Trong container: `docker run --rm --env-file .env <image> node scripts/check-system-roles.mjs` (giống hai script ở bước 3-4; cần image đã copy script này) |

Render/Docker (`render.yaml` `startCommand`, `Dockerfile` `CMD`) tự chạy bước 1 + 2 mỗi lần khởi động; bước 3-4 luôn là thao tác tay.

### Ghi chú phát hành — tài khoản & phiên đăng nhập

- **Khoá tài khoản có hiệu lực ngay** (access token, refresh token, socket đang mở, API key của người đó). **Đặt lại mật khẩu (admin), "Quên mật khẩu" hoàn tất, tự đổi mật khẩu và "Đăng xuất mọi thiết bị"** thu hồi mọi phiên web (access token cấp trước mốc thu hồi bị 401 ngay) và ngắt socket đang mở. Riêng **tự đổi mật khẩu**: thiết bị đang đổi được cấp phiên mới (token + cookie) và giữ/nối lại socket bằng token mới; socket và phiên của các thiết bị khác bị ngắt.
- **API key KHÔNG bị thu hồi** khi đổi mật khẩu / đăng xuất mọi thiết bị: key là thông tin xác thực riêng của tích hợp (MCP, script). Key chỉ bị chặn khi tài khoản chủ key bị **khoá** (cache xác thực bị xoá ngay) hoặc khi chủ key bị **gỡ khỏi không gian làm việc**. Nghi lộ key thì thu hồi trong Cài đặt → API.
- Phiên đang chạy trên bản cũ không có claim `iatMs` — vẫn hợp lệ, chỉ bị so theo giây.

### Bước 1 — `migrate deploy`: 6 migration của base có thể chưa chạy trên prod

Ngoài các migration của đợt UX round 2, base `22c116c` có 6 migration mà prod có thể chưa từng áp: `sprint_sequence_unique`, `perf_indexes`, `mail_invite_reset`, `project_archive`, `worklog_rules`, `ai_log_index`. Kiểm bằng `prisma migrate status`. Nếu còn pending, `migrate deploy` sẽ áp chúng, hệ quả:

- **`project_archive`**: đặt `archivedAt = updatedAt` cho mọi dự án đang `isArchived` → các dự án đó trở thành **chỉ-đọc và bị ẩn** (thông báo cho quản trị dự án trước).
- **`perf_indexes`**: `CREATE INDEX` thường (không `CONCURRENTLY`, vì chạy trong transaction migration) trên `"Issue"` → **khoá ghi bảng `Issue` trong lúc build index** (đọc vẫn được). Với bảng lớn hãy coi như cửa sổ bảo trì, cùng lúc với bước 2.
- **`sprint_sequence_unique`**: nếu có sprint trùng `(projectId, sequence)` thì **đánh lại số** các bản trùng (giữ bản cũ nhất) rồi tạo unique index.
- `mail_invite_reset`, `worklog_rules`, `ai_log_index`: thêm bảng/cột/chỉ mục nhỏ.
- **`remove_invites`** (UX vòng 2): xoá bảng `InviteToken` và mọi thư mời (mọi trạng thái) trong `EmailOutbox` (liên kết nhận lời mời trong hộp thư người dùng sẽ 404). Không thể hoàn tác dữ liệu lời mời đã xoá.

### Bước 1b — `migrate deploy`: 28 migration của UX vòng 2

Danh sách đầy đủ (tên, khoá, backfill) và hành vi người dùng thấy: `docs/RELEASE_NOTES_2026-10-follow-ups.md` mục "UX vòng 2". Tóm tắt những gì ảnh hưởng vận hành:

- **Không migration nào ghi lại bảng `Issue`** và vòng 2 **không đổi** `db:raw`. `Issue` chỉ nhận 2 `ADD COLUMN` nullable (`acceptanceCriteria`, `environment`) — đổi metadata, khoá `ACCESS EXCLUSIVE` rất ngắn (nhưng phải chờ giao dịch dài đang mở). Cột có `DEFAULT` hằng (`Project.isPrivate`, `WikiPage.version`, `KeyResult.source`, `ReportSubscription.weekday/hour/timezone/deliverEmail/allowPrivateToChannel`) cũng chỉ đổi metadata trên PG ≥ 11.
- **Khoá ghi trong lúc build index** (`CREATE INDEX` thường, chạy trong giao dịch migration): bảng nối `IssueComponent`, `IssueFixVersion` (`issue_component_version_index`) và bảng `Mention` (`mention_unique`: xoá dòng trùng, giữ dòng cũ nhất, rồi 2 unique index). Hai bảng đầu nhỏ hơn `Issue` nhiều; bảng `Mention` lớn thì chạy giờ thấp điểm.
- **Backfill dữ liệu:** `membership_roles_backfill` (thêm dòng nối vai trò cho membership chưa có), `link_types_causes_tests` (thêm 2 loại liên kết mỗi workspace), `wiki_page_issue` (quét `regexp_matches` mọi nội dung wiki — CPU theo tổng dung lượng wiki), `wiki_page_history` (sao chép nội dung **mọi** trang wiki thành bản v1 → dung lượng wiki tăng gấp đôi một lần), `project_workflow_names` (đổi tên quy trình mặc định thành `"tên (MÃ)"`). Tất cả idempotent.
- **Cấp quyền (INSERT `RolePermission`, chỉ thêm, không thu hồi):** `system_roles_refresh` (Scrum Master `issue:create`+`issue:triage`, Product Owner `issue:transition`), `wiki_project_permissions` (`wiki:manage` thành quyền cấp dự án cho Project Admin/BA/PO/Scrum Master/Developer/Tester **và** mọi vai tuỳ biến có `project:admin`/`workspace:admin`; vì mọi thành viên workspace là Developer mặc định nên họ sửa được wiki mọi dự án công khai). Cache quyền Redis hết hạn tối đa ~1 phút sau khi áp.
- **Không hoàn tác:** `remove_invites` xoá bảng `InviteToken` và mọi thư mời trong `EmailOutbox`; `wiki_page_history` backfill; enum `HistoryField` thêm `DESCRIPTION`/`COMPONENT`/`FIX_VERSION`, `DashboardScope.TEAM`, `WidgetType` ×3 (`ADD VALUE` chạy trong giao dịch cần PG ≥ 12). Không nên quay về image cũ sau khi người dùng đã dùng bản mới; sao lưu (bước 0) là đường lùi.
- Mốc thời gian migration không đơn điệu (vd `…299000` sau `…207000`): `migrate deploy` vẫn áp mọi migration chưa áp, không cần `migrate dev`. DB dev nào đã áp migration L5/L20/OKR bằng tên tạm cũ (`…200000_dashboard_team_scope`, `…202000_digest_schedule_fields`, `…203000/204000/208000_key_result_*`) bị lệch lịch sử — dựng lại DB đó.

### Ghi chú phát hành — UX vòng 2

- **Nền trình duyệt tối thiểu:** Safari/iOS ≥ 15.4, Chrome/Edge/Firefox trong 2 năm gần nhất (màu `oklch()` của DESIGN.md cần Safari 15.4; đợt sửa cuối đang gỡ regex lookbehind khỏi chunk đầu để iOS 15.4–16.3 không trắng trang). Thiết bị cũ hơn không được hỗ trợ.

- **Không chạy `db:seed` để "seed lại quyền" trên dữ liệu thật** — `db:seed` làm mới (xoá) workspace demo. Quyền vai trò hệ thống đã đi qua migration; kiểm bằng bước 5 (`db:check-roles`). Mô tả quyền tiếng Việt trong bảng `Permission` chỉ đổi khi chạy `db:seed`, nhưng web đọc mô tả từ `@tirapro/types` nên không ảnh hưởng. Tour mặc định + checklist "Bắt đầu" tự được API gieo lúc khởi động (khoá advisory, không hạ cấp).
- **Biến môi trường:** API không có biến mới; web có `VITE_FEATURE_REPOS` (tuỳ chọn) và `VITE_SHOW_DEMO_ACCOUNTS` (xem bảng trên).
- **Telegram:** dùng **một bot riêng cho Tirapro**. Wizard liên kết nhóm đọc tin bằng `getUpdates` (offset âm, `allowed_updates=['message']`): công cụ khác đọc `getUpdates` trên cùng bot có thể mất tin cũ hơn 100 bản mới nhất hoặc gặp 409; Tirapro báo 409 khi bot đang gắn webhook hoặc có tiến trình khác đang đọc. Tạo kết nối không token khi hệ thống không có bot chung (`TELEGRAM_BOT_TOKEN`) bị từ chối.
- **Pool người dùng chung = giả định một tổ chức:** quản trị workspace thấy và thêm được mọi tài khoản hệ thống. Không triển khai nhiều tổ chức độc lập kèm tự đăng ký mở (nguy cơ chiếm tài khoản/nhìn thấy người dùng giữa workspace) trừ khi tắt đăng ký.
- **Tác vụ nền:** digest chạy mỗi giờ (`0 * * * *`, khớp thứ/giờ/múi giờ từng báo cáo) + tự gửi khi kết thúc sprint — **báo cáo định kỳ hiện có đổi giờ gửi**: trước chạy 08:00 theo múi giờ tiến trình (UTC trên Docker/Render → 15:00 giờ VN), nay mặc định 08:00 `Asia/Ho_Chi_Minh` nên trên máy chủ UTC thư đến **sớm 7 giờ**; báo trước hoặc chỉnh giờ từng báo cáo; cron chụp giá trị Key Result `01:30 UTC` hằng ngày. Cron khoá bằng Redis; không có Redis thì chạy chế độ một node (không khoá) — đừng chạy nhiều instance API mà thiếu Redis.
- **Email:** báo cáo định kỳ qua Email và thư đặt lại mật khẩu đi qua `MAIL_DRIVER`; `console` chỉ ghi log, `smtp` hiện mới là khung chưa gửi thật (ném lỗi khi gửi) — Telegram là kênh digest dùng được ngay.
- **Báo trước cho người dùng:** liên kết lời mời cũ không còn (404), dự án riêng tư ẩn với người ngoài dự án, việc chưa duyệt không còn trên Board/Việc chờ, API key không bị thu hồi khi đổi mật khẩu (xem mục trên), custom role có `report:view` nhưng không `project:view` mất số liệu dự án công khai.

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

**Trước khi seal — kiểm khoá (bắt buộc ở lần đầu nếu DB chưa có secret/token nào đã mã hoá):** script tự đối chiếu khoá bằng một mẫu đã mã hoá sẵn (khoá webhook `enc:v1:…` hoặc token bot Telegram). Nếu DB không có mẫu nào **mà vẫn còn khoá webhook dạng thô cần seal**, nó **dừng với exit 1** và đòi `--i-verified-key` (không còn gì để seal thì thoát 0, không cảnh báo). Cờ này là lời xác nhận của BẠN, nên chỉ thêm sau khi tự so khoá trong shell/env-file với `INTEGRATION_ENCRYPTION_KEY` của dịch vụ API đang chạy (Render: Dashboard → Environment; Docker/VPS: env của container/process API) — so mà không in khoá ra, vd `printf %s "$INTEGRATION_ENCRYPTION_KEY" | shasum -a 256` ở hai nơi phải ra cùng giá trị. `--dry-run` bỏ qua yêu cầu cờ khi thiếu mẫu (chỉ in cảnh báo), nhưng vẫn **exit 1 nếu khoá hiện tại không giải được mẫu đã mã hoá** (sai khoá).

- **VPS (Phương án B):** nạp `.env` rồi chạy từ gốc repo (đã kiểm khoá như trên):
  ```bash
  set -a; . ./.env; set +a
  pnpm --filter @tirapro/api run automation:seal-secrets -- --dry-run
  pnpm --filter @tirapro/api run automation:seal-secrets                    # exit 1 nếu chưa có mẫu đối chiếu khoá…
  pnpm --filter @tirapro/api run automation:seal-secrets -- --i-verified-key # …thì chạy dòng này SAU khi đã tự kiểm khoá
  ```
- **Docker:** image runtime có sẵn hai script ở `/app/scripts/`. Chạy như job một lần với **cùng env** của container API (đặc biệt cùng `INTEGRATION_ENCRYPTION_KEY`; nếu DB nằm ở máy host dùng `host.docker.internal` hoặc `--network host` thay cho `localhost` trong `DATABASE_URL`):
  ```bash
  docker run --rm --env-file .env tirapro-api node scripts/seal-webhook-secrets.mjs --dry-run
  docker run --rm --env-file .env tirapro-api node scripts/seal-webhook-secrets.mjs   # exit 1 nếu DB chưa có mẫu đối chiếu khoá: tự kiểm khoá rồi thêm --i-verified-key (xem trên)
  docker run --rm --env-file .env tirapro-api node scripts/rekey-integrations.mjs --dry-run   # nếu đổi khoá
  ```
  Lưu ý `--env-file` của Docker: giá trị lấy **nguyên văn** (dấu nháy `"…"`/`'…'` trong file không bị bóc — bỏ nháy đi), và `localhost` trong `DATABASE_URL` là chính container chứ không phải máy host.
  (Kubernetes/ECS: tạo Job/one-off task dùng cùng image + `command: ["node","scripts/seal-webhook-secrets.mjs"]` + secret env của API.)
- **Render (không Shell, Free):** không có chỗ chạy trực tiếp. Chọn một:
  1. Chạy từ **máy của bạn** trỏ vào Postgres Render qua *External Database URL* (Dashboard → `tirapro-db` → Connect; cần mở IP cho phép) với đúng `INTEGRATION_ENCRYPTION_KEY` của dịch vụ API (Dashboard → Environment): `DATABASE_URL='<external-url>' INTEGRATION_ENCRYPTION_KEY='<key>' node apps/api/scripts/seal-webhook-secrets.mjs --dry-run`, rồi chạy thật (không `--dry-run`; nếu thoát 1 vì chưa có mẫu đối chiếu khoá thì thêm `--i-verified-key` SAU khi đã so khoá với env của API) (cần `pnpm install` + `prisma generate` ở bản clone, hoặc dùng cách Docker ở trên với image build từ repo).
  2. Gói trả phí có Shell/One-off Job: chạy `node apps/api/scripts/seal-webhook-secrets.mjs --dry-run` rồi bản thật trong đó (shell của chính dịch vụ API dùng đúng env của nó, nhưng vẫn cần `--i-verified-key` nếu chưa có mẫu đối chiếu — khoá khi đó đúng sẵn, bạn chỉ cần xác nhận).
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
pnpm --filter @tirapro/api run automation:seal-secrets                # ghi vào DB (thêm -- --i-verified-key ở lần đầu nếu DB chưa có mẫu đã mã hoá, sau khi tự kiểm khoá)
```

Cần `DATABASE_URL` và `INTEGRATION_ENCRYPTION_KEY` (đúng giá trị API đang dùng) trong môi trường — cách nạp biến và chạy trong Docker/Render: xem [Checklist triển khai](#checklist-triển-khai--nâng-cấp). Script không đổi schema,
không cần `prisma migrate`. Nếu in "bỏ qua (xung đột)" (có người đang sửa quy tắc) thì chạy lại. Client bên thứ ba từng đọc
`actions[].secret` qua API sẽ không còn lấy lại được khoá.
