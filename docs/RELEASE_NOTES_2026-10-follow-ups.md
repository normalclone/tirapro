# Release notes — đợt follow-up 2026-10 (`fix/review-findings`)

Gộp toàn bộ thay đổi của nhánh (base `22c116c`): 35 task (26 task kế hoạch: S1-S6, C1-C9, W1-W6, T1-T5; 9 task nhóm X: X1, X2a/b/c, X3-X7) + đợt sửa cuối (FW). Chi tiết từng mục: `docs/superpowers/plans/2026-10-15-follow-ups.md`.

> **Merge PR bằng merge commit (không squash, không rebase-merge).** `.git-blame-ignore-revs` trỏ tới SHA `4fa8273…` của commit `prettier --write` toàn repo (T5); squash/rebase đổi SHA thì file này vô hiệu và `git blame` ngập trong diff format. Sau khi clone/pull chạy một lần: `git config blame.ignoreRevsFile .git-blame-ignore-revs`. Nhánh đang mở cần rebase lên sau commit format.

## 1. Cần làm khi triển khai

Checklist đầy đủ (thứ tự, lệnh theo từng môi trường): `docs/DEPLOY.md` mục "Checklist triển khai / nâng cấp".

1. **PR này không thêm migration riêng, nhưng `migrate deploy` có thể áp 6 migration của base `22c116c` nếu prod chưa từng chạy** (kiểm `prisma migrate status`): `sprint_sequence_unique`, `perf_indexes`, `mail_invite_reset`, `project_archive`, `worklog_rules`, `ai_log_index`. Hệ quả: `project_archive` đặt `archivedAt = updatedAt` cho dự án đang `isArchived` → các dự án đó thành **chỉ-đọc và bị ẩn**; `perf_indexes` dùng `CREATE INDEX` thường trên `Issue` → **khoá ghi bảng `Issue` lúc build** (cửa sổ bảo trì); `sprint_sequence_unique` **đánh lại số** sprint trùng `(projectId, sequence)`. Thứ tự: `prisma migrate deploy` → `db:raw` → (chỉ khi đổi khoá mã hoá) `integrations:rekey` → `automation:seal-secrets`. Render/Docker tự chạy `migrate deploy` + `db:raw` mỗi lần khởi động; hai script cuối luôn chạy tay.
2. **`db:raw` thay đổi lớn (X5/C5) — khoá bảng `Issue`.** Cài thêm extension `unaccent`; tạo hàm `immutable_unaccent`; **xoá và tạo lại cột sinh `Issue.searchVector`** (bỏ dấu, không còn chứa mã issue) → khoá `ACCESS EXCLUSIVE` bảng `Issue` ~**9 giây / 100k issue** lần đầu (đọc + ghi đều chờ), bảng phình tạm thời đến khi VACUUM; thêm 4 chỉ mục GIN trigram (`issue_description_trgm`, `issue_key_trgm`, `issue_summary_unaccent_trgm`, `issue_description_unaccent_trgm`). **DB lớn (> ~300k issue): chạy tay giờ thấp điểm TRƯỚC khi rollout image mới**; sau đó là no-op. Cần quyền tạo extension (`unaccent`/`pg_trgm`/`btree_gin` là trusted từ PG13) và quyền `CREATE` trên schema `public`.
3. **Nhiều instance khởi động cùng lúc là an toàn (FW-OPS I1):** `db:raw` mở đầu bằng `pg_advisory_xact_lock` — các tiến trình song song xếp hàng thay vì chết với `tuple concurrently updated`. CI có bước chạy 3 `db:raw` song song + bước nâng cấp từ `searchVector` bản cũ.
4. Chưa chạy `db:raw` thì tìm kiếm **vẫn chạy** (rơi về `translate()`/ILIKE, chậm hơn); `/health` báo thiếu `searchVector`/`immutable_unaccent`.
5. **Mã hoá khoá bí mật webhook automation (S4):** chạy `automation:seal-secrets [--dry-run]` một lần (idempotent; exit 2 nếu có xung đột/khoá quá dài). **Không quay lại image cũ được sau khi seal** (code cũ dùng nguyên chuỗi `enc:v1:…` làm khoá HMAC → chữ ký sai âm thầm) — chỉ seal khi bản mới đã ổn định. Script tự thử giải một mẫu đã mã hoá (khoá webhook `enc:v1:` có sẵn hoặc token bot Telegram) bằng khoá hiện tại và dừng (exit 1) nếu sai khoá. **Giới hạn:** nếu DB chưa có mẫu nào (lần seal đầu, không Telegram) thì không kiểm chứng được khoá — script in cảnh báo và từ chối ghi trừ khi bạn tự đối chiếu khoá với env của dịch vụ API rồi thêm `--i-verified-key` (`--dry-run` không cần; `--force` bỏ qua mọi kiểm tra). Đổi `INTEGRATION_ENCRYPTION_KEY` mà không `rekey`/`..._PREVIOUS` → webhook báo "Khoá bí mật của webhook không giải mã được".
6. **Docker:** image runtime nay chứa `scripts/rekey-integrations.mjs` và `scripts/seal-webhook-secrets.mjs` (`docker run --rm --env-file .env <image> node scripts/seal-webhook-secrets.mjs --dry-run`). Render Free không có Shell: chạy từ máy của bạn qua External Database URL, hoặc chấp nhận bỏ qua seal (xem DEPLOY.md).
7. **Dev tooling / CI:** prettier toàn repo (431 file, commit `4fa8273`); CI thêm `format:check` và job `db` (Postgres 16 + 18, pgvector: migrate deploy, `migrate diff --exit-code`, `db:raw` hai lần + song song + nâng cấp); ratchet `lint` 281 → **91** cảnh báo (`--max-warnings 91`); thêm `knip.jsonc`; `pnpm format` = `prettier --write .`; lint-staged phủ mjs/css/html. Module `dev` đổi tên `dev-links` (route REST `/dev/...` giữ nguyên). Dependency mới: `@dnd-kit/sortable@^10` (web).
8. **Dự án đang lưu trữ trở thành chỉ-đọc** nhất quán (xem mục 2/3) — thông báo cho quản trị dự án trước khi bật.

## 2. Thay đổi hành vi người dùng thấy

**Quyền**
- Role chỉ có quyền `:own` (vd Reporter) nay bị 403 trên các route sửa/chuyển trạng thái/link/nhãn/thành phần/đính kèm/triage/trường tuỳ biến/checklist/transition của issue **không phải của mình** (S1). Web ẩn/khoá nút theo quyền hiệu lực **theo dự án** (W1) — member chỉ có quyền ở mức dự án nay thấy "Ghi thời gian", kéo-thả backlog…
- Viewer không còn thấy nút tạo/xoá bộ lọc đã lưu (W3). Burndown kiểm `report:view` theo dự án nên Member hết bị 403 oan (W2).
- Gán assignee phải là thành viên dự án đang hoạt động (kiểm khi thật sự đổi; DEACTIVATED → 422); sprint phải cùng dự án (S3). Việc lặp lại tạo ra không gán nếu assignee đã rời.
- Xoá mềm dự án: issue của nó biến mất khỏi `/issues/:key`, danh sách, tìm kiếm/JQL, tổng quan/dev-links/goals/workload/programs, digest (S6, X1).
- **Dự án lưu trữ = chỉ đọc** ở API (worklog, workflow/trạng thái/transition theo dự án, automation định kỳ (quy tắc chạy theo lịch **bỏ qua im lặng** dự án lưu trữ, không báo lỗi), việc lặp lại, mẫu/quy tắc, dev-link webhook, OKR/SLA/wiki theo dự án, cột mốc/baseline, nhãn, trường tuỳ chỉnh, component/phiên bản, avatar…) và web (tắt kéo-thả, thêm nhanh, nút tạo; phím `c`/Cmd+K không mở dialog trống) (X4). Snapshot sprint của dự án lưu trữ vẫn ghi (chỉ biểu đồ).

**Board / Backlog**
- Kéo-thả: đổi thứ tự trong cột/sprint/backlog và chèn đúng chỗ khi sang cột khác (hai mốc rank, optimistic, Hoàn tác, bàn phím + thông báo tiếng Việt); thả ra ngoài mọi cột = huỷ (X2a/b/c). Cột nhiều trạng thái: hỏi trạng thái đích khi thả (C4). Khôi phục toggle cá nhân "Nhóm theo người" (W5).
- Board Scrum chỉ hiện việc của sprint đang chạy; cột trống dẫn sang Backlog; thêm nhanh gắn sprint đang chạy; Kanban giữ nguyên (X7).
- **Quyền kéo-thả `/move` chặt hơn (đợt cuối):** đổi sprint cần `issue:edit`; thả theo mốc rank (xếp lại thứ tự) cần `issue:edit` hoặc `backlog:manage`. Thiếu quyền mà **không đổi trạng thái** → 403; **có đổi trạng thái** → vẫn chuyển cột nhưng mốc rank bị bỏ (thẻ giữ vị trí cũ trong cột đích). Role mặc định Tester/Reviewer/DevOps có `issue:edit` nên không bị ảnh hưởng — chỉ role **tuỳ biến** có `issue:transition` nhưng không có `issue:edit`/`backlog:manage` (kéo cùng cột sẽ nhận 403).
- **Tạo issue với `statusId` (đợt cuối):** `POST /issues` nếu truyền `statusId` thì trạng thái phải thuộc workflow của dự án (sai → 422); chọn trạng thái khác trạng thái khởi tạo cần thêm quyền `issue:transition` (thiếu → 403). Import Jira chỉ kiểm thuộc workflow, không đòi quyền transition (đã có quyền import riêng). Không truyền `statusId` = hành vi cũ.
- **Sprint đã đóng không nhận việc nữa (đợt cuối):** gán issue vào sprint CLOSED (tạo, sửa, bulk, kéo-thả, `/rank`) → 422; bỏ gán (`sprintId = null`) và sửa field khác của issue đang nằm trong sprint đã đóng vẫn được. Import Jira lịch sử vẫn gắn được sprint đã đóng.
- **`epicId` giờ lưu được (đợt cuối):** `PATCH /issues/:id` với `epicId` trước đây trả 200 nhưng không lưu; nay lưu, `null` gỡ epic, và epic không được là chính issue đó (422).
- **Import JSON báo `skippedAssignees` (đợt cuối):** số issue đã tạo nhưng bị bỏ gán vì assignee không phải thành viên dự án (có trong response `POST /import/json` và `ImportJob.result`).
- **Board có bộ lọc JQL (`filterJql`) sắp theo rank** khi không có `ORDER BY` tường minh (đợt cuối), cùng thứ tự với board không lọc.
- **JQL `statusCategory`** chỉ nhận `=`, `!=`, `IN`, `NOT IN` với giá trị đúng enum (không phân biệt hoa thường; "in progress"/"in-progress" được nhận); còn lại → 422 (đợt cuối).
- `move()` giữ rank khi không có mốc và ghi lịch sử/`ISSUE_UPDATED` khi đổi sprint; đi qua workflow/resolution và phát `ISSUE_TRANSITIONED` (S3) — người dùng có thể nhận thêm thông báo.
- Bulk: đổi status + field khác phát thêm `ISSUE_UPDATED` (assignee nhận thông báo giao việc; **watcher có thể nhận 2 thông báo**) (C3); web chia lô 100 việc/request, lô sau lỗi báo "chưa gửi được — thử lại" (X6).
- `setColumns` khoá Board, lỗi trùng/không tồn tại → 422 tiếng Việt (C9).

**Tìm kiếm / JQL**
- Bỏ dấu tiếng Việt, khớp tiền tố cả mô tả, chịu gõ sai nhẹ (pg_trgm); mã issue không còn nằm trong full-text (khớp bằng ILIKE/trigram: "số 37" không còn khớp DEMO-TASK-37) (X5). Ký tự Unicode loại Lm bị loại khỏi truy vấn. Cmd+K lọc lệnh theo chữ gõ, "Đi tới công việc" xếp đầu.
- JQL `text ~` giới hạn theo dự án, không còn giới hạn top 200, khớp chuỗi con mô tả/mã; escape `%`, `_`, `\`; `!~` trên type/status/priority/sprint/resolution không phân biệt hoa thường và literal `%/_` (C5/X5).
- **Ngữ nghĩa phủ định:** `!~` trên type/status/priority/sprint/resolution **gồm cả bản ghi có giá trị trống** (vd `sprint !~ X` vẫn thấy việc ở backlog). Ngược lại `!=` / `NOT IN` trên quan hệ nullable giữ kiểu Jira: **loại bản ghi EMPTY** — muốn gồm thì viết `… OR x is EMPTY`. (Cố ý, xem follow-ups.)

**UX / khác**
- Hộp thoại giữ hiệu ứng đóng, khôi phục icon tiêu đề, form reset theo lần mở, PlanningPanel focus-trap (W4). Phím `w` ghi thời gian chạy ở cấp trang issue, không kích hoạt khi menu/popover mở (W3). Toast lỗi mutation không lặp (W6). Comment realtime: `comment:updated/deleted` qua WS (C8).
- Worklog: thanh tiến độ không hiện 100% khi chưa có ước lượng, thêm gợi ý đặt ước lượng; biểu đồ báo cáo không cắt nhãn trục Y; AI gợi ý người nhận có lý do cụ thể kèm số liệu, thứ tự ổn định; token motion `duration-fast/base/slow`; trang issue hiện khu "lười" ở dev (StrictMode, X3).
- Token bot Telegram hỏng: báo lỗi + đánh dấu tích hợp ERROR thay vì âm thầm gửi qua bot toàn cục; digest "Chạy ngay" trả 422 gợi ý "Gửi thử" khi tích hợp đang ERROR (S5).
- Import Jira: chống chạy trùng `analyzeId`; job `jira-csv` RUNNING bị kẹt sau restart tự đánh FAILED (theo heartbeat, > ~3 phút không cập nhật) (C6).

### Web (đợt cuối)
<!-- FW-WEB: controller bổ sung sau khi merge -->

## 3. Thay đổi API

Cập nhật trong `docs/design/api-contract.md` (đợt cuối FW-OPS I4).

- **Mới:** `GET /projects/:id/permissions/me` → `{ projectId, permissions[] }` (W1); `POST /issues/:id/rank` (`backlog:manage` + `issue:edit`; chỉ xếp lại/đổi sprint, không đổi trạng thái) (X2a); `PATCH /boards/:id` nhận `type` `KANBAN|SCRUM` (FW12; thiếu quyền `board:manage` → 403, dự án lưu trữ → 422). `POST /import/json` trả thêm `skippedAssignees`. `POST /issues` nhận `statusId` có kiểm workflow/quyền (xem mục 2).
- **Mã lỗi mới:** `409 RANK_NEIGHBORS_STALE` — mốc rank đảo thứ tự; web tự nạp lại, server **không** rebalance cả dự án nữa (C2). Dự án lưu trữ: `422 BUSINESS_RULE_VIOLATION` "Dự án đã lưu trữ — hãy khôi phục dự án trước khi thay đổi" (X4).
- **WS:** `project:ranks_rebalanced` `{ projectId }` (C2); `comment:added|updated|deleted` tới room `project:{projectId}` với payload `{ comment }` (added/updated) và `{ commentId, issueId }` (deleted) (C8). `projectId` chỉ có ở sự kiện domain nội bộ để định tuyến, không nằm trong payload gửi client.
- **Breaking:** `GET /analytics/burndown` **bắt buộc `projectId`** + quyền `report:view` theo dự án; sprint không thuộc dự án → 404. Client gọi chỉ với `sprintId` sẽ lỗi. Burndown dùng "category cuối thắng" như CFD → số liệu có thể khác trước (C1/W2).
- `GET /search` thiếu điều kiện (không `jql`, không `q`) → **422** thay vì trả mọi issue (X5).
- `POST /auth/refresh` không có cookie → `200 { accessToken: null }` thay vì 401 (X6/W6); cookie sai/hết hạn vẫn 401.
- `IssueDto.createdById` (W1). Bulk đổi status + field khác phát thêm `ISSUE_UPDATED` (C3).
- Automation webhook: `actions[].secret` chỉ trả `********`; client bên thứ ba từng đọc khoá này sẽ không lấy lại được (S4).

## 4. Bảo mật

- Ownership `:own` cho mọi route issue còn sót (S1). RAID đổi dự án và link liên dự án kiểm quyền ở dự án ĐÍCH (S2); danh sách link ẩn issue của dự án không xem được/đã xoá (X1); kênh digest ràng theo workspace, từ chối `channelId` rỗng (X1).
- `move()`/bulk kiểm assignee là thành viên và sprint cùng dự án (S3). Xoá mềm dự án ẩn mọi đường đọc issue (S6/X1).
- Webhook automation: chặn 6to4 (`2002::/16`) và Teredo (`2001::/32`), ghim mọi IP đã kiểm tra, timeout bao cả DNS; khoá bí mật lưu mã hoá `enc:v1:…` (S4).
- Token tích hợp không giải mã được không còn rơi về bot toàn cục (S5). Digest claim `lastRunAt` bằng compare-and-set → không gửi đôi khi lệch đồng hồ giữa node (C7).
- Escape `%`, `_`, `\` trong JQL/tìm kiếm; lọc ký tự gây lỗi `to_tsquery` (X5).

## 5. Hiệu năng

- Chỉ mục GIN trigram cho tìm kiếm/JQL `text ~` (thay quét tuần tự); JQL `text ~` không còn kéo top 200 toàn workspace rồi lọc (C5/X5). Chi phí: thêm dung lượng + chút chi phí ghi trên `Issue`.
- Kéo-thả không còn rebalance cả dự án khi mốc cũ (409 + nạp lại thay vì bump version mọi issue) (C2).
- Import Jira parse CSV dạng stream, không chặn event loop (C6). Web chia lô bulk 100 việc/request (X6).
- Đường probe health không ghi log, dựng từ `API_GLOBAL_PREFIX`/`API_VERSION` thay vì hardcode (T3). `issues.service.ts` tách `RankService` (T4, không đổi hành vi).

## 6. Còn mở / cố ý không làm

- **Cố ý (quyết định sản phẩm / ruling):** `!=`/`NOT IN` trên quan hệ nullable giữ ngữ nghĩa Jira; Resources → Allocation và clients → Contract trên dự án lưu trữ vẫn ghi được; snapshot sprint của dự án lưu trữ vẫn ghi; `recoverStaleJobs` chỉ cho job `jira-csv` (import generic mồ côi vẫn kẹt RUNNING như trước C6).
- **Nợ còn lại:** ratchet lint 91 cảnh báo (65 `max-lines-per-function` ở web, 12 `no-unsafe-*` ở api…); `knip.jsonc` còn che `@nestjs/testing` và `AiIssuePanel.tsx` (chưa nối UI). `pnpm knip` thoát 0.
- Đợt cuối phía web (FW7/FW8/FW12/FW13: kéo-thả backlog khi đang lọc, dọn trạng thái kéo-thả, đổi loại board, empty state Scrum) — xem mục "Web (đợt cuối)" ở trên.
