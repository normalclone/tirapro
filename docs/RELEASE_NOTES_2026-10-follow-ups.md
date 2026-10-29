# Release notes — đợt follow-up 2026-10 (`fix/review-findings`)

Gộp toàn bộ thay đổi của nhánh (base `22c116c`) — phần follow-up này: 35 task (26 task kế hoạch: S1-S6, C1-C9, W1-W6, T1-T5; 9 task nhóm X: X1, X2a/b/c, X3-X7) + đợt sửa cuối (FW). Chi tiết từng mục: `docs/superpowers/plans/2026-10-15-follow-ups.md`.

> **Vòng UX 2 (143 task, 28 migration) nằm ở phần cuối file** (mục "UX vòng 2", có đủ 5 phần: triển khai, hành vi, API, bảo mật, còn mở). Đọc cả hai phần khi nâng cấp từ bản trước đợt follow-up.

> **Chuẩn hoá giao diện đợt 1 (2026-10-18) là phần cuối cùng của file** (mục "Giao diện đợt 1": triển khai, thay đổi người dùng thấy, còn mở). Không đổi cơ sở dữ liệu; cần triển khai lại cả web lẫn API.

> **Merge PR bằng merge commit (không squash, không rebase-merge).** `.git-blame-ignore-revs` trỏ tới SHA `4fa8273…` của commit `prettier --write` toàn repo (T5); squash/rebase đổi SHA thì file này vô hiệu và `git blame` ngập trong diff format. Sau khi clone/pull chạy một lần: `git config blame.ignoreRevsFile .git-blame-ignore-revs`. Nhánh đang mở cần rebase lên sau commit format.

## 1. Cần làm khi triển khai

Checklist đầy đủ (thứ tự, lệnh theo từng môi trường): `docs/DEPLOY.md` mục "Checklist triển khai / nâng cấp".

1. **Phần follow-up (S/C/W/T/X/FW) không thêm migration riêng; vòng UX 2 của cùng PR thêm 28 migration** (bảng đầy đủ ở mục "UX vòng 2 → 1. Cần làm khi triển khai" cuối file; trong đó `remove_invites` **xoá** bảng `InviteToken` + mọi thư mời trong `EmailOutbox`, `mention_unique` xoá dòng `Mention` trùng, backfill wiki nhân đôi dung lượng nội dung wiki). Ngoài ra `migrate deploy` có thể áp 6 migration của base `22c116c` nếu prod chưa từng chạy** (kiểm `prisma migrate status`): `sprint_sequence_unique`, `perf_indexes`, `mail_invite_reset`, `project_archive`, `worklog_rules`, `ai_log_index`. Hệ quả: `project_archive` đặt `archivedAt = updatedAt` cho dự án đang `isArchived` → các dự án đó thành **chỉ-đọc và bị ẩn**; `perf_indexes` dùng `CREATE INDEX` thường trên `Issue` → **khoá ghi bảng `Issue` lúc build** (cửa sổ bảo trì); `sprint_sequence_unique` **đánh lại số** sprint trùng `(projectId, sequence)`; `worklog_rules` **cấp quyền** (INSERT vào `RolePermission`): mọi role đã có `issue:edit` nhận `worklog:create|update|delete`, role có `project:admin`/`workspace:admin` nhận `automation:manage`, đồng thời xoá `WorkLog_issueId_idx` (thay bằng chỉ mục kép), thêm giá trị enum `HistoryField.TIME_SPENT` và tạo bảng automation; `perf_indexes` xoá `RefreshToken_tokenHash_idx` (đã có UNIQUE index). Thứ tự: `prisma migrate deploy` → `db:raw` → (chỉ khi đổi khoá mã hoá) `integrations:rekey` → `automation:seal-secrets`. Render/Docker tự chạy `migrate deploy` + `db:raw` mỗi lần khởi động; hai script cuối luôn chạy tay.
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
- Xoá mềm dự án: sprint, board, nhãn, thành phần, phiên bản, việc lặp lại (và burndown, sprint-assistant, phân bổ nguồn lực) của dự án đó trả **404** thay vì còn truy cập được; issue của nó biến mất khỏi `/issues/:key`, danh sách, tìm kiếm/JQL, tổng quan/dev-links/goals/workload/programs, digest (S6, X1).
- **Dự án lưu trữ = chỉ đọc** ở API (worklog, workflow/trạng thái/transition theo dự án, automation định kỳ (quy tắc chạy theo lịch **bỏ qua im lặng** dự án lưu trữ, không báo lỗi), việc lặp lại, mẫu/quy tắc, dev-link webhook, OKR/SLA/wiki theo dự án, cột mốc/baseline, nhãn, trường tuỳ chỉnh, component/phiên bản, avatar…) và web (tắt kéo-thả, thêm nhanh, nút tạo; phím `c`/Cmd+K không mở dialog trống) (X4). Snapshot sprint của dự án lưu trữ vẫn ghi (chỉ biểu đồ).

**Board / Backlog**
- Kéo-thả: đổi thứ tự trong cột/sprint/backlog và chèn đúng chỗ khi sang cột khác (hai mốc rank, optimistic, Hoàn tác, bàn phím + thông báo tiếng Việt); thả ra ngoài mọi cột = huỷ (X2a/b/c). Cột nhiều trạng thái: hỏi trạng thái đích khi thả (C4). Khôi phục toggle cá nhân "Nhóm theo người" (W5).
- Board Scrum chỉ hiện việc của sprint đang chạy; cột trống dẫn sang Backlog; thêm nhanh gắn sprint đang chạy; Kanban giữ nguyên (X7).
- **Quyền `POST /issues/:id/move` chặt hơn (đợt cuối):** thả theo mốc rank (xếp lại thứ tự) cần `issue:edit` hoặc `backlog:manage` — thiếu quyền mà **có đổi trạng thái** thì vẫn chuyển cột nhưng mốc rank bị bỏ (thẻ giữ rank hiện tại), còn **không đổi trạng thái** → 403. **Đổi sprint** cần `issue:edit` (hoặc `issue:edit:own` và là chủ issue) — thiếu thì 403 **kể cả khi có đổi trạng thái**. Role mặc định Tester/Reviewer/DevOps có `issue:edit` nên không bị ảnh hưởng — chỉ role **tuỳ biến** có `issue:transition` nhưng không có `issue:edit`/`backlog:manage` (kéo cùng cột sẽ nhận 403; web đã ẩn đường kéo này, xem mục Web).
- **Tạo issue với `statusId` (đợt cuối):** `POST /issues` nếu truyền `statusId` thì trạng thái phải thuộc workflow của dự án (sai → 422); chọn trạng thái khác trạng thái khởi tạo cần thêm quyền `issue:transition` (thiếu → 403). Import Jira chỉ kiểm thuộc workflow, không đòi quyền transition (đã có quyền import riêng). Không truyền `statusId` = hành vi cũ.
- **Sprint đã đóng không nhận việc nữa (đợt cuối):** gán issue vào sprint CLOSED (tạo, sửa, bulk, kéo-thả, `/rank`) → 422; bỏ gán (`sprintId = null`) và sửa field khác của issue đang nằm trong sprint đã đóng vẫn được. Import Jira lịch sử vẫn gắn được sprint đã đóng.
- **`epicId` giờ lưu được — và bị kiểm chặt (đợt cuối; có thể làm vỡ client API):** `PATCH /issues/:id` với `epicId` trước đây trả 200 nhưng không lưu; nay lưu, `null` gỡ epic. Cả `POST /issues` và `PATCH` (chỉ khi `epicId` **đổi**) kiểm: epic ngoài workspace → **404**; epic khác dự án → **422**; epic phải là loại Epic (`IssueType.key = EPIC` hoặc `hierarchyLevel >= 1`) → **422**; không tự trỏ vào chính nó → **422**; không tạo chu trình trực tiếp/gián tiếp → **422**. Client từng gửi `epicId` bị bỏ qua thầm lặng (epic khác dự án, loại không phải Epic…) nay sẽ nhận lỗi. Đường **import Jira** bỏ kiểm loại Epic nhưng giữ cùng dự án / không tự trỏ / không chu trình; import Jira tạo loại Epic mới với `hierarchyLevel = 1` (và `key = EPIC` nếu workspace chưa có loại key EPIC).
- **Import JSON báo `skippedAssignees` (đợt cuối):** số issue đã tạo nhưng bị bỏ gán vì assignee không phải thành viên dự án (có trong response `POST /import/json` và `ImportJob.result`).
- **Board có bộ lọc JQL (`filterJql`) sắp theo rank** khi không có `ORDER BY` tường minh (đợt cuối), cùng thứ tự với board không lọc.
- **JQL `statusCategory`** chỉ nhận `=`, `!=`, `IN`, `NOT IN` với giá trị đúng enum (không phân biệt hoa thường; "in progress"/"in-progress" được nhận); còn lại → 422 (đợt cuối).
- `move()` giữ rank khi không có mốc và ghi lịch sử/`ISSUE_UPDATED` khi đổi sprint; đi qua workflow/resolution và phát `ISSUE_TRANSITIONED` (S3) — người dùng có thể nhận thêm thông báo.
- Bulk: đổi status + field khác phát thêm `ISSUE_UPDATED` (assignee nhận thông báo giao việc; **watcher có thể nhận 2 thông báo**) (C3); web chia lô 100 việc/request, lô sau lỗi báo "chưa gửi được — thử lại" (X6).
- `setColumns` khoá Board, lỗi trùng/không tồn tại → 422 tiếng Việt (C9).

**Tìm kiếm / JQL**
- Tìm kiếm cắt chuỗi theo **code point** (không còn sinh ký tự surrogate cụt khi cắt emoji/chữ ngoài BMP ở ngưỡng 40/200 ký tự); đường phòng thủ lỗi 42601 có ghi log cảnh báo (tối đa 1 lần/10 phút, không ghi nội dung tìm).
- Bỏ dấu tiếng Việt, khớp tiền tố cả mô tả, chịu gõ sai nhẹ (pg_trgm); mã issue không còn nằm trong full-text (khớp bằng ILIKE/trigram: "số 37" không còn khớp DEMO-TASK-37) (X5). Ký tự Unicode loại Lm bị loại khỏi truy vấn. Cmd+K lọc lệnh theo chữ gõ, "Đi tới công việc" xếp đầu.
- JQL `text ~` giới hạn theo dự án, không còn giới hạn top 200, khớp chuỗi con mô tả/mã; escape `%`, `_`, `\`; `!~` trên type/status/priority/sprint/resolution không phân biệt hoa thường và literal `%/_` (C5/X5).
- **Ngữ nghĩa phủ định:** `!~` trên type/status/priority/sprint/resolution **gồm cả bản ghi có giá trị trống** (vd `sprint !~ X` vẫn thấy việc ở backlog). Ngược lại `!=` / `NOT IN` trên quan hệ nullable giữ kiểu Jira: **loại bản ghi EMPTY** — muốn gồm thì viết `… OR x is EMPTY`. (Cố ý, xem follow-ups.)

**UX / khác**
- Hộp thoại giữ hiệu ứng đóng, khôi phục icon tiêu đề, form reset theo lần mở, PlanningPanel focus-trap (W4). Phím `w` ghi thời gian chạy ở cấp trang issue, không kích hoạt khi menu/popover mở (W3). Toast lỗi mutation không lặp (W6). Comment realtime: `comment:updated/deleted` qua WS (C8).
- Worklog: thanh tiến độ không hiện 100% khi chưa có ước lượng, thêm gợi ý đặt ước lượng; biểu đồ báo cáo không cắt nhãn trục Y; AI gợi ý người nhận có lý do cụ thể kèm số liệu, thứ tự ổn định; token motion `duration-fast/base/slow`; trang issue hiện khu "lười" ở dev (StrictMode, X3).
- Token bot Telegram hỏng: báo lỗi + đánh dấu tích hợp ERROR thay vì âm thầm gửi qua bot toàn cục; digest "Chạy ngay" trả 422 gợi ý "Gửi thử" khi tích hợp đang ERROR (S5).
- Import Jira: chống chạy trùng `analyzeId`; job `jira-csv` RUNNING bị kẹt sau restart tự đánh FAILED (theo heartbeat, > ~3 phút không cập nhật) (C6).

### Web (đợt cuối)
- **Dự án lưu trữ chỉ-đọc ở mọi màn:** trang chi tiết issue (có banner "chỉ đọc", không còn Tạo việc con/Nhân bản/Ghi thời gian/ô bình luận), các panel (thuộc tính, mô tả, nhãn, checklist, người tham gia), Gantt, Triage, Board, Backlog và Cmd+K (không còn Đổi trạng thái/Giao cho tôi/Thêm bình luận). Nút khôi phục dự án vẫn dành cho quản trị dự án.
- **Mọi lối tạo việc theo quyền `issue:create` + dự án chưa lưu trữ:** nút Tạo ở thanh dự án, phím `c`, Cmd+K, nút nổi (kể cả "Tạo bằng AI") cùng dùng một nguồn quyết định; thiếu quyền thì ẩn/báo ngắn. Ở trang `/issue/:key`, đích tạo là dự án của issue đang xem.
- **Phím tắt toàn cục không bắt phím khi có overlay mở** (menu, popover, dialog không còn bị cướp `c`/`g`/`?`/`/`); `Esc` trong thanh thao tác hàng loạt bỏ chọn đúng lúc.
- **Kéo-thả board/backlog theo đúng quyền rank:** người dùng thiếu quyền xếp thứ tự chỉ còn đổi được trạng thái (kéo sang cột khác, không gửi mốc); kéo đổi thứ tự cùng cột mà thiếu quyền hiện thông báo thay vì gọi API rồi nhận 403. Backlog chọn route `rank` (cần `backlog:manage` + `issue:edit`) hoặc `move` (cần `issue:transition` + `issue:edit`/`backlog:manage`) theo quyền thật; đổi sprint mà không sửa được issue bị chặn kèm thông báo.
- **Backlog khi đang lọc:** thả vào giữa khối việc bị ẩn bởi bộ lọc nay rơi ngay sau mốc trên, không lọt giữa khối ẩn. **Board:** thả bị workflow chặn không còn hiện vạch/viền chèn và báo "không chuyển được — quy trình không cho phép"; dọn trạng thái kéo-thả khi rời trang giữa lúc kéo.
- **Đổi loại board Scrum ⇄ Kanban** trong cài đặt bảng (tab "Loại bảng", cần `board:manage`). **Board Scrum rỗng:** người không có `sprint:manage` thấy "Nhờ quản trị dự án bắt đầu một sprint." (vẫn có nút "Mở Backlog"); swimlane khi sprint chạy chưa có việc: "Sprint này chưa có việc nào. Thêm việc từ Backlog."
- **Kết quả import hiển thị `skippedAssignees`:** toast "N người phụ trách không khớp thành viên nào — đã bỏ gán (việc vẫn được nhập)."
- Dialog dùng token motion `duration-base/fast`; nút tạo/AI có skeleton khi dự án hoặc quyền đang tải (không nhảy bố cục).

### Chỉnh cuối sau smoke test (P1–P5)

- Tạo việc (phím `c`, Cmd+K, nút nổi) khi đang ở dự án lưu trữ: không còn tự chọn dự án đầu danh sách — chọn dự án hoạt động dùng gần nhất, không có thì để trống ô Dự án kèm gợi ý.
- Toast "Hoàn tác" sau khi chuyển trạng thái (board, trang chi tiết, phím số, Cmd+K) chỉ hiện khi bước ngược hợp lệ theo workflow.
- Trang Quy tắc tự động: không gọi API cho dự án thiếu quyền (hết lỗi 403 đỏ); dự án mặc định là dự án có quyền; người không thuộc dự án nào thấy câu riêng.
- Panel Thời gian: chưa đặt "ước lượng còn lại" thì hiện ước tính = gốc − đã ghi (ghi rõ "ước tính").
- Nhập Jira: người phụ trách không khớp thành viên được đếm và liệt kê (`skippedAssignees`, cảnh báo); người được chủ động chọn "Để trống" đếm riêng (`blankedAssignees`, không cảnh báo). Nhập CSV đơn giản vẫn không đọc cột assignee.

## 3. Thay đổi API

Cập nhật trong `docs/design/api-contract.md` (đợt cuối FW-OPS I4).

- **Mới:** `GET /projects/:id/permissions/me` → `{ projectId, permissions[] }` (W1); `POST /issues/:id/rank` (`backlog:manage` + `issue:edit`; chỉ xếp lại/đổi sprint, không đổi trạng thái) (X2a); `PATCH /boards/:id` nhận `type` `KANBAN|SCRUM` (FW12; thiếu quyền `board:manage` → 403, dự án lưu trữ → 422). `POST /import/json` trả thêm `skippedAssignees`. `POST /issues` nhận `statusId` có kiểm workflow/quyền (xem mục 2).
- **Mã lỗi mới:** `409 RANK_NEIGHBORS_STALE` — mốc rank đảo thứ tự; web tự nạp lại, server **không** rebalance cả dự án nữa (C2). Dự án lưu trữ: `422 BUSINESS_RULE_VIOLATION` "Dự án đã lưu trữ — hãy khôi phục dự án trước khi thay đổi" (X4).
- **WS:** `project:ranks_rebalanced` `{ projectId }` (C2); `comment:added|updated|deleted` tới room `project:{projectId}` với payload `{ comment }` (added/updated) và `{ commentId, issueId }` (deleted) (C8). `projectId` chỉ có ở sự kiện domain nội bộ để định tuyến, không nằm trong payload gửi client.
- **Breaking:** `GET /analytics/burndown` **bắt buộc `projectId`** + quyền `report:view` theo dự án; sprint không thuộc dự án → 404. Client gọi chỉ với `sprintId` sẽ lỗi. Burndown dùng "category cuối thắng" như CFD → số liệu có thể khác trước (C1/W2).
- **Breaking nhẹ:** `POST /issues` / `PATCH /issues/:id` kiểm `epicId` chặt (404/422, xem mục 2); `POST /issues` với `statusId` ngoài workflow → 422, trạng thái không khởi tạo thiếu `issue:transition` → 403; gán sprint đã đóng → 422; JQL `statusCategory` sai toán tử/giá trị → 422.
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
- Bulk update chạy trong transaction với timeout 30 giây (`maxWait` 10 giây) nên lô lớn không còn hết hạn giữa chừng (đợt cuối).
- Import Jira parse CSV dạng stream, không chặn event loop (C6). Web chia lô bulk 100 việc/request (X6).
- Đường probe health không ghi log, dựng từ `API_GLOBAL_PREFIX`/`API_VERSION` thay vì hardcode (T3). `issues.service.ts` tách `RankService` (T4, không đổi hành vi).

## 6. Còn mở / cố ý không làm

- Trang Quy tắc với người không quản trị workspace tra `GET /projects/:id/permissions/me` theo đợt 5 dự án tới khi gặp dự án có quyền (tối đa một request mỗi dự án) — nên có endpoint gộp quyền nhiều dự án nếu workspace rất nhiều dự án.

- **Cố ý (quyết định sản phẩm / ruling):** `!=`/`NOT IN` trên quan hệ nullable giữ ngữ nghĩa Jira; Resources → Allocation và clients → Contract trên dự án lưu trữ vẫn ghi được; snapshot sprint của dự án lưu trữ vẫn ghi; `recoverStaleJobs` chỉ cho job `jira-csv` (import generic mồ côi vẫn kẹt RUNNING như trước C6).
- **Nợ còn lại:** ratchet lint 91 cảnh báo (65 `max-lines-per-function` ở web, 12 `no-unsafe-*` ở api…); `knip.jsonc` còn che `AiIssuePanel.tsx` (chưa nối UI) và còn dòng ignore `@nestjs/testing` đã thừa (từ vòng 2 `link-codes.service.spec.ts` dùng nó — gỡ dòng đó khi chạm `knip.jsonc`). `pnpm knip` thoát 0.

---

# UX vòng 2 (2026-10-16)

Gộp vào PR #1 (`fix/review-findings`), đè lên đợt follow-up ở trên. Base của vòng này là `a4e8333`; 143 task (nhóm A cộng tác/Markdown/wiki, B công việc/Việc chờ/Epic, Q báo lỗi/QA, P người dùng/quản trị/dự án riêng tư, L lãnh đạo/báo cáo/OKR/dashboard, U vỏ ứng dụng/thuật ngữ/mobile, F góp ý người dùng); 28 migration; 349 commit. Đặc tả: `docs/superpowers/specs/2026-10-16-ux-round2.md` (28 quyết định + B1–B4). Thứ tự triển khai chi tiết: `docs/DEPLOY.md` mục "Checklist triển khai / nâng cấp".

## 1. Cần làm khi triển khai

1. **Thứ tự:** sao lưu DB → `prisma migrate deploy` (28 migration vòng 2; nếu prod chưa từng áp đợt follow-up thì áp luôn cả 6 migration của base `22c116c`, tổng 34) → `db:raw` (vòng 2 **không đổi** file SQL thô; vẫn là no-op sau lần đầu của đợt follow-up) → khởi động API → `db:check-roles` (tuỳ chọn) → build web → `integrations:rekey` / `automation:seal-secrets` (chỉ khi cần, như đợt trước). Render/Docker tự chạy `migrate deploy` + `db:raw` khi khởi động.
2. **Không có migration nào ghi lại bảng `Issue`.** Chỉ có 2 `ADD COLUMN` nullable (`Issue.acceptanceCriteria`, `Issue.environment`) — đổi metadata, khoá `ACCESS EXCLUSIVE` rất ngắn nhưng phải chờ giao dịch dài đang chạy. Khoá ghi đáng kể duy nhất là `CREATE INDEX` thường trên bảng nối `IssueComponent`/`IssueFixVersion` và hai unique index trên `Mention`. Không cần cửa sổ bảo trì như `db:raw` của đợt trước.
3. **28 migration, theo thứ tự áp (tên thư mục trong `apps/api/prisma/migrations`):**

| Migration                                                                           | Làm gì / khoá / backfill                                                                                                                                                                                      |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `20261016110000_membership_roles_backfill`                                          | Backfill: thêm dòng nối vai trò cho mọi membership workspace/dự án chưa có dòng nối (sửa "Chưa có vai trò"); idempotent, quét 2 bảng membership.                                                              |
| `20261016111000_audit_log`                                                          | Bảng mới `AuditLog` + 3 chỉ mục; không đụng bảng cũ.                                                                                                                                                          |
| `20261016112000_remove_invites`                                                     | **Không hoàn tác:** xoá mọi thư `template='invite'` trong `EmailOutbox` (mọi trạng thái) và `DROP TABLE "InviteToken"`.                                                                                       |
| `20261016113000_user_sessions_revoked_at`                                           | `User.sessionsRevokedAt` (nullable, đổi metadata).                                                                                                                                                            |
| `20261016114000_project_private`                                                    | `Project.isPrivate` (mặc định `false`) + chỉ mục `(workspaceId, isPrivate)`; bảng `Project` nhỏ.                                                                                                              |
| `20261016115000_system_roles_refresh`                                               | **Cấp quyền:** Scrum Master +`issue:create`,`issue:triage`; Product Owner +`issue:transition` (chỉ vai trò hệ thống; vai tuỳ biến cùng tên không đổi, không thu hồi gì). Đổi mô tả vai "Project Developer".    |
| `20261016116000_project_workflow_names`                                             | UPDATE tên quy trình mặc định của dự án (3 tên mẫu) thành `"tên (MÃ-DỰ-ÁN)"`; không đụng quy trình người dùng tự đặt.                                                                                         |
| `20261016120000_issue_component_version_index`                                      | 2 `CREATE INDEX` thường trên `IssueComponent.componentId`, `IssueFixVersion.versionId` (khoá ghi hai bảng nối trong lúc build).                                                                               |
| `20261016120100_history_description`                                                | Enum `HistoryField` + `DESCRIPTION`.                                                                                                                                                                          |
| `20261016120150_history_component_version`                                          | Enum `HistoryField` + `COMPONENT`, `FIX_VERSION`.                                                                                                                                                             |
| `20261016120200_link_types_causes_tests`                                            | Backfill: thêm loại liên kết `Causes`/`Tests` cho mọi workspace đang có (idempotent).                                                                                                                         |
| `20261016140000_issue_environment`                                                  | `Issue.environment JSONB` (nullable, đổi metadata).                                                                                                                                                           |
| `20261016201000_project_health`                                                     | Enum `ProjectHealth` + 4 cột ghi đè sức khoẻ trên `Project` (+ FK người cập nhật).                                                                                                                            |
| `20261016206000_import_pending_assignee`                                            | Bảng mới `ImportPendingAssignee` (email người phụ trách Jira chưa có tài khoản).                                                                                                                              |
| `20261016207000_link_token_integration`                                             | `ChannelLinkToken.integrationId` + FK + chỉ mục (mã liên kết nhóm Telegram theo tích hợp).                                                                                                                    |
| `20261016299000_mention_unique`                                                     | Xoá dòng `Mention` trùng (giữ dòng cũ nhất) rồi tạo 2 unique index (một partial) → **khoá ghi bảng `Mention`** trong lúc build.                                                                               |
| `20261016300000_issue_acceptance_criteria`                                          | `Issue.acceptanceCriteria TEXT` (nullable, đổi metadata).                                                                                                                                                     |
| `20261016301000_wiki_project_permissions`                                           | **Cấp quyền:** `wiki:manage` chuyển scope PROJECT; thêm cho Project Admin/BA/PO/Scrum Master/Developer/Tester và mọi vai tuỳ biến đã có `project:admin` hoặc `workspace:admin`.                                |
| `20261016301500_wiki_page_version`                                                  | `WikiPage.version INT DEFAULT 0` (khoá lạc quan).                                                                                                                                                             |
| `20261016302000_wiki_page_issue`                                                    | Bảng `WikiPageIssue` + **backfill** trích mã công việc từ nội dung mọi trang wiki (`regexp_matches`, tốn CPU theo tổng dung lượng wiki, hash-join với `Issue`).                                               |
| `20261016303000_wiki_page_history`                                                  | Bảng `WikiPageVersion` + **backfill** mỗi trang wiki một bản v1 "Bản trước khi bật lịch sử" (sao chép `body` → dung lượng wiki tăng gấp đôi một lần).                                                         |
| `20261016304000_wiki_soft_delete`                                                   | `WikiPage.deletedAt/deletedById` + chỉ mục (xoá mềm trang wiki).                                                                                                                                              |
| `20261016310000_key_result_source`                                                  | Enum `KeyResultSource` + `KeyResult.source` (mặc định `MANUAL`) + `sourceConfig`.                                                                                                                             |
| `20261016311000_key_result_checkin`                                                 | `KeyResult.unitLabel` + bảng `KeyResultCheckIn`.                                                                                                                                                              |
| `20261016312000_key_result_snapshot`                                                | Enum `CheckInSource` + `snapshotDate`/`source` + unique `(keyResultId, snapshotDate)` (cron chụp hằng ngày).                                                                                                  |
| `20261016313000_digest_private_channel`                                             | `ReportSubscription.allowPrivateToChannel` (mặc định `false`).                                                                                                                                                |
| `20261016314000_dashboard_team_scope`                                               | `ALTER TYPE … ADD VALUE` (`DashboardScope.TEAM`, `WidgetType` `TOP_RISKS`/`SLOW_GOALS`/`OVERLOAD`; cần PG ≥ 12 để chạy trong giao dịch migration) + `Dashboard.teamId` FK + chỉ mục.                          |
| `20261016315000_digest_schedule_fields`                                             | `weekday`/`hour`/`timezone`/`deliverEmail` có giá trị mặc định: báo cáo cũ thành "thứ Hai 08:00 giờ Việt Nam".                                                                                                |

4. **Mốc thời gian migration không đơn điệu** (vd `…299000` đứng sau `…207000`, `…3xxxxx` đứng sau `…2xxxxx`): `migrate deploy` vẫn áp mọi migration chưa áp theo thứ tự tên, không cần `migrate dev`. Một số migration bị đổi tên trong lúc làm (L5 `…200000`→`…314000`, L20 `…202000`→`…315000`, OKR `…203000/204000/208000`→`…310000/311000/312000`): DB dev nào đã áp bằng tên tạm cũ sẽ lệch lịch sử — dựng lại DB đó.
5. **Biến môi trường:** API **không có biến mới**. Web (build-time): `VITE_FEATURE_REPOS=1` (mới, tuỳ chọn) bật lại mục Kho mã + khối "Liên kết code" — mặc định **ẩn** (quyết định #5). `VITE_SHOW_DEMO_ACCOUNTS=true` giờ là điều kiện duy nhất để bản production hiện khối "Tài khoản demo" (không đặt = bản build không chứa mật khẩu demo; dev luôn hiện). `.env.example` đã cập nhật.
6. **Không chạy `db:seed` trên môi trường có dữ liệu thật** — nó làm mới (xoá) workspace demo. Vòng 2 **không cần seed lại**: quyền vai trò hệ thống đi qua migration `115000`/`301000` (kiểm bằng `pnpm --filter @tirapro/api run db:check-roles`, thoát 1 nếu lệch). Mô tả quyền tiếng Việt ở bảng `Permission` chỉ cập nhật khi chạy `db:seed`, nhưng web đọc mô tả từ `@tirapro/types` nên không ảnh hưởng. Năm tour mặc định và checklist "Bắt đầu" được API tự gieo lúc khởi động (`GuidesBootstrapService`, khoá advisory, không hạ cấp bản mới hơn).
7. **Cache quyền (RBAC, Redis) hết hạn tối đa ~1 phút sau migration** cấp quyền; trong lúc đó người dùng có thể chưa thấy quyền mới (wiki, tạo việc của Scrum Master…).
8. **Telegram: dùng một bot riêng cho Tirapro.** Wizard liên kết nhóm đọc tin bằng `getUpdates` (offset âm, `allowed_updates=['message']`). Công cụ ngoài cũng đọc `getUpdates` trên cùng bot (vd bot chung, công cụ Telegram của Claude) có thể mất tin cũ hơn 100 bản mới nhất hoặc gặp 409; ngược lại Tirapro báo 409 nếu bot đang gắn webhook hoặc có tiến trình khác đang đọc. Kết nối Telegram không token khi hệ thống không có bot chung (`TELEGRAM_BOT_TOKEN`) bị từ chối; kết nối cũ hiện "Chưa có bot / Chưa có kênh" thay vì "Hoạt động".
9. **Giả định một tổ chức cho pool người dùng chung** (quyết định #1): quản trị workspace thấy và thêm được người từ **toàn bộ** tài khoản hệ thống. Cài đặt nhiều tổ chức độc lập + cho phép tự đăng ký sẽ cho phép chiếm tài khoản/nhìn thấy người dùng giữa các workspace — chỉ triển khai kiểu này cho nội bộ một tổ chức (hoặc tắt đăng ký).
10. **Tác vụ nền mới:** digest chạy `0 * * * *` (mỗi giờ, so khớp thứ/giờ/múi giờ từng báo cáo; trước đây một lần/ngày) và tự gửi khi kết thúc sprint (**digest hiện có trên máy chủ UTC đến sớm 7 giờ**: trước chạy 08:00 giờ tiến trình = UTC, nay 08:00 `Asia/Ho_Chi_Minh`); cron chụp giá trị Key Result `01:30 UTC` hằng ngày (khoá Redis, idempotent theo ngày UTC). Cron dùng khoá Redis; không có Redis thì chạy ở chế độ một node (không khoá) — đừng chạy nhiều instance API mà thiếu Redis, digest/chụp KR sẽ chạy trùng.
11. **Email digest/đặt lại mật khẩu đi qua `MAIL_DRIVER`**: `console` chỉ ghi log; `smtp` mới là khung (chưa cài thư viện gửi) và ném lỗi khi gửi — nên báo cáo định kỳ qua Email chưa gửi thật được trong bản này; kênh Telegram thì chạy.
12. **Rollback:** sau khi người dùng đã dùng bản mới không nên quay lại image cũ — `InviteToken` đã bị xoá, enum `HistoryField` có giá trị mới (`DESCRIPTION`/`COMPONENT`/`FIX_VERSION`), `wiki:manage` đã đổi scope và quyền đã cấp (suy ra từ cấu trúc migration, chưa thử rollback thật). Sao lưu DB trước bước 1 là đường lùi duy nhất.
13. **Đợt sửa cuối (review toàn nhánh) không thêm migration và không đổi `db:raw`.** Có thêm sự kiện domain `access.changed` và `issue.bulk_updated` (nội bộ, không cần cấu hình). Image runtime Docker nay copy thêm `scripts/check-system-roles.mjs` (để chạy `db:check-roles` trong container); `.env.example`/`render.yaml` không còn nhắc "liên kết mời".

## 2. Thay đổi hành vi người dùng thấy

**Công việc / Việc chờ / Board**

- **Xem nhanh:** click dòng ở Việc chờ/Việc mới vào, hoặc thẻ ở Board, mở panel bên phải (`?peek=`, Esc đóng, nút "Mở trang"); Cmd/Ctrl+click hoặc mã công việc (link thật) mở trang đầy đủ; Enter trên dòng đang focus mở panel (B1–B4).
- **Dòng Việc chờ:** icon loại + pill trạng thái, sửa điểm/ưu tiên tại dòng; chip lọc "Chỉ Bug" và "Tôi báo cáo"; thanh hàng loạt thêm Đặt điểm / Đặt ưu tiên / Gắn nhãn / Gắn epic / Đổi trạng thái (có Hoàn tác) (B7, B8, B10, B11).
- **Điểm ước lượng:** ai có `issue:edit` (hoặc `issue:edit:own` với việc của mình) sửa được điểm, kể cả hàng loạt — trước đây chỉ người tạo/quản trị; Hạn và Ngày bắt đầu vẫn chỉ người tạo/quản trị. Sửa điểm của việc Done/sprint đã đóng hỏi xác nhận (B3, B9).
- **Thêm nhanh / hộp tạo việc:** hiểu token (`!` ưu tiên, `@` người, `#` sprint, `~` điểm, `^` hạn), có chọn loại; bí danh tiếng Việt cho ưu tiên (khẩn, cao, trung bình, thấp, rất thấp); token không khớp được tô và báo (vẫn tạo); ô tiêu đề đồng bộ từng phần với ô chọn; **⌘/Ctrl+Enter luôn tạo việc** (trước đây khi popup gợi ý mở thì "chọn gợi ý" — dùng Enter/Tab để chọn) (B12–B14).
- **Epic:** ô "Epic / Việc cha" có tìm kiếm không dấu ở trang công việc và hộp tạo; panel Epic bên trái Việc chờ (lọc, kéo việc vào epic, tiến độ theo điểm, ẩn epic đã xong); Cây việc kéo-thả đổi Epic/Việc cha và cộng dồn điểm "đã xong/tổng"; mở panel Epic thì thanh dự án thu tạm và ngược lại (B5, B6, B15, B16, B21, B22, F2).
- **Thành phần/Phiên bản:** chip thêm/bỏ thật cho từng việc (có lịch sử), lọc được bằng JQL `component`, `fixVersion`, `affectedVersion` (B17, B18).
- **Liên kết:** tìm theo mã/tiêu đề không dấu, chọn chiều, hiện trạng thái đích; thêm loại `Causes`/`Tests` ("gây ra"/"được kiểm thử bởi") (B23, B24).
- **Lịch sử:** ghi sửa mô tả (xem diff, lọc theo loại thay đổi) **từ bản này trở đi** — mô tả cũ không có lịch sử (B19, B20).
- **Markdown (GFM):** checklist tick được (lưu ngược vào mô tả/bình luận của tác giả), bảng, nút Checklist/Bảng; **mỗi cú tick mô tả = một lần ghi mô tả** (tăng `version`, bắn `issue.updated`, có thể có thông báo theo dõi — đã gộp 60 giây); khối "Tiêu chí chấp nhận" riêng cho Story, thẻ/dòng hiện "x/y đạt" (A1–A7).
- **Bình luận:** nút Bình luận đặt con trỏ vào ô, phím `m` (A17). **@mention** có popup tìm không dấu bằng bàn phím, chip, ở cả bình luận và mô tả; người được nhắc nhận thông báo kèm trích đoạn (A2, A3).
- **Ngày bắt đầu** trên công việc (sửa tại panel Ngày); Gantt kéo/đổi cỡ thanh để đổi ngày (cả bằng bàn phím), danh sách "Chưa lên lịch"; ngày bắt đầu sau hạn bị chặn (L14, L15).
- **Chuyển trạng thái:** nút mang tên transition ("Trả lại → In Progress"); sang nhóm Done hỏi **Resolution** (mặc định chọn sẵn); Mở lại/Trả lại hỏi lý do (lưu thành bình luận, tạo thêm một thông báo). Hoàn tác chỉ hiện khi bước ngược hợp lệ (Q3–Q5).

**Báo lỗi + Việc mới vào (triage)**

- **Một form Báo lỗi / Gửi yêu cầu** (Cmd+K, header Board, nút nổi): chọn loại Bug/Yêu cầu tính năng/Câu hỏi, chế độ **Cơ bản** (tiêu đề + mô tả ngắn) / **Nâng cao** (Mức nghiêm trọng, Môi trường, mẫu tái hiện, ảnh) nhớ theo người; Môi trường có cấu trúc (trình duyệt/OS/build/URL, tự điền) (Q6–Q8, F3).
- **Gợi ý trùng** (bỏ dấu/trigram): "Thêm ghi chú vào bug cũ" (nội dung → bình luận, người báo → watcher) hoặc "Vẫn tạo mới"; tiêu đề giống hệt bug còn mở tự gộp; bug đã bị Từ chối mà có báo trùng thì quay lại hàng chờ duyệt (việc đang làm/đã đóng không bị ẩn) (Q7, Q9, Q10).
- **Mức nghiêm trọng (Severity)** cho Bug: huy hiệu ở thẻ/dòng, chọn ở trang công việc, lọc/JQL/`ORDER BY severity` (Q1, Q2).
- **Ảnh:** thumbnail + lightbox, dán Ctrl+V vào mô tả/bình luận; **người báo tự xoá bug của mình trong 10 phút đầu** (vào Thùng rác của dự án; chặn nếu đã có việc con hoặc bình luận của người khác) (Q12–Q14).
- **Việc mới vào:** hàng mở rộng, **Nhận** chọn loại + ưu tiên + sprint + người phụ trách; **Từ chối** bắt buộc lý do (báo lại người gửi). **Việc chưa duyệt/tạm hoãn/đã từ chối bị ẩn khỏi Board, Việc chờ, số đếm sprint** (JQL/tìm kiếm vẫn thấy) (Q10, Q11).
- Trang chủ có khối "Bug tôi báo chưa đóng / Chờ tôi xác nhận"; tab Báo cáo "Chất lượng (QA)" (bug mở theo mức, tỷ lệ mở lại, thời gian đóng TB, theo phiên bản/release) (Q15–Q17).

**Dự án riêng tư**

- Công tắc ở Cấu hình dự án → Quyền riêng tư (cũng chọn lúc tạo): dự án chỉ hiện với thành viên dự án + quản trị workspace/hệ thống; ẩn khỏi danh sách, Wiki, báo cáo, JQL/Cmd+K, thông báo, realtime, @mention, Telegram, digest (xem mục 4). Gỡ thành viên cuối của dự án riêng tư bị chặn kèm hướng dẫn (P12, P15, P16).
- Mẫu dự án khi tạo: Scrum / Kanban / **Quản lý yêu cầu** (kèm quy trình + bảng); quy trình tự sinh mang hậu tố mã dự án; danh sách Quy trình có "Dùng bởi", chặn xoá quy trình đang dùng (P7, P8).

**Thông báo / Digest**

- Tiêu đề thông báo có người + hành động + giá trị, trích 80 ký tự bình luận; **gộp theo công việc trong 60 giây**; trang `/notifications` lọc Tất cả / Chưa đọc / Được nhắc / Được giao + "Đánh dấu đã đọc tất cả" (A13–A16). Quy tắc Automation "thông báo" nay cũng gộp 60 giây và **tôn trọng người đã tắt** loại thông báo đó (trước "luôn gửi").
- **Giờ gửi digest đổi (chú ý):** báo cáo cũ trước đây chạy `EVERY_DAY_AT_8AM` theo múi giờ **tiến trình** (thường UTC → 08:00 UTC = 15:00 VN); nay mặc định **08:00 `Asia/Ho_Chi_Minh`** (migration gán `weekday=1,hour=8`). Trên máy chủ UTC, digest hiện có sẽ đến **sớm 7 giờ** so với trước — chỉnh lại giờ/múi giờ từng báo cáo ở Cài đặt → Báo cáo định kỳ nếu không muốn.
- **Digest có cấu trúc:** chọn khối (tóm tắt, quá hạn, sprint, rủi ro, OKR, nhân lực, sức khoẻ), xem trước, lịch thứ/giờ/múi giờ, tự gửi khi kết thúc sprint, kênh **Email + Telegram**, chọn người nhận (email dựng theo quyền xem của từng người), sửa lỗi `&amp;`. Báo cáo cũ nhận lịch "thứ Hai 08:00 giờ VN" (xem mục trên) và bố cục có tiêu đề khối, tối đa 3 sprint (L19–L21).
- **Wizard Telegram 4 bước** (token → thêm bot vào nhóm → gửi `/link@bot MÃ` → thử), trạng thái thật (Hoạt động / Lỗi token / Chưa có bot / Chưa có kênh), mã 6 ký tự hạn 15 phút (L22–L24).

**Dashboard / Báo cáo / OKR**

- **Báo cáo** mở bằng tab **Sprint** (chọn sprint, Burndown có vạch "Hôm nay", velocity, tóm tắt), **Tổng kết sau Kết thúc sprint** (đã chuyển gì đi đâu, so velocity) — sau khi Kết thúc sprint người dùng được chuyển sang trang Báo cáo thay vì ở lại Việc chờ; hộp xác nhận **Bắt đầu sprint** (sửa ngày/mục tiêu); header Board/Việc chờ hiện ngày kết thúc + "còn N ngày" (L10–L13).
- **Xuất CSV** (mở được bằng Excel; tối đa 5.000 dòng): Việc chờ, danh sách bug, kết quả JQL/bộ lọc (theo cột đang chọn), sprint, Danh mục, RAID, Nhân lực; **In / Lưu PDF** Tổng quan, Báo cáo sprint, dashboard (L1–L4).
- **Tổng quan lãnh đạo:** cột/huy hiệu **Sức khoẻ dự án** (tự tính + quản trị dự án ghi đè kèm ghi chú), thẻ Top rủi ro / OKR chậm / Người quá tải (báo lỗi nguồn thay vì giả "không có vấn đề") (L16–L18).
- **Dashboard tuỳ biến:** bộ chọn ở Tổng quan, 9 loại widget, soạn kéo-thả (chuột/bàn phím/cảm ứng, Hoàn tác), chia sẻ riêng tư / cả workspace / theo dự án / theo nhóm; chỉ chủ sửa (L5–L7).
- **OKR:** Key Result **tự đo** (bug mở, % sprint, JQL — tính lúc đọc theo quyền người xem), giá trị bắt đầu + đơn vị, check-in có ghi chú, lịch sử + đường tiến độ (cron chụp hằng ngày, ngày tính theo giờ Việt Nam từ đợt sửa cuối) (L25, L26, L29).

**Wiki**

- Quyền viết wiki **theo dự án** (Developer, Tester, BA, PO, Scrum Master, Quản trị dự án); báo thiếu quyền chỉ rõ xin ai; xung đột khi hai người cùng sửa (409 `VERSION_CONFLICT`) có khối "Xem bản mới / Sao chép / Ghi đè" (A8–A10).
- Mã công việc trong wiki thành chip; "Tài liệu liên quan" + "Viết tài liệu cho công việc này" trên công việc; **lịch sử phiên bản** (diff, khôi phục), **xoá mềm + thùng rác** (A11, A12, A18–A20).

**Quản trị / Thành viên / API key**

- **Không còn lời mời**: thêm người = thêm trực tiếp từ pool chung, người chưa có tài khoản thì tạo tài khoản (mật khẩu tạm 27 ký tự, hiện một lần) rồi thêm — một hộp "Thêm thành viên" (P3, P4).
- Trang **Tài khoản** (admin hệ thống): tìm/lọc, khoá/mở khoá (**có hiệu lực ngay**: access/refresh token, socket, API key), đặt lại mật khẩu, "Đăng xuất mọi thiết bị", "Hoạt động gần nhất", thêm vào workspace; màn "chưa thuộc không gian làm việc nào"; chính sách mật khẩu thống nhất (≥8 ký tự, chữ thường + hoa + số) (P5, P6).
- **Nhật ký kiểm toán** (Cài đặt → Nhật ký quản trị, lọc theo hành động/người/ngày; admin hệ thống thêm tab hoạt động); **ma trận so sánh vai trò**; đếm thành viên vai trò theo từng workspace; bảng vai trò ghi đủ khi tạo workspace/dự án (migration vá dữ liệu cũ) (P1, P2, P11).
- **Quyền mặc định đổi:** Scrum Master tạo được việc + triage, Product Owner chuyển trạng thái/kéo thẻ; mọi thành viên workspace là Developer mặc định nên **sửa được wiki của mọi dự án công khai** (P10, A8).
- **Menu:** "Quản trị" portfolio đổi tên **Danh mục**; "Quản trị hệ thống" lên sidebar cho admin; mục/nút ẩn theo quyền, chỉ-xem có dòng "Bạn chỉ có quyền xem…", `/admin` báo không có quyền thay vì nhảy trang; "Dự án" mở trang danh sách dự án (gần nhất ghim đầu); Rủi ro & Tự động hoá có lối từ tab dự án; thanh dự án thu gọn được (nhớ theo người); nút nổi né toast (U7–U11).
- **Onboarding:** checklist "Bắt đầu" 4 bước tính từ dữ liệu thật, 5 tour mặc định tự chạy lần đầu (nút Hướng dẫn chỉ hiện khi màn có tour), trang chủ rỗng có nút theo vai trò (dev/tester/BA) (P17–P19).
- **Nhập Jira:** việc nhập mang **mã gốc** (JRA-1; tạo mới sau đó vẫn theo mã Tirapro, hai kiểu cùng tồn tại; nhập lại bỏ qua mã trùng; JQL `key`); email người phụ trách chưa có tài khoản được nhớ và **tự gán** khi họ được thêm vào workspace/dự án (một thông báo gộp) (L27, L28).
- Tích hợp GitHub/GitLab (mục Kho mã + khối Liên kết code) **ẩn** cho tới đợt sau; khối tài khoản demo ở trang đăng nhập/Tài liệu ẩn ở production (P9).

**JQL / tìm kiếm / phím tắt / AI**

- Ô JQL gợi ý trường/toán tử/giá trị, alias `me`, báo giá trị sai kèm "ý bạn là", chọn cột kết quả (nhớ theo người); khớp tên danh mục không phân biệt hoa thường (U15–U18).
- Kho phím tắt duy nhất + bảng `?` theo nhóm; `j/k` + Enter, `a` (gán), `e` (sửa) trên Board/Việc chờ/Việc mới vào/kết quả lọc (theo panel xem nhanh); Cmd+K thêm lệnh tạo/bắt đầu/kết thúc sprint, mở Báo cáo/Gantt/Wiki/Rủi ro/Tự động hoá/Việc mới vào, Báo lỗi (U12–U14).
- **AI minh bạch nguồn:** khi chưa cấu hình AI ghi rõ "Gợi ý cơ bản (chưa cấu hình AI)"; trợ lý lập sprint nêu lý do từ dữ liệu thật (khớp mục tiêu, hạn, ưu tiên); "Tạo bằng AI/từ danh sách" tách dòng đúng (không tách `;`, giữ "1.x release", tối đa 15 mục, báo lỗi từng việc, dừng sớm khi 401/403/429) (U19–U21).

**Mobile / responsive (390px)**

- Ô nhập 16px (không zoom iOS), `viewport-fit=cover` + safe-area, dải menu phụ có mờ mép; header dự án gọn (nút Tạo thành icon 44px, tab view dạng icon + nhãn tab đang mở, chip lọc một hàng cuộn ngang); Việc chờ hai dòng + dấu quá hạn không chỉ màu; vùng chạm ≥44px không chồng; màn lãnh đạo/quản trị/cài đặt/thành viên gọn; bộ đo `pnpm --filter @tirapro/web mobile:audit` (+ `--dialogs`, 14 kịch bản hộp thoại) chặn lỗi tràn/che (U27–U31, F1).

### Thuật ngữ, ngày giờ, validation tiếng Việt (U22–U26)

- **Thuật ngữ thống nhất** (bảng `docs/UX_CONVENTIONS.md` §19): _Việc chờ_ (không "Backlog"), _Bảng việc_, _sprint_ (không "đợt làm việc"), nhóm trạng thái _To Do / In Progress / Done_ (Tổng quan, Báo cáo, Bộ lọc, Quy trình, CSV chương trình dùng chung `STATUS_CATEGORY_LABEL`), _công việc/việc_ (không "issue", "vấn đề" — trừ sổ RAID), _dự án_, _quy trình_, _không gian làm việc_.
- **Danh mục quyền, vai trò hệ thống, khối báo cáo** bằng tiếng Việt (không đổi `key` quyền/enum, không cần migration). Vai trò hệ thống đọc mô tả từ `SYSTEM_ROLE_META` nên có hiệu lực ngay. **Lưu ý:** mô tả `Resolution` (`DEFAULT_RESOLUTIONS`) chỉ gieo khi seed lần đầu nên workspace đã có dữ liệu giữ chữ cũ ("Trùng với issue khác"); mô tả quyền ở bảng `Permission` của DB cũ chỉ cập nhật khi chạy lại `db:seed` (web hiển thị mô tả lấy từ `@tirapro/types` nên không bị ảnh hưởng).
- **Thông báo lỗi và lý do gợi ý của API** dùng cùng bảng: sprint không còn lộ `FUTURE/ACTIVE` ("Đã có sprint đang chạy — hãy kết thúc nó trước"); digest ghi _To Do / In Progress_; lý do gợi ý người nhận và lời chỉ dẫn gửi Claude dùng "công việc" (tên thẻ phân tách prompt `<issue>` giữ nguyên). Mã lỗi `error.code` không đổi.
- **Ô ngày/giờ:** không còn `<input type="date|datetime-local">` trong web — mọi form dùng `DateInput`/`DateTimeInput` (`dd/MM/yyyy`, `HH:mm` 24h; gõ `0508`, báo ngày sai). Giá trị gửi API không đổi. Trường tuỳ biến kiểu ngày lưu khi chốt giá trị (Enter / rời ô / chọn lịch), không lưu mỗi phím.
- **Lời nhắn ngày:** "Ngày kết thúc không được trước ngày bắt đầu" (luật cho phép trùng ngày). Toast xuất CSV chỉ khuyên "thu hẹp bộ lọc" khi nơi xuất có bộ lọc.
- **Hạn hoàn thành khi tạo công việc:** không chặn ngày quá khứ — chỉ cảnh báo mềm "Hạn đã qua"; token không có năm (`^15/8`) đã qua trong năm nay được hiểu là **năm sau**. Ô ngày đang gõ sai chặn mọi đường lưu (kể cả hộp thoại không có `<form>` và Cmd/Ctrl+Enter).
- **CSV Danh mục (chương trình):** tiêu đề cột đổi `Xong / Đang làm / Cần làm` -> `Done / In Progress / To Do` (ai đang dùng bảng tính đọc theo tên cột cần cập nhật).
- **Chặn tái phạm:** ba bộ quét mã nguồn (`terminology.test.ts`, `noNativeDate.test.ts`, `terminology.spec.ts`) chạy trong `pnpm test`.
- **Tài liệu khớp tính năng thật (L8):** trang **Hướng dẫn** (`/documentation`) và `docs/FEATURES_BY_ACTOR.md` mô tả đúng đợt 2: thêm thành viên trực tiếp (không lời mời), dự án riêng tư, wiki quyền theo dự án + lịch sử phiên bản, Mức nghiêm trọng / Resolution, form Báo lỗi, xem nhanh, @mention, JQL gợi ý, thông báo, Sức khoẻ dự án + thẻ lãnh đạo, Digest (thứ/giờ/múi giờ, Email + Telegram), dashboard 4 mức chia sẻ, OKR tự đo, nhập Jira giữ mã gốc, phím tắt.
- **Bỏ lời hứa không có thật:** xuất "PDF/Excel" -> "Xuất CSV (mở được bằng Excel) + In / Lưu PDF"; bỏ lệnh Telegram `/newtask`, `/bug`, `/report` (bot chỉ gửi tin; `/link@bot MÃ` liên kết **nhóm**, không phải từng người).


### Đợt sửa cuối (sau review toàn nhánh)

- **Việc báo lỗi chờ duyệt không còn lộ qua realtime:** việc ở trạng thái chưa duyệt/tạm hoãn/đã từ chối không hiện trên Board/Việc chờ của người khác (cả khi mới tạo lẫn khi cập nhật); chuyển sang đã nhận thì hiện. Automation "khi tạo việc" và thông báo "được giao" chạy **khi việc được Nhận**; Telegram không đẩy cập nhật của việc chưa duyệt.
- **Triage đòi `issue:triage`:** Nhận/Từ chối/Tạm hoãn chỉ cần `issue:triage` (không còn `issue:edit` + sở hữu), nên người báo không tự duyệt việc của mình và vai Developer (mới) không duyệt được; nhận kèm người phụ trách được kiểm thành viên còn hoạt động + thấy dự án. Nhận/đổi trường qua triage phát sự kiện cập nhật đúng dạng nên người theo dõi/người được giao nhận thông báo.
- **Bộ chọn người tìm phía máy chủ theo dự án** (người được giao, @mention, Tạo việc/token `@`, Người tham gia, Mục tiêu, Nhân lực, RAID, Chương trình, Nhóm, quy tắc Automation, người nhận digest): chỉ hiện người **xem được dự án**, bỏ tài khoản đã khoá và tài khoản automation, mặc định 50 người + dòng "Gõ để tìm thêm" (tìm tên/email không phân biệt hoa thường và dấu). Bộ lọc theo người (Board/Việc chờ/bộ dựng truy vấn) và việc hiển thị tên vẫn thấy tài khoản đã khoá (`includeInactive`, tối đa 200).
- **Màn Thành viên:** thêm người đã là thành viên → báo rõ (`ALREADY_MEMBER`; trước đây âm thầm đổi vai trò); hạ/gỡ quản trị workspace cuối cùng → báo rõ (`LAST_WORKSPACE_ADMIN`).
- **Chuyển dự án sang riêng tư tự TẮT mọi kênh Telegram gắn dự án đó** (ghi nhật ký kiểm toán `integration.channels_disabled`); lời xác nhận ở Cài đặt dự án nói rõ. **Không có nút bật lại:** muốn gửi tiếp thì gỡ kênh và gắn lại (cố ý, an toàn theo hướng chặn). Kênh/digest của dự án ẩn không liệt kê/gỡ được với người không thấy dự án.
- **Sửa hàng loạt gộp thông báo:** `PATCH /issues/bulk` (kể cả chỉ đổi trạng thái) gửi **một** tin Telegram "N việc … cập nhật bởi X" mỗi dự án/kênh thay vì N tin; hành động "gửi thông báo" của automation gộp một thông báo cho mỗi (quy tắc, người nhận) kèm "(sửa hàng loạt N việc)". Việc tự gán từ nhập Jira/claim hàng loạt (`bulk:true`) không kích hoạt Telegram/automation từng việc.
- **"Quá hạn" một định nghĩa theo ngày Việt Nam** (`dueDate` < hôm nay giờ VN): việc hạn **hôm nay chưa tính quá hạn**, nên số Quá hạn ở Tổng quan, Sức khoẻ dự án, Danh mục, digest, trợ lý sprint, chip lọc, DueBadge, Gantt giảm so với trước (đã thêm nhãn "Đến hạn hôm nay"). "Hôm nay" của OKR (tiến độ kỳ vọng, bản chụp KR, lịch sử, check-in tay) cũng theo ngày VN — số liệu trong khung 00:00–07:00 VN đổi so với bản trước ((ngày của lịch sử KR tính theo VN, không còn UTC)). Sức khoẻ dự án bỏ việc chưa duyệt.
- **Xuất CSV** `Việc chờ`/`Bug`/sprint không còn chứa việc chưa duyệt/đã từ chối (kết quả JQL/bộ lọc giữ nguyên). **Một định nghĩa "bug"** (loại có key `BUG` hoặc tên "Bug") dùng ở báo cáo QA, KR `OPEN_BUGS`, CSV bug và số Bug ở Tổng quan — dự án có loại tuỳ biến tên "Bug" sẽ thấy số khớp nhau.
- **KR tự đo:** đo song song tối đa 4 và cache 30 giây theo người xem (số có thể lệch ≤ 30 giây giữa các node); đường tiến độ lấy các dòng **mới nhất** khi một KR có rất nhiều check-in.
- **Mã công việc:** tiền tố loại tuỳ biến luôn bắt đầu bằng chữ ("3D Model" → `DMOD`; mã mới, mã đã cấp giữ nguyên) nên mã mới luôn thành chip/Cmd+K. Nhận diện mã công việc không còn dùng regex lookbehind nên chạy được trên Safari < 16.4.
- **Gõ nhanh tiêu đề (Tạo việc/Thêm nhanh):** token không ghi đè ô bạn đã chỉnh tay (giá trị lưu = giá trị trên ô); `#12` là tham chiếu việc chứ không còn bị nuốt thành sprint (sprint khớp tên chuẩn hoá hoặc tiền tố duy nhất ≥ 3 ký tự có chữ); `~2.5`/`~2,5` nhận điểm thập phân; cảnh báo "hạn đã qua" không báo cho hạn hôm nay.
- **Xem nhanh + Epic:** mở xem nhanh ở màn 1024–1535px thì panel Epic tự thu (không ghi lại lựa chọn), đóng xem nhanh thì Epic trở lại; xem nhanh `min(30rem, 40vw)`; dòng Việc chờ ẩn nhãn + tên người khi xem nhanh mở.
- **Cảm ứng:** vuốt dọc trên dòng/thẻ để cuộn; **nhấn giữ khoảng 250 ms** rồi kéo để kéo thả (Board, Việc chờ, Cây việc); chuột/bàn phím không đổi. Ô tiêu đề lớn trên điện thoại giữ cỡ chữ lớn (Wiki ~17px, Dashboard/Chi tiết việc 20px), ô thường vẫn 16px.
- **Wiki:** hỏi "Bỏ thay đổi chưa lưu?" khi chuyển trang/Huỷ/Esc/tạo trang/rời trang lúc đang sửa; **tự lưu nháp** theo người + trang trong trình duyệt và đề nghị khôi phục (bản nháp nằm ở trình duyệt, không lên máy chủ); mở Wiki nhanh hơn (chỉ tra quyền dự án đang xem, dự án khác tra lười khi rê chuột/focus).
- **Bộ lọc/JQL:** khi còn kết quả ghi "100 công việc đầu tiên" + nút **Tải thêm** (+ gợi ý Xuất CSV), hết thì "N công việc" (trước đây hiện 100 như tổng).
- **Khác:** hotkey không chặn khi đã bấm ô tick chọn hàng, nhường tour hướng dẫn, Esc trong bộ gõ (IME) không phá bộ gõ; menu Tạm hoãn là Radix menu; nút "Xem trước" digest hiện theo `integration:manage`.

### Chỉnh cuối sau smoke vòng 2

- **Số liệu tổng hợp chỉ tính việc đã qua duyệt** (hoặc không đi qua "Việc mới vào"): Tổng quan, báo cáo dự án, CFD và "Tạo vs Xong", burndown/tổng kết sprint, velocity, Danh mục, digest, tải nhân lực, trợ lý sprint, **số việc trên thẻ dự án** và **giới hạn WIP** của cột. Số "Bug", "Đang mở", "Đã hoàn thành x/y" nay khớp Board, Việc chờ và báo cáo QA. Tìm kiếm/JQL/bộ lọc đã lưu/gadget theo JQL vẫn thấy mọi việc, kể cả việc chưa duyệt (người báo tìm lại được việc của mình). Sprint kết thúc không liệt việc chưa duyệt vào "chuyển tiếp".
- **Snapshot sprint đã lưu trước bản này giữ nguyên số đã chụp** (velocity, sprint đã đóng, burndown theo snapshot); chỉ snapshot ghi từ nay mới loại việc chưa duyệt. Số liệu tính lại từ dữ liệu hiện tại tự đúng ngay khi tải lại, không cần migration.
- **Tạo nhiều việc cùng lúc trong một dự án** (nhập liệu, automation, nhiều người cùng tạo) không còn ra các việc trùng rank: mỗi việc mới nằm đúng cuối danh sách theo thứ tự tạo (đã kiểm 10 lệnh tạo song song → 10 rank khác nhau). Vận hành: transaction tạo việc có timeout 30 giây (trước 5 giây) để chịu được lần đánh số lại rank hiếm gặp ở dự án rất lớn.
- **Board và Việc chờ trên điện thoại gọn hơn:** Mọi người / Nhóm theo người / Báo lỗi / Sprint (Việc chờ: Tạo sprint / Epic / Mọi người / Xuất) gom vào một dải cuộn ngang dưới hàng chip nhanh; Cài đặt bảng thành nút ⚙ đầu dải, "Tạo sprint" đứng đầu dải nên thấy ngay; cột đầu tiên của Board lên cao khoảng 90px. Màn từ 640px trở lên không đổi.
- **"Việc mới vào"** là tên thống nhất ở tiêu đề trang, tab và lệnh ⌘K (trước đây tiêu đề trang là "Phân loại (Triage)").
- **Báo cáo định kỳ:** múi giờ hiển thị dễ đọc ("Giờ Việt Nam (UTC+7)", "Asia/Tokyo (UTC+9)"), báo cáo cũ lưu `Asia/Saigon` mở ra đúng một dòng "Giờ Việt Nam", ô chọn múi giờ mở nhanh hơn; giá trị lưu vẫn là tên IANA. Danh sách báo cáo trên điện thoại hiện đủ tên và lịch (xuống dòng thay vì cắt cụt).

## 3. Thay đổi API

Cập nhật `docs/design/api-contract.md` theo từng route khi sửa.

**Breaking (client bên thứ ba có thể vỡ)**

- **Bỏ** `POST /auth/invites` và `POST /auth/invites/accept` (cùng bảng `InviteToken`, template thư `invite`, trang web `/invite/accept` → 404, thư mời còn trong `EmailOutbox` bị xoá). Thay bằng thêm trực tiếp: `POST /members` (+ `/members/bulk`; người có sẵn từ `GET /users/all`) và `POST /members/accounts` (tạo tài khoản + thêm, trả `tempPassword` một lần).
- `POST /users/me/change-password` nay **thu hồi mọi phiên** và trả phiên mới cho thiết bị đang đổi (token + cookie refresh); gọi bằng API key → 403. `POST /auth/logout-all` mới (chỉ phiên đăng nhập, không phải API key).
- `GET /sprints` và `GET /boards` **không `projectId` → 422** (trước trả mọi dự án); danh sách/tìm kiếm/JQL/`GET /issues/:key` lọc theo quyền xem dự án riêng tư (404 như không tồn tại).
- `GET /reports/burndown` (sprint đang chạy): các ngày sau hôm nay có `remaining: null` và response có `today` — client coi `remaining` luôn là số sẽ lỗi.
- `GET /issues` (Board/Việc chờ) **ẩn việc `triageState` ∈ PENDING/SNOOZED/DECLINED** (JQL/tìm kiếm vẫn thấy); `GET /users/all` (cần `member:manage`) trả `PoolUserDto` (ít trường hơn, bỏ tài khoản vô hiệu hoá).
- `POST /search/validate` từ `@AuthOnly` thành cần `workspace:view`; `GET /search` kiểm giá trị JQL và kèm gợi ý "ý bạn là"; tên danh mục (type/status/priority/severity/resolution/sprint/project) khớp không phân biệt hoa thường.
- `PUT /wiki/:id` nhận `expectedVersion` (OCC; lệch → 409 `VERSION_CONFLICT`, trang đã xoá → 404); `DELETE /wiki/:id` là **xoá mềm** và đòi `project:admin`; tạo trang con thiếu `projectId` khớp trang cha → 422; vai workspace tuỳ biến chỉ có `wiki:manage` sửa được nhưng không xoá được.
- Quyền sửa: `storyPoints` theo `issue:edit` (như mục 2); `startDate` + `dueDate` giữ rule người tạo/quản trị; `startDate` > `dueDate` → 422 (chỉ kiểm khi request đụng ngày).
- CSV Danh mục đổi tiêu đề cột `Xong / Đang làm / Cần làm` → `Done / In Progress / To Do`.

**Route / field mới**

- Báo cáo & xuất: `GET /reports/leadership`, `GET /reports/sprint-summary?projectId&sprintId`, `GET /reports/qa?projectId&from&to`, `GET /export/issues.csv?projectId&jql|preset=backlog|bugs&sprintId&columns&delimiter` (header `X-Export-Truncated`).
- Công việc: `POST /issues/:id/retract` (người báo, ≤10 phút); `GET|POST /projects/:projectId/trash[/:issueId/restore]`; `POST /issues/:id/transition` nhận `comment`, tự gán Resolution mặc định khi sang Done; bulk `patch` nhận `storyPoints`, `epicId`, `labels{add,remove}`; `POST /issues`/`PATCH` nhận `severityId`, `acceptanceCriteria`, `environment`; `IssueDto` thêm `acceptanceProgress`, `components`, `fixVersions`, `environment`, `severityId`; liên kết nhận `direction` (`outward|inward`); `GET /issues/:issueId/activity/:activityId`, `GET …/activity?fields=`; `POST /issues/:issueId/comment-attachments`; JQL thêm `severity`, `component`, `fixVersion`, `affectedVersion`, `key`, alias `me`.
- Báo lỗi/triage: `POST /intake/report` (3 nhánh gộp/tự gộp/tạo mới, `mergeIntoIssueId`, `forceNew`), `GET /intake/duplicates`; `POST /triage/:id/accept` nhận `typeId|priorityId|sprintId|assigneeId`, `decline` bắt buộc `reason` (≤2000).
- Sprint/dự án: `POST /sprints/:id/start` nhận body tuỳ chọn `{startDate,endDate,goal}`; `PATCH /projects/:id/health`; tạo dự án nhận `templateKey`, `isPrivate`; `ProjectDto.isPrivate`.
- Wiki: `GET /wiki/admins`, `/wiki/by-issue/:issueId`, `/wiki/trash`, `POST /wiki/:id/undelete`, `GET /wiki/:id/versions[/:version]`, `POST /wiki/:id/versions/:version/restore`.
- Thông báo/dashboard/OKR/digest: `GET /notifications?filter=all|unread|mentioned|assigned`; `GET|POST|PUT|DELETE /dashboards[/:id]` + `POST /dashboards/:id/duplicate`; `GET /goals/:id/progress-history`, `GET|POST /goals/:id/key-results/:krId/check-ins`, KR nhận `source`/`sourceConfig`/`unitLabel`; `POST /digests/preview`, digest nhận `weekday/hour/timezone/deliverEmail/metrics` (danh sách khối)/`allowPrivateToChannel`.
- Người dùng/quản trị: `POST /admin/users/:id/reset-password|revoke-sessions|workspaces`, `GET /admin/users?search&status`, `GET /admin/system/audit`, `GET /audit` (`workspace:admin`); `GET /guides/onboarding` + `POST /guides/onboarding/dismiss`; `GET /integrations/telegram/platform`, `POST /integrations/:id/link-codes[/:code/poll]`.
- Nhập Jira: `keepJiraKey` giữ mã gốc; kết quả thêm `duplicateKeys`, `invalidKeys`, `rememberedAssignees`; mapping nhận `pendingEmails`.

**Mã lỗi / WS**

- Mã lỗi mới: `422 EMAIL_ALREADY_REGISTERED` (tạo tài khoản với email đã có). Còn lại dùng mã sẵn có (`VERSION_CONFLICT`, `BUSINESS_RULE_VIOLATION`, `NOT_FOUND`…); dự án riêng tư luôn `404 NOT_FOUND` cùng thông điệp với dự án không tồn tại.
- WS: `issue:sets_changed` (gắn/bỏ thành phần/phiên bản, không đổi `version`); payload thông báo mới `{key, summary, excerpt, where, actors, count}`. Sự kiện domain nội bộ mới: `member.added`, `project.access_changed`, `project.member_removed`, `project.visibility_changed`, `account.sessions_revoked`, `issue.sets_changed`.


**Đợt sửa cuối**

- `GET /users` lọc phía server: `projectId` (chỉ người xem được dự án; người gọi không xem được → 404), `search` (tên/email, không phân biệt hoa thường/dấu), `limit` (mặc định 50, kẹp 1–200, áp sau lọc quyền), `includeInactive=true`. **Mặc định loại tài khoản đã khoá và tài khoản automation hệ thống** (trước đây trả hết) — client bên thứ ba cần danh sách đầy đủ phải thêm `includeInactive=true&limit=200`; vẫn trả mảng.
- **DTO người nhúng đổi:** assignee/reporter/author/triage/watchers/participants dùng `UserRefDto` (**bỏ `lastSeenAt`, `isSystemAdmin`**). `lastSeenAt`/`isSystemAdmin` chỉ có ở `GET /members`, `GET /projects/:id/members`, `GET /users`, `GET /users/:id` **và chỉ khi người gọi có `member:manage`** (hoặc admin hệ thống). `TeamDto.lead/members` chưa đổi.
- `POST /triage/:id/accept|decline|snooze` đòi `issue:triage` (trước `issue:edit` + sở hữu); `accept` kèm `assigneeId` không hợp lệ → 422. Sự kiện `ISSUE_UPDATED` của triage nay là `IssueDto` đầy đủ + `changedFields`.
- `POST /digests/preview` đổi `digest:manage` → **`integration:manage`** (cùng create/update/run digest). `digest:manage` còn trong danh mục quyền nhưng không còn route nào dùng.
- `GET /export/issues.csv`: preset `backlog`/`bugs`/`sprint` thêm điều kiện chỉ việc đã duyệt; `bugs` dùng định nghĩa bug chung.
- **Mã lỗi mới:** `409 ALREADY_MEMBER` (`POST /members` với người đã là thành viên; đổi vai trò dùng `PUT /members/:userId/roles` — trước đây gọi này âm thầm ghi đè vai trò), `409 LAST_WORKSPACE_ADMIN` (hạ/gỡ quản trị workspace cuối cùng). `POST /members/accounts` trả `Cache-Control: no-store`.
- **Nhãn "quá hạn" trong Tổng quan** (`GET /reports/overview`/theo người): "sắp đến hạn" và nhóm ưu tiên cao tính từ `dueDate >= hôm nay (VN)`, thêm "Đến hạn hôm nay"; "Quá hạn N ngày" tính theo ngày lịch.
- **Sự kiện domain/WS nội bộ:** `access.changed` `{workspaceId?, userIds?}` (phát khi đổi vai trò workspace/dự án, sửa `permissionKeys` của vai trò, bật/tắt admin hệ thống); `issue.bulk_updated`; `project.visibility_changed` mang thêm `isPrivate` + `actorId`; `ISSUE_UPDATED`/`ISSUE_TRANSITIONED` của sửa hàng loạt mang `batch {id,size}` (`bulk:true` giữ nghĩa "hệ thống phát hàng loạt": nhập Jira, claim).
- `GET /search/fields` và danh mục trạng thái của JQL/"ý bạn là" không còn liệt kê/xác nhận tên trạng thái của quy trình riêng của dự án riêng tư.
- Cập nhật `docs/design/api-contract.md` §21 (`GET /users`, triage, digests/preview, mã lỗi 409).

## 4. Bảo mật & quyền

- **Dự án riêng tư = 404 như không tồn tại** (cùng thông điệp để không dò được mã dự án) trên mọi đường: danh sách/`GET /issues/:key`/JQL/Cmd+K/bộ lọc đã lưu/liên kết/gợi ý trùng, Wiki + lịch sử, digest, Triage, SLA, quy trình (`usedBy` chỉ đếm "N dự án riêng tư"), trường tuỳ biến, kho mã, OKR/RAID/Chương trình/Khách hàng/Nhân lực, thông báo, @mention, gán người phụ trách, socket realtime. Một hàm quyết định duy nhất (`ProjectAccessService`) + test quét AST (`private-project-coverage.spec`). Vai cấp workspace **không có `project:view`** chỉ thấy dự án mình có vai trò.
- **Custom role có `report:view` nhưng không `project:view` mất dashboard/số liệu của dự án công khai** — cần cấp `project:view`.
- **Digest/Telegram:** kênh chung (nhóm Telegram) chỉ nhận dự án công khai; digest gắn dự án riêng tư chỉ lên kênh khi bật rõ `allowPrivateToChannel` (cờ tự về `false` khi đổi dự án sang riêng tư; có cảnh báo trong form); không bật thì chỉ Email theo quyền từng người. Tin sự kiện của dự án riêng tư chỉ tới kênh Telegram gắn đúng dự án đó.
- **API key không bị thu hồi khi đổi mật khẩu / đăng xuất mọi thiết bị / admin đặt lại mật khẩu** — key là thông tin xác thực riêng của tích hợp (MCP, script); chỉ bị chặn khi tài khoản chủ key bị **khoá** (cache xoá ngay) hoặc bị gỡ khỏi workspace; nghi lộ key thì thu hồi ở Cài đặt → API. Khoá tài khoản cắt ngay access/refresh token, socket và API key; đổi mật khẩu/đặt lại/logout-all thu hồi mọi phiên web (mốc `sessionsRevokedAt`) và ngắt socket.
- **Mô tả đã bị xoá khỏi bản hiện tại vẫn đọc được trong lịch sử** (mọi người có `project:view`; mỗi lần Lưu mô tả lưu nguyên văn, chưa có chính sách dọn); **lịch sử wiki cũng hiện nội dung đã xoá** cho mọi người đọc trang, chưa có "xoá vĩnh viễn"/che bản.
- Pool người dùng chung: quản trị workspace thấy/ thêm mọi tài khoản hệ thống (xem mục 1.9); `GET /users/all` chỉ trả `PoolUserDto`. Admin workspace **tạo được tài khoản** (có nhật ký kiểm toán; các route admin trả mật khẩu tạm với `Cache-Control: no-store`); chính sách mật khẩu một nơi (`passwordSchema`).
- Hành động quản trị ghi `AuditLog` (vai trò, thành viên, quyền, khoá/mở khoá, đặt lại mật khẩu, tích hợp, đổi riêng tư…), chỉ `workspace:admin`/admin hệ thống xem.
- Thông báo đi qua một cổng (`createDeferred`): người nhận không thấy dự án thì không có thông báo/realtime/email; @mention lọc theo quyền xem **trước** khi ghi sổ; **cài đặt tắt thông báo của người dùng luôn thắng** cả với người theo dõi/automation.
- Dashboard tuỳ biến: chỉ chủ sửa nội dung/mức chia sẻ, admin chỉ xoá bản đã chia sẻ và không thấy dashboard riêng tư của người khác; nhân bản che JQL/dự án ẩn; KR tự đo tính theo quyền người xem, lịch sử cron chụp theo phạm vi công khai. Xuất CSV chỉ gồm việc người xuất xem được, chống chèn công thức.
- Quyền mặc định đổi (xem mục 2): Scrum Master `issue:create`+`issue:triage`, Product Owner `issue:transition`, `wiki:manage` theo dự án cho 6 vai + vai tuỳ biến có `project:admin`/`workspace:admin`.
- **Đợt sửa cuối — bảo mật:**
  - Việc báo lỗi chưa duyệt không lộ qua realtime/thông báo (`ISSUE_CREATED` mang `triageState` ngay lúc tạo); Triage chỉ đòi `issue:triage`; `accept` kiểm người phụ trách (thành viên hoạt động, thấy dự án).
  - **`access.changed`:** đổi vai trò/quyền hoặc quyền admin hệ thống thì gateway kiểm lại `canSee` cho mọi room `project:*`/`issue:*` của socket đang mở và rút socket mất quyền xem ngay (trước đây hạ quyền không rút socket khỏi room dự án riêng tư). Room `issue:<id>` (presence) hiện cũng được kiểm lại theo cơ chế này khi có sự kiện.
  - **Chuyển dự án sang riêng tư tắt mọi kênh Telegram gắn dự án** (xem mục 2); digest cũng tự reset `allowPrivateToChannel`. Danh sách/gỡ kênh theo quyền xem dự án.
  - `lastSeenAt`/`isSystemAdmin` không còn lộ trong DTO người nhúng; chỉ `member:manage`/admin hệ thống thấy ở danh sách thành viên và `GET /users`. Bộ chọn người chỉ trả người xem được dự án (không dò được danh sách thành viên dự án riêng tư), bỏ tài khoản khoá/automation.
  - Danh mục trạng thái JQL không lộ tên trạng thái của quy trình dự án riêng tư; xuất CSV preset ẩn việc chưa duyệt; chốt "quản trị workspace cuối cùng" (`LAST_WORKSPACE_ADMIN`); `POST /digests/preview` cần `integration:manage`; `POST /members/accounts` không cache.

## 5. Còn mở / cố ý không làm

**Cố ý (quyết định sản phẩm / ruling)**

- Không làm: SSO/Google/2FA; GitHub/GitLab (ẩn bằng `VITE_FEATURE_REPOS`); màn soạn tour (chỉ 5 tour + checklist mặc định); dashboard CFD/SPRINT_REPORT/CONTROL_CHART/AI_INSIGHT ("chưa hỗ trợ" trong widget).
- Board giữ tên "Bảng việc" (spec liệt Sprint/Epic/trạng thái/ưu tiên/loại liên kết giữ tiếng Anh, không nói về board).
- Chuyển trạng thái kèm lý do tạo **hai** thông báo riêng (STATUS_CHANGED + COMMENT_ADDED) — hai thông tin khác nhau, giữ nguyên. Tick checklist ở mô tả mỗi lần là một lần ghi mô tả (OCC đúng), nhiễu thông báo được gộp 60 giây thay vì gộp phía client.
- Việc chưa duyệt/tạm hoãn/đã từ chối cũng vắng ở các bộ chọn dùng `GET /issues` (Việc cha, Epic) — theo thiết kế "chưa duyệt không lẫn vào Board".
- Hạn hoàn thành ở quá khứ chỉ cảnh báo mềm (không chặn); việc nhập Jira cũ `JRA-STORY-n` giữ nguyên mã (không đổi hàng loạt); tên quy trình tự sinh cũ được đổi hậu tố mã dự án bằng migration.

**Parked / Carry trong ledger (chưa sửa)**

- Wiki: `remove()` bump `updatedAt` của trang con; `move/renumber` trả lại `updatedAt` cũ (A4).
- Epic/Cây việc: việc có cha thường X nhưng `epicId` = Y chỉ do API/import tạo, cây hiện dưới X còn panel Epic tính cho Y; tiến độ panel Epic tính trên việc đã tải (cắt khi danh sách dài); server chưa chặn đổi `typeId` sang Epic khi việc đang có cha; `assertEpicForBulk` chưa loại việc loại Epic trong lô; kiểm chu trình `PATCH` nằm ngoài giao dịch; Cây việc kéo-thả chỉ chuột/bút (lối bàn phím là ô "Epic / Việc cha"); người có `issue:edit:own` không xoá được liên kết `inward` có nguồn ở việc người khác (B4, B6).
- Báo lỗi/triage: khoá chống trùng dùng trong bộ nhớ (cần Redis `SET NX` khi nhiều instance), dấu vân tay không gồm severity/môi trường/loại, token giữ nguyên trong tiêu đề; thumbnail tải nguyên ảnh; `accept()`/`decline()`/`snooze()` không kiểm `triageState` hiện tại (có thể ẩn việc đang làm); severity "null cuối" chỉ khi là khoá sắp xếp đầu; trường Resolution và nhãn transition theo tên chưa có ở panel xem nhanh (Q1, Q3, Q4, Q2/U5).
- Thông báo/@mention: thông báo @ở bình luận đi qua listener sau commit (lỗi chỉ ghi log)(A1, P5). (Đã sửa ở đợt cuối: `canSee` tính trước giao dịch bình luận; room `issue:<id>` được rà lại qua `access.changed`.)
- OKR/dashboard: KR cũ có JQL chứa `me` không kiểm lại khi lưu không đổi; trình soạn chưa cảnh báo inline; chưa cache phép đo KR (L6a).
- Telegram wizard: `jsonb_set` trên config không phải object; hai quản trị cùng mở wizard vô hiệu mã của nhau (L3). Nhập Jira: tóm tắt epic/sprint khi nhập lại tính theo kế hoạch tệp; hàng chờ email của người đã là thành viên không bao giờ được gán (L7).
- Tài khoản: race hẹp ở `ApiKeyService.validate` có thể để cache 60s ngay lúc khoá; `RequireAuth` chặn mọi đường dẫn khi chưa có workspace kể cả đổi mật khẩu tạm; chỉ mục `AuditLog(createdAt)` và lọc theo nhóm hành động chưa có (P1, P2).
- Bộ lọc đã lưu chia sẻ của dự án công khai đã xoá mềm hiện lại; chưa test FE cho cờ `scoped` (P4). `unreadCount` thêm một truy vấn kiểm quyền (chưa cache) (P5).
- Mobile: ô nhập 16px đang `!important` nên thu nhỏ ô tiêu đề lớn (Wiki `text-lg`, Dashboard/Issue `text-xl`) trên mobile; vùng chạm chồng chưa kiểm trên cảm ứng thật; còn 8 mục Gantt trong allowlist `small-targets` (U7).

**Cố ý không làm trong đợt sửa cuối (ruling)**

- Triage: `issue:triage` một mình đủ để Nhận **kèm đổi trường** (loại/ưu tiên/sprint/người phụ trách) — vai tuỳ biến có `issue:triage` mà không có `issue:edit` sẽ đổi được các trường đó khi Nhận (chi phí chấp nhận).
- Kênh Telegram bị tắt khi dự án thành riêng tư **không có endpoint/nút bật lại** — gỡ và gắn lại có chủ đích (web chưa hiện trạng thái tắt của kênh).
- Việc chờ duyệt (PENDING) **vẫn khởi động SLA và vẫn báo @mention trong mô tả** (người báo nhờ giúp là hợp lệ; người được nhắc có quyền xem dự án nên không lộ thêm).
- `#<số>` không bao giờ là sprint (muốn gán sprint tên toàn số thì chọn ở ô Sprint); `~3.` để lại dấu chấm rời (cosmetic).
- Vận hành: sổ `claimBatchNotice` (gộp thông báo automation theo lô) nằm trong bộ nhớ — khởi động lại giữa lô (cực hiếm) có thể gửi lại một thông báo; cache KR 30 giây theo từng tiến trình API.

**Parked (chưa sửa, biết trước)**

- **Mật khẩu tạm không bắt đổi** ở lần đăng nhập đầu (`members/accounts`, admin tạo/đặt lại): quản trị biết mật khẩu của người dùng cho tới khi họ tự đổi — quyết định sản phẩm ("thêm trực tiếp"), chưa có `mustChangePassword`.
- `issue:assign` / `issue:link` **chỉ chặn ở UI**, API chưa kiểm (có từ trước round 2).
- **Nhập Jira vào dự án riêng tư** có thể gán việc cho người ngoài dự án; email người phụ trách do người nhập (`pendingEmails`) tự gán cho bất kỳ ai sau này được thêm với đúng email đó (chỉ `import:run`/admin đặt được).
- **Mail outbox gộp 5 phút:** người bị gỡ khỏi dự án riêng tư trong khoảng đó vẫn nhận thư đã xếp trước khi bị gỡ.
- **Dashboard mồ côi khi chủ rời workspace** (chỉ admin xoá được; chưa có chuyển quyền chủ/tự xoá khi `removeWorkspace`).
- **`assignee-suggest`** chỉ xét `ProjectMembership`: dự án công khai không có ghi đè vai trò sẽ cho gợi ý rỗng.
- **Bộ lọc đã lưu chia sẻ cả workspace không che JQL** có khoá dự án riêng tư (dashboard thì che bằng `jqlMasker`) — người ngoài có thể đọc chuỗi JQL; kết quả vẫn lọc theo quyền xem.
- **Bộ chọn người tra tên tối đa 200 người** (workspace > 200 thành viên): chủ mục tiêu/RAID/chương trình/thành viên nhóm/người nhận digest/người trong quy tắc là người vào **sau** thứ 200 có thể hiện "Chưa chọn"/id thô — **dữ liệu không mất**, chỉ hiển thị; cần API tra theo id.
- `RuleEditor` dùng chung một từ khoá tìm giữa các ô chọn người (mở ô khác thấy danh sách đã lọc theo từ khoá cũ tới khi đóng/gõ lại); `DigestFormFields` ghim người đã chọn lên đầu kể cả khi không khớp từ khoá.
- **Chưa có test DOM/DB thật** (nợ test, Q-I4): phần lớn test web là hàm thuần/chuỗi, test API mức mock; thay bằng smoke E2E thủ công/Playwright mỗi vòng — chưa nằm trong CI.
- **Ratchet lint đứng ở trần 91, hết dư địa** và chỉ đếm cảnh báo, không đếm kích thước (BacklogPage ~1450 dòng, WikiPage ~1050…); thêm cảnh báo mới thì phải sửa chỗ khác. Logic `foldVi` còn trùng giữa các bundle (Q-M4).
- **`IssueHistory` lưu nguyên văn mô tả mỗi lần sửa** (tới ~50k ký tự × 2): bảng sẽ phình theo số lần sửa, chưa có chính sách gộp/giữ như wiki (`MERGE_WINDOW_MS`).
- **WC-M10:** chọn hàng loạt không tỉa lựa chọn khi đổi bộ lọc (có thể sửa hàng loạt việc đã khuất khỏi danh sách đang lọc — kiểm số "đã chọn" trước khi áp). `nested-interactive` (a11y) ở dòng/thẻ kéo thả `IssueRow`/`Card` chưa sửa.
- **Migration backfill wiki** (`…302000_wiki_page_issue`) dùng mẫu mã không có `_`: trang cũ nhắc `MY_APP-12` có thể bị backfill khớp một phần `APP-12` nếu có việc mang mã đó — migration đã áp nên **không sửa**; tự đúng ở lần lưu trang kế tiếp (`syncIssueLinks` dùng regex mới).
- **`/admin/system`:** dòng nhật ký kiểm toán rất dài chồng chữ ở 390px (`mobile:audit` báo `text-overlap`, có từ trước); `mobile:audit` còn 2–3 cảnh báo `covered-by-fixed` chập chờn (phần tử cố định thoáng qua khi nạp trang), chạy lại riêng đều đạt.
- Chưa kiểm trên **iOS thật**: nhấn giữ 250 ms (đã thêm `select-none` + `-webkit-touch-callout:none` trên thiết bị cảm ứng) và Safari < 16.4 (đã bỏ lookbehind nhưng chưa chạy giả lập).
- Triage: `accept` có đổi trường là hai bước không cùng giao dịch (lỗi bước hai → việc đã đổi loại/sprint nhưng vẫn PENDING, thử lại được).
- Hiệu năng chưa đo ở quy mô lớn: `GET /users?projectId` với workspace rất lớn mà ít người xem được dự án (tối đa 10 lô × `min(2·limit, 400)` hàng + `canSee` mỗi người); `IssueHistory`/`Notification`/`WikiPageVersion` hàng triệu dòng; migration `…303000_wiki_page_history` nhân đôi dung lượng `WikiPage.body` một lần và hai `CREATE INDEX` thường (`…299000_mention_unique`, `…120000_*_index`) khoá ghi bảng đó lúc dựng (bảng nhỏ nên rủi ro thấp; `DEPLOY.md` chưa nhắc cạnh cảnh báo `perf_indexes`).
- Mô tả (`DEFAULT_RESOLUTIONS`) và quyền ở DB cũ chỉ cập nhật khi chạy lại `db:seed` (đã nêu ở mục 2).
- **Sau smoke vòng 2 (ruling, chưa sửa):** Wiki "Tạo trang mới" tạo ngay một trang rỗng trên máy chủ — bỏ ngang thì trang rỗng còn trong cây (có từ trước, xoá tay). **[đã sửa ở đợt 2·A: trang mới chỉ hiện khối soạn, chỉ tạo trên máy chủ khi bấm Lưu, nháp cục bộ giữ lại]** `GET /triage` vẫn trả danh sách việc chờ duyệt cho người xem được dự án mà không có `issue:triage` (việc đó vẫn tìm được qua JQL; mọi nút Nhận/Từ chối/Tạm hoãn chặn bằng `issue:triage`). **[đã sửa ở đợt 2·A: danh sách và số đếm Việc mới vào chỉ trả cho người có quyền duyệt việc; phạm vi và phần còn mở: xem "Còn mở" đợt 2·A]** Kéo-thả xếp hạng đọc mốc ngoài khoá dự án — kéo xuống cuối đúng lúc có người tạo việc có thể ra hai việc cùng rank (server tự đánh số lại ở lần thả kế tiếp). **[đã sửa ở đợt 2·A: vị trí được tính sau khi khoá dự án]** Ô "Múi giờ" ở hồ sơ cá nhân vẫn là ô gõ tên IANA. **[đã sửa ở đợt 2·A: chọn từ danh sách có tìm kiếm]**

---

# Giao diện đợt 1 (2026-10-18)

Đợt chuẩn hoá giao diện đầu tiên, chỉ đổi cách hiển thị và thao tác — **không đổi cấu trúc cơ sở dữ liệu, không đổi dữ liệu có sẵn**.

## 1. Cần làm khi triển khai

- Không cần chạy thêm lệnh nào cho cơ sở dữ liệu.
- **Triển khai lại cả web lẫn API cùng lúc.** Máy chủ mới trả thêm hạng ưu tiên cho bảng SLA (để vẽ mũi tên) và điền tên người thực hiện cho thông báo cũ khi mở. Nếu chỉ có web mới mà API cũ: bảng SLA hiện mũi tên "trung bình" cho mọi việc, và thông báo cũ có người thực hiện hiện "Một thành viên" thay vì tên thật. Cả hai chỗ chỉ thêm/điền dữ liệu nên client cũ không hỏng.
- Máy chủ cũng đổi vài chữ hiển thị (cần biết nếu có ai đối chiếu bằng chữ cũ):
  - Quy tắc tự động dùng `{{actorName}}` mà không tra ra tên người thực hiện nay ghi **"Hệ thống"** thay vì "Ai đó".
  - Tiêu đề thông báo (trong app, email và Telegram) khi thiếu tên người thực hiện: "Hệ thống" nếu do hệ thống làm, "Một thành viên" nếu người đó không còn tài khoản — không còn "Ai đó".

## 2. Thay đổi người dùng thấy

### Nút và ô nhập vô hiệu

- Nút, ô nhập, ô chọn, ô ngày bị vô hiệu nay có nền xám và chữ xám rõ ràng (cả giao diện sáng lẫn tối) thay vì mờ đi; con trỏ hiện dấu cấm. Nút đang xử lý vẫn giữ màu của nút kèm vòng quay, không bị nhầm với nút bị khoá.

### Mức ưu tiên

- Ưu tiên hiện bằng **mũi tên theo thứ bậc** (⇈ cao nhất, ↑ cao, = trung bình, ↓ thấp, ⇊ thấp nhất) thay cho chấm màu, ở thẻ Bảng việc, dòng Việc chờ, Tổng quan, Việc mới vào, SLA và Cây việc. Rê chuột hoặc dùng trình đọc màn hình sẽ nghe "Ưu tiên: <tên>". Đổi tên/màu/số mức ở Cài đặt thì mũi tên vẫn đúng thứ bậc.

### Không tìm thấy, không có quyền, lỗi

- Gõ sai đường dẫn → trang **"Không tìm thấy trang"** ngay trong khung ứng dụng (menu vẫn còn), gợi ý tối đa 3 trang gần đúng và nút "Về Tổng quan". Trang báo lỗi chỉ còn dành cho lỗi thật.
- Mở công việc không tồn tại → "Không tìm thấy công việc <mã>" kèm gợi ý mã gần đúng, không còn vòng quay chạy mãi cạnh dòng báo lỗi.
- Mất mạng/máy chủ lỗi được báo khác với "không tìm thấy" (và có nút thử lại). Nếu việc đang mở mà lần làm mới ngầm bị lỗi, nội dung đang xem **được giữ nguyên**, không bị thay bằng màn lỗi.

### Màn trống

- Mọi màn/ô trống dùng cùng một kiểu: biểu tượng + một câu giải thích + nút hành động kế tiếp (khối trống tự vẽ, viền đứt, chữ trần đã được thay hết); ô nhỏ trong thẻ dùng bản gọn.
- Ma trận rủi ro 5×5 ở Rủi ro & vướng mắc **ẩn khi chưa có mục nào** (không còn lưới trống). Trang quản trị có nút **"Xoá bộ lọc"** khi lọc ra kết quả rỗng.

### Ô chọn

- Hết ô chọn mặc định của trình duyệt trong toàn app. Lựa chọn ít (tối đa 4, nhãn ngắn) hiện thành **nhóm nút bấm** — bấm lại mục đang chọn không làm gì; lựa chọn nhiều dùng ô chọn có tìm kiếm.
- Ô chọn có tìm kiếm dùng được hoàn toàn bằng bàn phím (↑ ↓ Home End, Enter chọn, Esc đóng), mục có thể có dòng mô tả và biểu tượng; danh sách từ 6 mục trở xuống **không hiện ô tìm** (gõ chữ cái đầu để nhảy tới mục), ô tìm chỉ hiện khi danh sách dài hoặc tìm trên máy chủ. Chọn lại giá trị đang có không còn làm mất những gì bạn vừa nhập ở các biểu mẫu quy tắc/bộ lọc.

### Điện thoại và máy tính bảng (dưới 1024px)

- Thanh tab ở đáy màn hình: **Tổng quan · Dự án · ＋ Tạo · Thông báo · Tôi** (ở Quản trị hệ thống là 4 mục + Tôi). "Tạo" mở danh sách việc tạo mới, "Tôi" mở danh sách các mục còn lại và tài khoản (đổi giao diện sáng/tối, đăng xuất…). Hết menu trượt, nút ba gạch và nút nổi "Tạo" ở góc.
- Thanh trên cùng có nút **Tìm** mở bảng lệnh. Thanh thao tác hàng loạt và thông báo nhanh nằm ngay trên thanh tab; khi đang có thanh "Có thay đổi chưa lưu" thì thông báo nhanh nằm trên cả thanh đó (không che nút Lưu / Bỏ thay đổi). Từ 1024px trở lên (máy tính) giao diện và nút nổi giữ nguyên.
- Cuối trang trên điện thoại không còn khoảng trắng thừa dành cho nút nổi (nút nổi chỉ có trên máy tính).
- Màn cảm ứng không còn hiện gợi ý phím (⌘K, ↵…); trang Tài liệu hướng dẫn và bảng phím tắt vẫn ghi đủ tên phím.

### Thay đổi chưa lưu

- Ở Cấu hình dự án › Chung, Hồ sơ và banner bảo trì, nút Lưu cuối thẻ được thay bằng thanh dính ở đáy: **"Có thay đổi chưa lưu · Bỏ thay đổi · Lưu"**. Enter trong ô một dòng vẫn lưu.
- Rời trang, đổi mục trong cùng trang, đổi hoặc tạo không gian làm việc khi đang sửa dở → hỏi trước khi bỏ. Đổi mật khẩu chỉ chặn khi rời trang (không có thanh Lưu).

### Chữ và ngày tháng

- Nút huỷ luôn là "Huỷ". Tên mục menu **trùng tiêu đề trang** (ví dụ "Quy trình", "Kết nối", "Thành viên"); trang chứa danh sách quy trình tên "Danh sách quy trình".
- Bỏ "Project ID" (thành "Dự án"), "dashboard" (thành "bảng tổng quan"), "board" ở chữ hiển thị (thành "bảng việc"), "bên trái" (sai trên điện thoại), "Trường tuỳ chỉnh" (thành "Trường thông tin thêm").
- Người thực hiện: có tên thì hiện tên; **"Hệ thống"** chỉ khi do hệ thống/automation làm; thông báo cũ chưa lưu tên được điền tên thật khi mở, nếu không tra ra (tài khoản đã xoá) thì ghi **"Một thành viên"** — không còn "Ai đó".
- Không còn lộ mã nội bộ bằng tiếng Anh trong lịch sử hoạt động (nay là "ghi thời gian" kèm biểu tượng); vai trò luôn bằng tiếng Việt.
- Ngày tháng thống nhất: `17/10` (trục biểu đồ), `17/10/2026`, **`T10/2026`** (lộ trình, Gantt), "Thứ Bảy, 17/10/2026" (Tổng quan); số lớn có dấu phân cách.

## 3. Còn mở / tồn đọng

Những điểm người dùng có thể nhận ra, đã biết và chưa sửa ở đợt 1:

- **Gantt/Lộ trình:** khi khoảng thời gian chỉ 1 ngày, nhãn tháng bị tràn; nhãn `T10/2026` dài hơn trước nên dễ chật. — **đã sửa ở đợt 2·A** (nhãn tháng tự rút gọn theo bề rộng: `T10/2026` → `T10` → ẩn, rê chuột vẫn thấy đủ; Lộ trình chỉ ghi năm ở tháng đầu và tháng 1)
- **Điện thoại:** nhóm nút chọn trạng thái ở mục Phiên bản (Cấu hình dự án) có thể chật ở màn 390px (chưa kiểm). Một số ô chọn mới thay (Bộ lọc, Tự động hoá, một vài biểu mẫu) chưa được xem lại bằng mắt ở mọi kích cỡ. — **nửa đầu đã kiểm ở đợt 2·A** (mục Phiên bản vừa 390px, không nhãn nào bị cắt); nửa sau (ô chọn mới ở Bộ lọc, Tự động hoá, biểu mẫu) **vẫn chưa xem lại bằng mắt**
- **Hướng dẫn lần đầu (tour):** bước 4 vẫn ghi "Nhấn ⌘K" dù trên điện thoại nó chỉ vào nút Tìm. — **đã sửa ở đợt 2·A**
- **Cảm ứng:** dòng gợi ý "Ctrl/Cmd+Enter để lưu" ở chân một số hộp thoại vẫn hiện. — **đã sửa ở đợt 2·A** (ẩn cả trên máy tính bảng cảm ứng)
- **Ô nhập/nút vô hiệu:** khoảng 35 chỗ ngoài các thành phần dùng chung vẫn làm mờ bằng độ mờ cũ; nút đang xử lý còn đổi nền nhẹ khi rê chuột. Hai cách viết "Độ ưu tiên" (nhãn trường trong bộ lọc/automation) và "Mức ưu tiên" (menu) cùng tồn tại; một vài mô tả dưới tiêu đề còn lặp lại ý của tiêu đề. — **đã sửa ở đợt 2·A** (chuyển sang nền/chữ xám; nút đang xử lý không đổi nền khi rê chuột; "Độ ưu tiên" thành "Mức ưu tiên" mọi nơi; mô tả lặp tiêu đề đã bỏ ở Khách hàng, Cấu hình hệ thống, Thành viên, Nhập dữ liệu — còn lại vài chỗ nhỏ, xem mục 3 đợt 2). Cố ý giữ độ mờ ở nút chỉ có biểu tượng/nút chữ không nền, ô tích và công tắc
- **Thay đổi chưa lưu:** chuyển không gian làm việc rồi bị lỗi thì bản nháp đã mất; mở Tích hợp bằng đường dẫn có sẵn mục cần mở thì không hỏi trước khi bỏ bản nháp; trình duyệt tự điền mật khẩu có thể làm trang Tài khoản tưởng là đang sửa; gõ tiếp trong lúc đang lưu ở mục Chung có thể bị ghi đè; hộp xác nhận lồng nhau khi tạo không gian làm việc mới chưa được thử kỹ trên trình duyệt. — **đã sửa ở đợt 2·A** (cả năm điểm đã sửa; tự điền mật khẩu chỉ tính là sửa dở khi có mật khẩu mới): đổi không gian làm việc lỗi không mất bản nháp; mở Ứng dụng bên ngoài bằng liên kết trỏ thẳng tới mục được hỏi trước; gõ tiếp lúc đang lưu không bị ghi đè; hộp xác nhận lồng khi tạo không gian mới đã bỏ
- **Vai trò:** tiêu đề hộp thoại ở Vai trò & quyền và nhãn tài khoản mẫu ở màn đăng nhập còn tên vai trò gốc tiếng Anh. Một vài nhãn (Vai trò & quyền, Nhật ký quản trị, Tự động hoá, Danh mục dự án, bảng lệnh) vẫn viết tay thay vì lấy từ nguồn chung — hiện còn khớp, nhưng đổi tên menu sau này phải sửa thêm ở đó. — **đã sửa ở đợt 2·A** (tên vai trò tiếng Việt ở hộp thoại và màn đăng nhập; các nhãn lấy từ bộ tên chung, kể cả lệnh "Mở Rủi ro & vướng mắc")
- **Trợ năng:** các tab trong Cài đặt bảng được trình đọc màn hình đọc như nhóm nút chọn (cần thành phần Tab riêng); nhóm nút chọn chưa gắn được dòng mô tả/báo lỗi cho trình đọc màn hình; trang báo trạng thái hệ thống luôn dùng cấp tiêu đề lớn nhất. — **đã sửa ở đợt 2·A** (các hàng tab là tab thật; nhóm nút chọn đọc được mô tả/báo lỗi; khung xem nhanh không giành tiêu đề chính)
- **404:** đường dẫn lạ bên trong một dự án hiện trang không tìm thấy nhưng không có thanh điều hướng của dự án; gợi ý mã gần đúng ở trang công việc không tồn tại có thể thoáng hiện kết quả của mã trước. — **đã sửa ở đợt 2·A** (địa chỉ lạ trong dự án hiện "Không tìm thấy" ngay trong khung dự án, gợi ý các màn của dự án đó; gợi ý mã không còn thoáng hiện kết quả mã trước)
- **Chưa kiểm sau khi triển khai:** việc điền tên thật cho thông báo cũ mới được kiểm bằng test của API, sẽ kiểm trên trình duyệt sau khi API được triển khai lại.
- **Kỹ thuật (không ảnh hưởng người dùng):** vị trí hàm lấy hạng ưu tiên, một số kiểm thử còn thiếu (gợi ý đường dẫn, rào chắn giữ-trang, kiểm thuật ngữ với chuỗi xuống dòng), hai hàm định dạng số trùng nhau. — **đã sửa ở đợt 2·A** (chuyển vị trí hàm lấy hạng ưu tiên; thêm kiểm thử còn thiếu; gộp hai hàm định dạng số)

---

# Giao diện đợt 2 · Phần A (2026-10-19)

Phần A của đợt chuẩn hoá thứ hai: dọn các tồn đọng của đợt 1 và sửa bốn việc "chưa sửa" sau smoke vòng 2. **Không đổi cấu trúc cơ sở dữ liệu** (không có migration mới); có đổi hành vi máy chủ ở hai chỗ (quyền Việc mới vào, khoá khi kéo-thả).

## 1. Cần làm khi triển khai

- Không cần chạy lệnh nào cho cơ sở dữ liệu.
- **Triển khai API cùng lúc với web.** Hai chỗ phụ thuộc vào nhau:
  - Việc mới vào: máy chủ nay chỉ trả danh sách và số đếm cho người có quyền **"duyệt việc"** (`issue:triage`); web mới ẩn mọi lối vào cho người không có quyền này. Web mới: người có quyền "duyệt việc" vẫn thấy mục Việc mới vào, người không có quyền thì không còn thấy. Web cũ + API mới: người không có quyền vẫn thấy mục rồi nhận lỗi "không có quyền" khi mở.
  - Kéo-thả xếp hạng: máy chủ mới khoá theo dự án khi tính vị trí. Chỉ cần API mới; web không đổi.
- **Hướng dẫn lần đầu tự cập nhật:** khi API khởi động, tour "Trang chủ" lên phiên bản 2 (bước 4 nói về nút Tìm trên điện thoại và ⌘K / Ctrl+K). Không cần chạy lại `db:seed`; các tour khác không đổi.
- **Người không có quyền "duyệt việc" nữa không thấy Việc mới vào:** mục không còn trong menu "Thêm" (cả trên điện thoại) và bảng lệnh ⌘K; mở thẳng địa chỉ của mục này hiện "Không có quyền". Quản trị và các vai trò đã có quyền này (Project Admin, Project Developer, Business Analyst, Product Owner, Scrum Master, Tester) không đổi.
  - **Các vai trò mặc định sẽ mất danh sách Việc mới vào vì không có `issue:triage`:** Lập trình viên (Developer, vai trò thành viên mặc định), Thiết kế (Designer), Vận hành hệ thống (DevOps), Người duyệt (Reviewer), Bên liên quan (Stakeholder), Người báo lỗi (Project Reporter). Vai trò cấp không gian làm việc (Workspace Member, Workspace Viewer) vốn không có quyền việc. Người triển khai cần cấp thêm `issue:triage` ở Vai trò & quyền cho vai trò nào vẫn phải duyệt việc (ví dụ Lập trình viên nếu nhóm không có người duyệt riêng); người báo việc vẫn theo dõi được việc của mình ở nơi khác.
- **Kéo-thả xếp hạng khoá theo từng dự án:** nhiều người kéo thả cùng lúc trong **một** dự án sẽ xếp hàng chờ nhau (mỗi lần thả rất ngắn nên thường không nhận ra; khi phải đánh số lại cả dự án có thể chờ lâu hơn, tối đa 30 giây). Hai dự án khác nhau không chờ nhau.

## 2. Thay đổi người dùng thấy

### Chữ và nhãn

- **"Mức ưu tiên"** là tên duy nhất ở mọi nơi (nhãn trường trong bộ lọc và tự động hoá, trang Nhập dữ liệu, mô tả công cụ cho trợ lý AI); không còn "Độ ưu tiên".
- Menu, tiêu đề trang, bảng lệnh và tên trang trong khung dự án dùng chung một bộ tên nên không còn lệch (Vai trò & quyền, Nhật ký quản trị, Tự động hoá, Danh mục dự án, Rủi ro & vướng mắc…). Lệnh "Mở Rủi ro & vướng mắc" ở bảng lệnh dự án, tiêu đề "Cờ tính năng" ở Cấu hình hệ thống và nút Tìm trên điện thoại ("Tìm và chạy lệnh nhanh") nay khớp với chữ ở nơi khác.
- Tên vai trò hiện bằng tiếng Việt ở tiêu đề hộp thoại Vai trò & quyền và ở các tài khoản mẫu màn đăng nhập.
- Mô tả dưới tiêu đề không còn nhắc lại tiêu đề (Khách hàng, Cấu hình hệ thống, Thành viên, Nhập dữ liệu).
- Hướng dẫn lần đầu, bước 4 ("Tìm và chạy lệnh nhanh"): "Bấm nút Tìm hoặc nhấn ⌘K / Ctrl+K để tìm công việc, dự án hoặc chạy lệnh."

### Ngày tháng, Gantt và Lộ trình

- Nhãn tháng trên trục tự rút gọn theo bề rộng ô: `T10/2026` khi đủ chỗ, `T10` khi chật, ẩn khi quá hẹp (rê chuột vẫn thấy tên đầy đủ). Lộ trình chỉ ghi năm ở tháng đầu và ở tháng 1 (`T10/2026, T11, T12, T1/2027`).

### Nút và ô nhập vô hiệu

- Phần còn lại của nút, ô nhập và ô chọn bị vô hiệu cũng dùng nền xám + chữ xám thay vì làm mờ. Riêng **nút bật/tắt dạng viên thuốc** (chọn tuỳ chọn ở Trường thông tin thêm, chọn tuần ở Bắt đầu sprint) vẫn thấy rõ đang bật hay tắt khi bị khoá.
- Nút đang xử lý không còn đổi nền nhẹ khi rê chuột.
- Cố ý vẫn làm mờ: nút chỉ có biểu tượng, nút chữ không nền, ô tích và công tắc (nền xám sẽ thành một đốm xám vô nghĩa).

### Cảm ứng

- Dòng gợi ý "Ctrl/Cmd+Enter để lưu/gửi" ở chân các hộp thoại và ô soạn thảo ẩn trên màn cảm ứng, kể cả máy tính bảng; chữ gợi ý trong ô bình luận không còn nhắc phím.

### Tab và trợ năng

- Mọi hàng tab (Vai trò & quyền, Tài nguyên, Hệ thống, Lịch sử wiki, Rủi ro, Thành viên, Danh mục dự án, Tự động hoá, Báo cáo, Thông báo, Cài đặt bảng) được trình đọc màn hình nhận ra là tab thật: phím ←/→/Home/End chuyển tab, phím Tab chỉ dừng ở tab đang chọn. Dùng chuột không đổi. Tab "Loại nhật ký" ở Hệ thống dùng cùng kiểu gạch chân như các tab khác.
- "Sơ đồ / Danh sách" ở Quy trình là nhóm nút chọn (chọn một trong hai kiểu xem), không còn là tab.
- Nhóm nút chọn đọc được dòng mô tả và báo lỗi bằng trình đọc màn hình; khung xem nhanh việc không còn giành tiêu đề chính của trang.

### Không tìm thấy

- Gõ sai địa chỉ **bên trong một dự án** (ví dụ ".../DEMO/bakclog") hiện trang "Không tìm thấy" ngay trong khung dự án (thanh điều hướng dự án còn), nút chính "Về Bảng việc" và gợi ý các màn của chính dự án đó.
- Trang "Không tìm thấy công việc" không còn thoáng hiện gợi ý của mã trước.

### Việc mới vào

- Chỉ người có quyền duyệt việc mới thấy mục, danh sách và số đếm (xem mục 1). Người không có quyền mở thẳng địa chỉ thấy "Không có quyền", không phải chờ lâu.
- Sau khi gửi báo lỗi/việc, thông báo ghi "Đã gửi <mã> — đang chờ người phụ trách duyệt" (không nhắc tên màn Việc mới vào, vì phần lớn người báo không còn mở được màn này).

### Thay đổi chưa lưu

- **Đổi không gian làm việc** khi đang sửa dở: chỉ bỏ bản nháp **sau khi đổi thành công**; nếu lỗi thì bản nháp còn nguyên.
- Mở Ứng dụng bên ngoài bằng liên kết trỏ thẳng tới một mục khi đang sửa dở mục khác thì được hỏi trước; bấm Huỷ thì giữ nguyên mục cũ.
- Gõ tiếp trong lúc đang lưu (Cấu hình dự án › Chung, Hồ sơ) không bị ghi đè: phần gõ thêm vẫn là thay đổi chưa lưu.
- Nút "Tạo không gian làm việc" hỏi một lần duy nhất (hết hộp xác nhận lồng nhau).
- Trang Tài khoản không còn tưởng là đang sửa chỉ vì trình duyệt tự điền mật khẩu hiện tại.

### Kéo-thả xếp hạng

- Kéo-thả việc xuống cuối đúng lúc người khác tạo việc mới không còn có thể cho hai việc cùng vị trí; vị trí được tính sau khi khoá dự án (xem mục 1 về hàng chờ).

### Wiki

- **"Tạo trang mới" không tạo trang rỗng nữa:** bấm là mở khung soạn trống, chỉ khi bấm **Lưu** (Ctrl/⌘+Enter) mới tạo trang. Huỷ/Esc thì không để lại gì. Tiêu đề trống thì báo như trước. Bản nháp tự lưu trên máy: đóng tab hoặc tải lại trang rồi mở lại sẽ được đề nghị khôi phục. Giữ phím Lưu không còn tạo hai trang.
- Lưu ý nhỏ: gõ thêm trong khoảnh khắc đang tạo trang (giây đầu tiên sau khi bấm Lưu) có thể không được giữ.

### Hồ sơ cá nhân

- **Múi giờ** chọn từ danh sách có tìm kiếm bằng tên quen thuộc (gõ "Hà Nội", "Việt Nam", "Tokyo"), thay cho ô gõ tên kỹ thuật (như "Asia/Ho_Chi_Minh"). Cách lưu không đổi; tên cũ như "Asia/Saigon" được quy về tên chuẩn, tên lạ đã lưu từ trước vẫn hiện.

## 3. Còn mở

- **Ruling RA5, cần chủ sản phẩm quyết định có siết thêm không:** việc "đang chờ duyệt" chỉ bị ẩn khỏi **danh sách và số đếm Việc mới vào**. Người xem được dự án vẫn đọc được việc chờ duyệt qua đường dẫn trực tiếp (`GET /issues/<mã>`), dòng hoạt động và gợi ý trùng lặp khi báo việc (cùng loại với việc vẫn tìm thấy qua bộ lọc nâng cao và ⌘K như cũ). Nếu cần siết: kiểm trạng thái duyệt ở các đường đó, miễn cho người báo; chi phí là một đợt sửa nhỏ ở máy chủ.
- **Wiki:** trang mới chưa lưu không cho biết nó sẽ nằm ở nhánh/dự án nào khi bạn đổi phạm vi; chữ gõ thêm trong lúc đang lưu lần đầu có thể mất.
- **Đổi tên hồ sơ** cũng chuẩn hoá múi giờ cũ về tên chuẩn khi lưu (ví dụ "Asia/Saigon" thành "Asia/Ho_Chi_Minh"). Máy chủ chưa kiểm tên múi giờ có hợp lệ không (chỉ giao diện đưa ra danh sách).
- **Kéo-thả:** các lần thả có mốc trong cùng dự án xếp hàng (mục 1); thời gian chờ tính vào hạn 30 giây của thao tác.
- **Nút bật/tắt dạng viên thuốc:** ở Trường thông tin thêm, tất cả bị khoá cùng lúc trong khi lưu một lựa chọn.
- **Chữ:** phần kiểm thuật ngữ tự động mới chỉ áp cho giao diện web, chưa áp cho công cụ MCP.
- **Hộp thoại Từ chối** (Việc mới vào) trên màn cảm ứng còn một dòng trống ở chân.
- **Tab:** bấm phím mũi tên là chuyển luôn sang tab đó (tab nào tải dữ liệu thì mỗi lần bấm là một lần tải); phím Tab chưa nhảy vào vùng nội dung của tab.
- **Điều hướng:** đường lạ trong dự án chưa tồn tại có thể thoáng hiện trang "Không tìm thấy" trong lúc dự án đang tải; nếu tải quyền bị lỗi mạng thì Việc mới vào hiện "Không có quyền" thay vì báo lỗi; lệnh Việc mới vào ở ⌘K chỉ xuất hiện sau khi quyền đã tải xong.
- **Kỹ thuật (không ảnh hưởng người dùng):** hai lần khoá dự án khi đánh số lại; test mới chủ yếu kiểm hàm thuần và đọc mã nguồn (chưa có test chạy trên trình duyệt thật).

---

# Giao diện đợt 2 · Phần B (2026-10-19)

Phần B của đợt chuẩn hoá thứ hai: **khung trang và điều hướng**. Mọi màn dùng chung một khung (bề rộng, đệm, đầu trang, thẻ, menu con) thay cho cách mỗi trang tự dựng. Chỉ đổi giao diện web.

## 1. Cần làm khi triển khai

- **Chỉ cần triển khai web.** Không đổi API, không có migration, không phải chạy `db:raw` hay lệnh nào khác.
- **Liên kết cũ vẫn dùng được, không phải đổi gì:** địa chỉ có `?section=` của Ứng dụng bên ngoài và Cấu hình dự án được tự chuyển sang địa chỉ mới (xem mục 2). Dấu trang, tài liệu, tin nhắn đã gửi không bị gãy.
- Trang Hướng dẫn nhận thêm liên kết sâu (`/documentation#<mục>`) để các dòng "Tìm hiểu thêm" mở đúng mục; không cần cấu hình.

## 2. Thay đổi người dùng thấy

### Khung trang thống nhất

- **Bề rộng theo loại màn:** form hẹp (Cài đặt, Thành viên, Thông báo, Tài khoản, Kết nối), màn làm việc vừa (chi tiết công việc, Bộ lọc, Wiki, Quản trị hệ thống, Quy trình, Vai trò & quyền), bảng dày (Tổng quan, Dự án, Bảng tổng quan, các trang Danh mục) và tab trong dự án rộng hết vùng nội dung. Nội dung các màn bắt đầu cùng một chỗ nên đổi màn không bị lệch tay.
- **Đầu trang giống nhau:** đường dẫn (nếu có) → tiêu đề → một dòng mô tả → nút chính bên phải. Nút "tạo" chính của trang nằm ở góc phải đầu trang; riêng các trang sửa danh sách tại chỗ (Mức ưu tiên, Mức nghiêm trọng, Trường thông tin thêm, Quy trình) vẫn có nút "Thêm…" ngay dưới danh sách. Nút tạo trong khối "chưa có gì" là nút phụ (nền xám), không tranh chú ý với nút chính.
- **Mô tả ngắn lại còn một câu** ở Cài đặt, Danh mục, Quản lý, Kết nối, Tài khoản…; các ví dụ và công thức dài đã chuyển đi (công thức tính nhân lực nay nằm ở chú giải của bảng khối lượng). Những mô tả có tài liệu đi kèm thêm **"Tìm hiểu thêm"** (mở trang Hướng dẫn đúng mục ở tab mới).
- Các thẻ trong Cài đặt, Thành viên, Danh mục… dùng cùng một kiểu thẻ (biểu tượng, tiêu đề, mô tả, nút ở góc phải).
- **Đường dẫn (breadcrumb) đã chuyển chỗ:** ở **Wiki**, đường dẫn các trang cha (`trang cha › trang đang xem`, chỉ hiện khi trang có trang cha) nay nằm đầu trang, phía trên tiêu đề, thay vì ở trong bài viết. Ở **xem bảng tổng quan tuỳ biến**, liên kết "← Tổng quan" được thay bằng đường dẫn "Tổng quan › <tên bảng>" (không in ra giấy). Ở **chi tiết công việc**, đường dẫn dùng chữ đơn cách cho mã và rê chuột vào việc cha/Epic thấy tên đầy đủ; "Quay lại" nằm bên phải cùng hàng. Trên điện thoại, trang nằm trong menu con chỉ hiện nút "‹ khu vực", không hiện đường dẫn.
- Thẻ đầu của Cài đặt › Thông báo đổi tên từ "Thông báo" thành **"Trong ứng dụng"** (khỏi trùng với tiêu đề trang).
- **Màn chi tiết công việc:** tiêu đề công việc đã sửa tại chỗ được trình đọc màn hình đọc là tiêu đề chính của trang; cách bấm để sửa, Esc huỷ, Enter lưu không đổi.
- **Tổng quan quản trị hệ thống:** nút làm mới là nút biểu tượng; rê chuột thấy "Làm mới · <thời điểm cập nhật>".
- Nút chỉ có biểu tượng lớn lên **44px trên màn cảm ứng** (36px với chuột như trước).

### Menu con và điện thoại

- **Cài đặt, Quản lý (Danh mục) và Kết nối trên điện thoại** mở ra một **danh sách mục**; chạm một mục để vào, bấm "‹" (hoặc nút Back của trình duyệt) để về danh sách. Trên máy tính vẫn là menu bên trái như cũ, mở thẳng mục đầu tiên. Menu bên trái không còn chữ hoa nhỏ.
- **Cấu hình dự án** cũng theo kiểu đó: trên điện thoại là danh sách 6 mục (Chung, Thành viên, Thành phần, Phiên bản, Nhãn, Xuất / Nhập dữ liệu).

### Địa chỉ mới

| Trang | Địa chỉ mới | Địa chỉ cũ |
|---|---|---|
| Ứng dụng bên ngoài | `/connect/integrations/telegram`, `/repos` (chỉ khi bật cờ Kho mã lúc build), `/digest` | `/connect/integrations?section=digest` → chuyển sang `/digest` |
| Cấu hình dự án | `/p/<mã>/config/general`, `/members`, `/components`, `/versions`, `/labels`, `/data` | `/p/<mã>/config?section=members` → chuyển sang `/members` |

Mục **Kho mã (`/repos`) chỉ có khi bật cờ build `VITE_FEATURE_REPOS=1` (mặc định tắt)**; khi tắt, mục không hiện trong hàng tab và địa chỉ `/repos` chuyển về Telegram. Địa chỉ gốc (`/connect/integrations`, `/p/<mã>/config`) mở mục đầu (Telegram / Chung); mục lạ (`?section=abc`) cũng về mục đầu. Nút Back của trình duyệt đi qua từng mục.

### Sửa dở rồi đổi mục

- Ở Cấu hình dự án, đang sửa dở "Chung" mà bấm sang mục khác thì vẫn được hỏi "Bỏ các thay đổi chưa lưu?" (nay do cơ chế chặn rời trang chung làm, không còn mã riêng từng trang). Huỷ thì ở lại với phần đã gõ.
- Các mục của Ứng dụng bên ngoài hiện chưa có biểu mẫu nào giữ trạng thái "chưa lưu", nên chưa có gì để hỏi ở đó.

### Tab trong dự án

- Việc mới vào, Thùng rác, Hoạt động, Cây việc, Báo cáo có tiêu đề cùng kiểu và rộng hết vùng nội dung. Nút "Gửi yêu cầu" của Việc mới vào nằm ở góc phải đầu trang. Báo cáo có tiêu đề "Báo cáo" phía trên hàng tab.
- **Trình đọc màn hình:** mỗi trang đúng một tiêu đề chính. Với tab trong dự án đó là tên dự án; trên điện thoại (nơi tên dự án đã hiện ở ô chọn dự án) vẫn còn trong dòng đọc của trình đọc màn hình nhưng không hiện lặp trên màn hình.

## 3. Còn mở

- **Màn rất rộng:** Việc mới vào, Thùng rác, Hoạt động nay trải hết vùng nội dung (theo quy ước tab trong dự án), nên dòng danh sách rất dài trên màn lớn. Nếu thấy khó đọc có thể đặt giới hạn riêng cho ba tab này.
- **Cần mắt người kiểm với dữ liệu thật:** bước ghép trường của Nhập dữ liệu (bước 2–3) ở bề rộng máy tính bảng; thẻ "Đang chạy đồng hồ" của Cam kết thời gian khi có công việc đang chạy (môi trường thử chưa có dữ liệu).
- **Kết nối:** vào `/connect` từ liên kết cũ chuyển hướng hai lần và làm rơi `?project=` (đã vậy từ trước); chạm một mục trong danh sách Kết nối trên điện thoại cũng không giữ `?project=`.
- **Báo cáo:** bản in vẫn có tiêu đề "Báo cáo" phía trên các biểu đồ.
- **Tổng quan:** bản xem cho in vẫn có tiêu đề riêng (ẩn trên màn hình).
- **Bảng tổng quan tuỳ biến:** trình sửa có thêm khoảng 60px ở đầu để chứa tiêu đề trang (cần cho đúng một tiêu đề chính).
- **Chi tiết công việc trên điện thoại:** hàng "Quay lại / mã công việc" cao hơn trước một chút.
- **Cố ý giữ nguyên:** thẻ thu/mở của Danh mục (chương trình), Khách hàng và Mục tiêu là *mục của danh sách*, không đổi sang kiểu thẻ khu vực; rail 288px của Bộ lọc và Wiki rộng hơn menu 240px vì là danh sách động.
- **Kỹ thuật (không ảnh hưởng người dùng):** các test mới chủ yếu đọc mã nguồn và kết xuất tĩnh (chưa có test chạy trên trình duyệt thật); chưa có test chạy thật cho "trên điện thoại vẫn có một tiêu đề chính".

---

# Giao diện đợt 2 · Phần C (2026-10-20)

Phần C của đợt chuẩn hoá thứ hai ("gợi ý Lucian còn lại"): biểu mẫu và báo lỗi, danh sách và thao tác hàng loạt, xem nhanh, số liệu, thành viên và quyền, chia sẻ, cảm xúc bình luận, trợ lý AI có nguồn. **Có một migration (thêm một bảng, không đổi dữ liệu cũ), có đổi API ở nhiều chỗ (phần lớn chỉ thêm trường hoặc đường dẫn), thêm một thư viện cho web** (`@radix-ui/react-context-menu`, ghim đúng 2.3.1). **Đã sửa trong phần C — P-C14 (lỗ hổng có từ trước): người chỉ có `member:manage` không còn cấp/gỡ được `workspace:admin`; máy chủ trả 403 `ADMIN_GRANT_REQUIRES_ADMIN` — xem "Thay đổi API" và mục 3.** Các primitive mới và quy tắc rút ra nằm ở `DESIGN.md` (mục "Primitive biểu mẫu, dữ liệu và cộng tác") và `docs/UX_CONVENTIONS.md` (mục 20).

## 1. Cần làm khi triển khai

Thứ tự (theo "Checklist triển khai" của `docs/DEPLOY.md`):

1. Sao lưu cơ sở dữ liệu như mọi lần.
2. `pnpm install --frozen-lockfile` — `apps/web/package.json` thêm `@radix-ui/react-context-menu` **2.3.1** (ghim, không dấu `^`); lockfile chỉ thêm gói này, vẫn đúng một bản `@radix-ui/react-menu` (2.1.18).
3. `pnpm --filter @tirapro/types build`, rồi `pnpm --filter @tirapro/shared build` (shared phụ thuộc types; cả hai phải build trước API và web). `packages/types` đổi (`CommentReactionDto`, `COMMENT_REACTED`, `RoleDto.updatedAt`, các trường `expectedProgress`…) và `packages/shared` đổi (lược đồ `relax-counts`, `preview-match`, bộ lọc đã lưu, bộ tuần tự hoá JQL, emoji cảm xúc, nguồn AI, kiểm NUL).
4. `prisma migrate deploy` — migration **`20261019100000_comment_reaction`**: tạo bảng `CommentReaction` (id, commentId, userId, `emoji` VARCHAR(16), createdAt), chỉ mục duy nhất (commentId, userId, emoji), khoá ngoại xoá theo tầng tới `Comment` và `User` (xoá hẳn bình luận hay người dùng kéo theo xoá cảm xúc). Chỉ thêm bảng, an toàn với dữ liệu hiện có. Render/Docker tự chạy bước này khi API khởi động. Không cần `db:raw`.
5. Build lại API (`prisma generate` + `build`) và khởi động lại. **Bản build phải gồm commit `c45d27e8` trở đi** (sửa lỗi `OR: []` của xem trước quy tắc: bản cũ đếm "mọi việc" cho điều kiện không thể khớp).
6. Build lại web.

Thứ tự API/web: nên API trước hoặc cùng lúc. Web mới + API cũ không hỏng nhưng tính năng tương ứng tự ẩn: không có chấm cảm xúc, không có "N thành viên" ở bộ chọn không gian, không có gợi ý nới bộ lọc, không có dòng "Khớp N việc", không có avatar người làm trong thông báo, không có vạch kỳ vọng OKR, không có nguồn AI. API mới + web cũ chạy bình thường (các trường mới chỉ được thêm); riêng các luật ở "Luật mới" bên dưới có hiệu lực ngay.

### Thay đổi API

**Đường dẫn mới**

| Đường dẫn | Quyền | Ghi chú |
|---|---|---|
| `POST /search/relax-counts` | xem dự án (`@ProjectRef('body','projectId')`) | Body `{jql, projectId?}`. Trả `{clauses:[{text, jqlWithout, count}], remaining}` (tối đa 8 mệnh đề đầu; JQL một mệnh đề trả rỗng). Giới hạn 20 lần/phút theo IP. Phạm vi đếm = đúng phạm vi `GET /search` của người gọi. |
| `POST /automation/rules/preview-match` | `automation:manage` | Body `{projectId?, conditions[≤20]}`. Trả `{count, reason, timedOut, currentUserInJql}`. Chỉ đếm theo quyền của NGƯỜI SOẠN, bỏ dự án lưu trữ/xoá mềm. 30 lần/phút theo IP. Không xem trước được → `count:null` kèm lý do (không đếm xấp xỉ). |
| `PUT /comments/:id/reactions/:emoji` · `DELETE …` | xem dự án | Đặt/gỡ trạng thái tường minh (bấm đúp không đảo kết quả); chỉ gỡ cảm xúc của chính mình. Emoji ngoài bộ 👍 ❤️ 🎉 😄 🙏 👀 → 400. Dự án lưu trữ → 422; người ngoài dự án riêng tư → 404. |

**Phản hồi có thay đổi (chỉ thêm trường)**

- Mục tiêu và từng KR (`GoalDto`): thêm `expectedProgress` (số, hoặc `null` với kỳ tự do).
- `GET /notifications`: thêm `actorAvatarUrl` (`null` nếu không có người làm hoặc ảnh). Dòng đã có sẵn tên vẫn kích hoạt một truy vấn người dùng cho cả trang để lấy ảnh.
- `GET /auth/workspaces`: thêm `memberCount` = số thành viên **đang hoạt động** (không tính tài khoản vô hiệu hoá, không tính người dùng hệ thống). Bảng quản trị không gian (cột Thành viên) dùng cùng quy tắc.
- `RoleDto` (`GET/POST/PATCH /roles`): thêm `updatedAt`.
- `POST /ai/issues/:id/suggest`: thêm `sources?: [{issueId, key, summary}]` (tối đa 3). Nguồn do MÁY CHỦ chọn theo quyền xem của người gọi (không phải do mô hình), bỏ việc xoá mềm và việc báo từ ngoài chưa duyệt. Có cả khi chưa cấu hình `ANTHROPIC_API_KEY` (chế độ cơ bản).
- `GET /issues/:id/comments`: mỗi bình luận có `reactions: [{emoji, count, mine, users≤5}]` (luôn có, rỗng nếu chưa có). Một truy vấn cảm xúc cho cả trang.
- Sự kiện: domain `COMMENT_REACTED`, WebSocket `comment:reaction` `{commentId, issueId}` (không kèm tên) gửi tới phòng của dự án. **Cảm xúc không sinh thông báo.**

**Luật mới**

- `GET /issues/:id/watchers` chỉ trả người **không bị vô hiệu hoá** và **còn xem được dự án** (cùng cổng với việc gửi thông báo). Trước đây trả cả người đã rời, tức là lộ tên.
- `PATCH /roles/:id` nhận thêm `expectedUpdatedAt` (tuỳ chọn): lệch → **409 `VERSION_CONFLICT`**; bỏ trống = không kiểm (client cũ vẫn chạy). Gỡ `workspace:admin` khỏi một vai trò khiến không còn quản trị hoạt động → **409 `LAST_WORKSPACE_ADMIN`** (trước đây chỉ đường đổi vai trò của THÀNH VIÊN bị chặn; đường sửa VAI TRÒ để hở).
- Bộ lọc đã lưu mức **Dự án** (`PROJECT`) bắt buộc có `sharedProjectId`: tạo/sửa thiếu → 400. Bản ghi cũ không bị sửa (xem mục 2).
- Ký tự NUL hoặc UTF-16 hỏng (surrogate lẻ) trong điều kiện quy tắc/JQL → **400** (trước là 500) ở xem trước, tạo và sửa quy tắc, và khi engine đọc lại điều kiện đã lưu.
- Bình luận của **công việc đã xoá mềm**: thả cảm xúc, sửa, xoá → 404 (trước đây guard dự án không loại).
- Engine tự động hoá, phép `contains` gấp hoa/thường **từng ký tự**: İ (Thổ Nhĩ Kỳ) nay khớp `i`; sigma Hy Lạp cuối từ không còn khớp chéo; tiếng Việt không đổi. Xem trước chỉ đếm khi chữ nằm trong tập Latin/không có hoa-thường, ngoài ra báo "chỉ hỗ trợ chữ Latin".

**Giới hạn tài nguyên (cần biết khi chạy nhiều bản API).** Gợi ý nới bộ lọc và xem trước quy tắc dùng chung **một bộ đếm trong tiến trình** (`common/bounded-count.ts`) với số lần đếm cùng lúc = clamp(⌊cỡ pool Prisma / 3⌋, 1, 3) cho mỗi tiến trình API, hạn chờ tổng 5 giây, mỗi truy vấn `statement_timeout` 3 giây; lần đếm không kịp trả `count: null` ("không đếm kịp"). Với JQL có `text ~`, bước tra toàn văn của gợi ý nới bộ lọc cũng chạy trong đúng ngân sách đó (một chỗ + giao dịch `statement_timeout` 3 giây + hạn tổng 5 giây); không kịp thì mọi mệnh đề đều `count: null` (`GET /search` không đổi). Cỡ pool lấy từ `connection_limit` trong `DATABASE_URL`, nếu không có thì mặc định của Prisma `num_cpus*2+1` (1 vCPU = 3 kết nối → 1 chỗ; `connection_limit=10` → 3 chỗ, chừa 7 kết nối cho phần còn lại). `render.yaml` lấy `DATABASE_URL` từ DB quản lý và chuỗi đó không có `connection_limit`: **khuyến nghị thêm `&connection_limit=10` vào `DATABASE_URL` khi triển khai** (xem `docs/DEPLOY.md`). Số lượt đồng thời tối đa = số chỗ × số bản API. Giới hạn tốc độ tính **theo IP**, nên cần API thấy đúng IP người dùng khi chạy sau proxy.

**Thay đổi hành vi (P-C14 — chỉ quản trị mới cấp/gỡ `workspace:admin`)**

Chỉ người **đang giữ `workspace:admin`** (hoặc **admin hệ thống**) mới được cấp hoặc gỡ quyền quản trị. `member:manage` một mình không còn đủ. Người có `member:manage` nhưng không phải quản trị bị **403 `ADMIN_GRANT_REQUIRES_ADMIN`** ("Chỉ quản trị không gian làm việc mới cấp hoặc gỡ quyền quản trị.") khi:

- `PUT /members/:userId/roles` làm bộ vai trò **thêm hoặc bớt** một vai trò mang `workspace:admin` (kể cả vai trò hệ thống "Workspace Admin"); giữ nguyên vai trò quản trị đang có và chỉ đổi vai trò thường thì vẫn được.
- `POST /members`, `POST /members/bulk`, `POST /members/accounts` gán vai trò mang `workspace:admin`.
- `DELETE /members/:userId` gỡ khỏi không gian làm việc một người đang là quản trị (gỡ họ là gỡ quyền quản trị).
- Cấp dự án: `PUT /projects/:id/members/:userId/roles`, `POST …/members`, `POST …/members/bulk`, `DELETE …/members/:userId` thêm/gỡ vai trò dự án mang `workspace:admin` (hiện chỉ có thể xảy ra nếu một quản trị tạo vai trò dự án như vậy).
- `POST /roles` (gồm **Nhân bản**) với `permissionKeys` có `workspace:admin`.
- `PATCH /roles/:id` thêm hoặc gỡ `workspace:admin`, **và cả khi sửa bất kỳ phần nào (quyền khác, tên, mô tả, màu) của một vai trò đang giữ `workspace:admin`** — vì nó đổi quyền của mọi quản trị đang giữ vai trò đó. Sửa vai trò không dính quản trị thì không đổi.

Web phản chiếu: ô quyền `workspace:admin` và mọi ô của vai trò đang giữ nó bị khoá trên ma trận; nút Nhân bản của vai trò đó khoá; hộp sửa vai trò thành "chỉ xem" và ô `workspace:admin` vô hiệu; vai trò quản trị bị khoá khi đổi vai trò ngay trên hàng thành viên, khi thêm người và khi thêm hàng loạt — tất cả kèm lý do "Chỉ quản trị mới cấp/gỡ quyền này". Hộp xác nhận cấp quyền quản trị của người là quản trị vẫn giữ nguyên. Gọi nội bộ không có người gọi (seed, đăng ký, nhóm) không bị áp luật.

### Proxy

- **nginx phải chuyển tiếp `/realtime` kèm nâng cấp WebSocket** (`proxy_http_version 1.1;` `proxy_set_header Upgrade $http_upgrade;` `proxy_set_header Connection "upgrade";`). Banner mất kết nối và việc nối lại phía web dựa vào kết nối này; chưa kiểm được trên máy chủ thật (xem mục 3, danh sách kiểm).
- Cảm xúc đặt emoji trong đường dẫn (`/comments/:id/reactions/❤️`): cần kiểm là proxy chuyển tiếp đúng (xem danh sách kiểm).

## 2. Thay đổi người dùng thấy

### Biểu mẫu và báo lỗi

- **Báo lỗi theo trường:** gửi biểu mẫu thiếu dữ liệu không còn tắt nút hay chỉ hiện toast; hộp hiện tóm tắt "3 trường cần sửa" (mỗi dòng bấm để nhảy tới trường), lời lỗi ngay tại ô, và con trỏ tự vào ô lỗi đầu tiên. Áp cho Báo cáo định kỳ, Cam kết SLA, Tạo công việc, Báo lỗi và Quy tắc tự động hoá. Trình đọc màn hình đọc số lỗi mỗi lần bấm Gửi.
- **Nút "Tạo" có thêm lựa chọn:** ở hộp Tạo công việc, "Tạo" = tạo rồi mở việc (Ctrl/⌘+Enter như cũ); mũi tên ▾ có "Tạo & nhập tiếp" (Ctrl/⌘+Shift+Enter) và "Tạo & mở". Nhãn nút chính còn "Tạo" cho cả "Tạo việc con".
- **Chọn có mô tả dùng thẻ chọn:** mẫu dự án, cách giải quyết khi chuyển trạng thái, phạm vi chia sẻ, loại bảng và swimlane, Sprint đích. Nhóm lựa chọn ngắn (loại báo lỗi, chế độ, RAID, sức khoẻ) là khung phân đoạn liền thay cho các chip rời. Thang 1–5 của Rủi ro & vướng mắc nay là một nhóm: Tab dừng một lần, mũi tên đổi giá trị (trước đây mũi tên không làm gì).
- **Hai ngày bắt đầu–kết thúc** (Bắt đầu sprint, Sửa sprint, Hợp đồng, Chương trình, Nghỉ phép, Phân bổ) có dòng tóm tắt "14 ngày · 20/10 – 02/11" và báo lỗi ngay ở ô kết thúc khi kết thúc sớm hơn bắt đầu; lịch chọn ngày xám các ngày trước ngày bắt đầu.
- **Chọn màu:** nhãn, nhóm, chương trình, cột mốc, vai trò dùng cùng bảng 8 màu có tên tiếng Việt (thay cho ô màu của trình duyệt và các bảng riêng). Màu đã lưu từ trước không bị đổi, hiện thêm ô "Màu hiện tại" cho tới khi bạn chọn lại. Chữ nhãn đủ tương phản ở cả giao diện sáng và tối.
- **Gõ tên để xác nhận:** thu hồi API key, xoá quy trình, xoá trường thông tin thêm, xoá vai trò yêu cầu gõ đúng tên (bỏ qua khoảng trắng thừa, phân biệt hoa/thường). Các thao tác xoá khác xác nhận như cũ, kèm một dòng hậu quả.
- **Sao chép:** "Sao chép mã" và "Sao chép liên kết" thống nhất ở chi tiết công việc, xem nhanh và menu thao tác; liên kết sao chép luôn là `…/issue/MÃ` (không kèm `?peek=`). Dấu ✓ hiện 1,2 giây (trước là 2 giây ở các nút sẵn có).

### Bảng việc và Việc chờ

- **Chọn nhiều và thao tác hàng loạt trên Bảng việc:** ô tick trên thẻ (hiện khi rê chuột, luôn hiện khi đã chọn và trên điện thoại); Shift-click chọn dải; thanh thao tác hiện ngay trên thanh tab đáy, gồm gán cho tôi, đổi người phụ trách, điểm, ưu tiên, nhãn, trạng thái, có **Hoàn tác**. Nếu một phần bị từ chối (đụng WIP, người khác vừa sửa), phần đó vẫn được giữ chọn và Hoàn tác chỉ áp cho phần đã cập nhật.
- **Trên Bảng việc, Ctrl/⌘-click vào thẻ là chọn/bỏ chọn thẻ** (trước đây mở tab mới). Mở tab mới vẫn có ở: nhấp vào mã công việc, chuột giữa, và mục "Mở ở tab mới" trong menu. Ở Việc chờ, Bộ lọc và Cây việc, Ctrl/⌘-click vẫn mở tab mới.
- **Việc chờ trên điện thoại:** thanh hàng loạt đổi thành một hàng ("Đã chọn N việc" + Trạng thái + "…" + bỏ chọn), các thao tác còn lại nằm trong sheet đáy; thay cho dải cuộn ngang cũ. Esc khi đang gõ trong ô nhập không còn bỏ chọn (cả Bảng việc lẫn Việc chờ).
- **Menu chuột phải** trên thẻ/dòng ở Bảng việc, Việc chờ, Bộ lọc và Cây việc, cùng nút "…" ("Thao tác cho MÃ") với đúng các mục đó: xem nhanh, mở trang/tab mới, sao chép mã và liên kết, gán cho tôi, đổi trạng thái, ưu tiên… Trên màn cảm ứng không có chuột phải (nhấn giữ vẫn là kéo-thả); nút "…" nằm góc trên phải thẻ. Chuột phải vào mã công việc nay hiện menu này thay cho menu liên kết của trình duyệt.
- **Nút "Hiển thị" của Bảng việc:** chọn thẻ Thường/Gọn và bật/tắt người phụ trách, điểm, nhãn, ưu tiên, tiến độ việc con; có xem trước (trên điện thoại nằm trên cùng). Lưu theo từng bảng trên từng trình duyệt. **Không có công tắc "Hạn":** cảnh báo quá hạn/sắp hạn (viền + nhãn) luôn hiện vì là tín hiệu rủi ro.
- **Đồng hồ giới hạn:** cột có giới hạn WIP hiện thanh "WIP 3/5" (đổi màu và chữ "Đầy"/"Vượt N"); đầu mỗi sprint ở Việc chờ hiện "điểm đã xếp / velocity trung bình" (trung bình 3 sprint đã đóng gần nhất có làm việc; không hiện khi chưa có velocity hay không có quyền xem báo cáo).

### Xem nhanh việc

- Panel có nút **‹ ›** ("Việc trước/Việc sau") và "n/N" (hoặc "n/N+" khi còn trang chưa nạp); thẻ/dòng đang xem được tô nền. Nay có cả ở **Bộ lọc** (› ở cuối trang nạp thêm kết quả) và **Cây việc**. Trong Việc chờ, thứ tự và số đếm đúng cả khi danh sách dài chỉ vẽ một phần.
- **Trên điện thoại (dưới 768px)** xem nhanh là **sheet đáy** hai nấc (nửa màn / gần toàn màn, đổi bằng nút tay nắm). Back của Android/trình duyệt, Esc và X đều đóng, con trỏ về đúng thẻ/dòng. Sheet là hộp thoại modal nên phím `j`/`k` tắt trên điện thoại. Từ 768px vẫn là panel bên phải như cũ (tablet 768–1023px: ngăn kéo).
- **Chi tiết công việc trên điện thoại và tablet (dưới 1024px):** dải thuộc tính chính 2×2 (Trạng thái, Người phụ trách, Hạn, Ưu tiên) ngay đầu trang; các thuộc tính còn lại (Epic/Việc cha, Người tạo, Người tham gia, các ngày) trong mục "Thuộc tính khác" thu gọn. **Đổi trạng thái trên điện thoại là hai chạm** (mở menu rồi chọn bước kế, mỗi dòng ghi rõ trạng thái đích; phím 1–9 trên bàn phím vẫn còn). Từ 1024px bố cục như cũ.
- **Sửa tiêu đề tại chỗ** (chi tiết và xem nhanh): bấm hoặc Enter để sửa, Enter lưu, Esc huỷ, có ✓/✕ và "Đang lưu… / Đã lưu / Lỗi · Thử lại". Tiêu đề trống không gửi. Nếu người khác vừa sửa việc: họ không đổi tiêu đề thì lưu tự thử lại một lần, họ đã đổi tiêu đề thì hiện lời báo kèm tiêu đề mới và bấm Lưu lần nữa mới ghi đè. Khi đang sửa, các phím tắt toàn cục tắt.
- **Dưới ô bình luận** có dòng "Sẽ thông báo: …" (người được nhắc, người phụ trách, người theo dõi), chỉ hiện khi đang gõ; không tính cài đặt tắt thông báo của từng người nên chỉ là dự kiến.
- **Cảm xúc bình luận:** nút "+" và các chấm 👍 ❤️ 🎉 😄 🙏 👀 dưới mỗi bình luận; rê chuột (hoặc trình đọc màn hình) thấy ai đã thả; bình luận của dự án đã lưu trữ chỉ xem. Cảm xúc không gửi thông báo.
- **Trợ lý AI trên trang chi tiết công việc** (cần quyền dùng AI): "Gợi ý ưu tiên & điểm" và "Tóm tắt", kèm tối đa 3 **nguồn tham khảo** là việc tương tự bạn xem được (bấm mở việc đó). Chỉ chạy khi bấm nút; có nút Huỷ khi đang chờ (yêu cầu đã gửi vẫn có thể tính vào hạn mức AI). Từ 1024px là thẻ ở cột phải; dưới 1024px là mục "Trợ lý AI" thu gọn giữa phần mô tả và hoạt động.

### Bộ lọc

- **Cột của bảng kết quả sửa được:** bấm tiêu đề cột để dời trái/phải, ẩn, hiện lại cột đã ẩn; có "Đặt lại mặc định" ở bộ chọn Cột. Mã và Tiêu đề luôn ghim. Lưu theo từng bộ lọc, trên từng trình duyệt.
- **Không có kết quả:** hiện "Thử bỏ một điều kiện" kèm số việc sẽ thấy nếu bỏ từng điều kiện (tối đa 5 gợi ý); bấm để chạy lại ngay. Điều kiện hiển thị dạng chuẩn hoá (chuỗi có nháy kép: `status = "Done"`).
- **Hàng loạt trên kết quả nhiều dự án:** ô tick, "Chọn tất cả trên trang", Shift-click chọn dải. Hành động xuyên dự án chỉ có: Gán cho tôi, Ưu tiên, Điểm; đổi người phụ trách, nhãn, trạng thái chỉ khi chọn trong đúng một dự án. Nếu có việc ở dự án bạn không có quyền, hộp xác nhận nói rõ "Áp cho 5/7 việc (…)" trước khi chạy; kết quả gộp theo dự án, Hoàn tác theo từng dự án.
- **Chia sẻ bộ lọc:** nút "Chia sẻ bộ lọc <tên>" ở mỗi hàng (chủ bộ lọc có quyền quản lý đổi mức rồi Lưu; người khác chỉ xem và sao chép liên kết). Địa chỉ `/filters/<id>` mở và chạy bộ lọc đã lưu (không thấy hoặc không tồn tại: "Không tìm thấy bộ lọc"). Biểu mẫu "Tạo bộ lọc" chỉ còn Riêng tư / Cả không gian làm việc; chia sẻ theo dự án đi qua hộp "Chia sẻ" và bắt buộc chọn dự án.
- **Bộ lọc cũ mức "Dự án" nhưng chưa gắn dự án vẫn hiển thị cho cả không gian** (hành vi cũ của máy chủ, dữ liệu không đổi); nay hàng ghi đúng "Cả không gian làm việc". Muốn thu hẹp: mở "Chia sẻ" rồi chọn dự án hoặc Riêng tư.

### Chia sẻ

- Hộp chia sẻ (bảng tổng quan, bộ lọc) có dòng **"Ai có quyền xem"** (Chỉ bạn / Mọi thành viên không gian (N) / thành viên nhóm / thành viên dự án; dự án riêng tư và nhóm có thêm "và Quản trị chung" vì Quản trị chung thấy mọi mục) và nút **sao chép liên kết** (chỉ khi đã lưu). Không có liên kết công khai cho người ngoài; dòng ghi "Liên kết chỉ mở được với người có quyền xem ở trên".
- Mức chia sẻ toàn không gian ghi **"Cả không gian làm việc"** (không còn "Cả tổ chức"); admin ghi **"Quản trị chung"**.

### Thông báo và chuông

- **Cài đặt › Thông báo:** mỗi sự kiện là một công tắc lưu ngay (kèm "Đang lưu… / Đã lưu lúc HH:mm / Lỗi · Thử lại"). Với 4 loại có email (được nhắc đến, được giao, bình luận, đổi trạng thái), nút "Tuỳ chọn email" mở dòng "Gửi qua email" ngay dưới; bật công tắc trong ứng dụng tự mở dòng này. Email độc lập với trong ứng dụng (tắt trong ứng dụng vẫn có thể chỉ nhận email). Hai thẻ cũ gộp thành một thẻ.
- **Chuông thông báo** có ba tab Tất cả / Nhắc đến / Được giao (nhớ tab theo người dùng), avatar người làm kèm biểu tượng loại hành động. Trên điện thoại chuông không hiện ở thanh trên (đã có ô Thông báo ở thanh tab đáy); tab "Chưa đọc" vẫn chỉ ở trang đầy đủ.

### Thành viên, vai trò, không gian

- **Đổi vai trò ngay trên hàng thành viên** (cần quyền quản lý thành viên): bấm cụm vai trò để mở danh sách tick, lưu ngay, có Hoàn tác 6 giây. Không cho gỡ vai trò quản trị cuối cùng (lý do hiện ngay trên dòng); tự hạ quyền của chính mình thì hỏi xác nhận và không có Hoàn tác. Quyền của bạn cập nhật ngay sau khi tự đổi.
- **Ma trận Vai trò & quyền chỉnh được:** bấm ô để bật/tắt quyền của vai trò tuỳ chỉnh (nhiều lần bấm gộp thành một lần lưu), ô nhóm bật/tắt cả nhóm, có Hoàn tác; vai trò hệ thống khoá (có chữ "Khoá") nhưng có nút **Nhân bản vai trò**. Vai trò tuỳ chỉnh hiện lên đầu bảng. Bật `workspace:admin` hỏi xác nhận; người khác vừa sửa vai trò thì báo "đã tải lại". Người không có quyền quản lý thành viên chỉ xem.
- **Bộ chọn không gian làm việc** ghi số thành viên ("12 thành viên · Quản trị chung"). **Đầu trang Thành viên ghi "N đang hoạt động"** (kèm "· M đã vô hiệu hoá" khi có) — số này là số người đang hoạt động, không còn đếm tài khoản đã vô hiệu hoá; những tài khoản đó vẫn nằm trong danh sách. Con số trên bảng quản trị không gian khớp quy tắc này.

### Tự động hoá

- **Điều kiện hiển thị thành câu** ("Loại công việc là Bug **và** …"; thiếu giá trị ghi "(chưa chọn)") kèm dòng **"Khớp N việc hiện có"** (đếm trong các dự án bạn xem được; "không đếm kịp" hoặc lý do khi không xem trước được; quy tắc theo lịch ghi thêm giới hạn 500 việc mỗi lần chạy). Cần HOẶC thì dùng một điều kiện JQL có OR. Lỗi trong hộp quy tắc hiện theo trường như các biểu mẫu khác.

### Sprint, ngày, năng lực

- **Gợi ý ngày kết thúc sprint:** "2 tuần" = **14 ngày** (kết thúc ngày thứ 14, gồm cả ngày bắt đầu), không còn 15 ngày. Chỉ ảnh hưởng gợi ý của sprint mới; sprint đã có ngày không đổi.
- **Phân bổ nhân lực:** mỗi người có đồng hồ "Đỉnh N%" so với 100% (ngày đỉnh, số ngày T2–T6 vượt 100%, chia theo dự án tại ngày đỉnh; ghi rõ "Chưa trừ nghỉ phép/ngày lễ — xem tab Khối lượng").
- **Chọn người phụ trách** (chi tiết việc, Tạo công việc, Duyệt việc, nút Gợi ý): mỗi người có "còn trống N giờ" hoặc "quá tải" của tuần chứa hạn việc (cần quyền xem nguồn lực); chú thích ước lượng ở chân danh sách.

### Số liệu

- **Bỏ các ô số to:** Tổng quan, Báo cáo, Quản trị, widget "Số liệu" của bảng tổng quan dùng một hàng thống kê gọn; số liệu có đích dùng thanh có vạch ("so với cam kết +4"). Mục tiêu (OKR) hiện vạch tiến độ kỳ vọng theo thời gian cho mục tiêu đang chạy (không có cho kỳ tự do, mục tiêu nháp hay đã đóng). Thanh cảnh báo đủ tương phản ở giao diện sáng.

### Kết nối và hướng dẫn

- **Banner mất kết nối thời gian thực** (dưới thanh bảo trì): hiện sau 3 giây mất, nói "thay đổi vẫn được lưu"; khi không có mạng nói thay đổi sẽ được gửi khi có mạng lại và cần giữ trang mở. Máy chủ ngắt phiên (token hết hạn) thì thử làm mới token rồi nối lại tối đa 5 lần, sau đó ghi "tải lại trang" kèm nút "Tải lại".
- **Hướng dẫn lần đầu có nút "Bỏ qua"** ở mọi bước (và "Quay lại"). Bỏ qua không làm tour tự chạy lại; chỉ "Xong" (hoặc phím → ở bước cuối) mới đánh dấu hoàn thành.

### Chữ

- Thống nhất "Cả không gian làm việc" và "Quản trị chung" ở hộp chia sẻ và Bộ lọc (xem `UX_CONVENTIONS.md` mục 19).

## 3. Còn mở

### Cần chủ sản phẩm / người triển khai quyết định

- **BẢO MẬT — P-C14: đã sửa trong phần C.** Trước đây người có `member:manage` nhưng không phải quản trị cấp được `workspace:admin` cho mình hoặc người khác (đổi vai trò thành viên, tạo/sửa/nhân bản vai trò). Nay máy chủ chặn bằng 403 `ADMIN_GRANT_REQUIRES_ADMIN` và web khoá các điều khiển tương ứng (xem "Thay đổi API"). Chủ sản phẩm đã chốt luật; không còn là điều kiện chặn khi giao `member:manage` rộng rãi. Lưu ý: người **đã** nhận quyền quản trị qua lỗ hổng này trước khi sửa vẫn giữ nguyên — nên rà danh sách người giữ vai trò mang `workspace:admin`.

### Hoãn theo spec (chưa làm)

- 132: điều kiện tự động hoá VÀ/HOẶC thật trong engine (hiện chỉ "và"; cần HOẶC thì dùng một điều kiện JQL có OR).
- 109: nghỉ phép theo giờ.
- 299: cột sức chứa sprint (bản nhẹ hiện so với velocity; chưa có `Sprint.capacityPoints`).
- Xoá vĩnh viễn ở Thùng rác; xoá dự án và xoá không gian làm việc trên web.
- Hàng loạt đa dự án phía máy chủ (Bộ lọc hiện gọi từng dự án một từ web).
- Lịch hai đầu cho `DateRangeInput` (chọn khoảng trên một lịch).

### Bỏ theo spec (cố ý không làm)

- Lời mời và hàng "Đang chờ" của thành viên (285, mâu thuẫn quyết định vòng 2) · liên kết công khai ẩn danh (254) · AI truyền từng đoạn/SSE (224/086) · hàng đợi ghi ngoại tuyến thật (091; banner chỉ báo trung thực, không hứa lưu bền) · viết lại tour (197) · sửa ô vai trò hệ thống (184; chỉ khoá + nhân bản).

### Mục đã ghi nhận (ledger) chưa làm

- **P-C1** — phím tắt ở `IssueDetailPage` dính closure cũ: `copyLink` và `requestTransition` đã đi qua `ref`; theo ghi chú ledger mọi callback thêm vào effect này phải qua `ref` (`assignToMe` cần kiểm khi sửa lần sau). Có từ trước.
- **P-C4** — thang RAID 1–5: trạng thái được chọn yếu hơn (chip trắng trong rãnh); nhóm loại RAID bị cắt chữ dưới ~340px.
- **P-C9** — ràng buộc duy nhất của nhãn phân biệt hoa/thường ở máy chủ; `LabelsSection` (trang Nhãn) tạo nhãn chưa chống trùng không phân biệt hoa/thường/dấu như ô nhãn ở chi tiết việc.
- **P-C10** — client coi `canAssign` là đủ, nhưng endpoint hàng loạt còn cần `issue:edit` (mọi bề mặt hàng loạt); cảnh báo điểm của sprint đã đóng ở Bộ lọc nhiều dự án chỉ kiểm "đã Done".
- **P-C13** — `listWorkspaces` vẫn liệt kê không gian đã lưu trữ (`deletedAt`); có từ trước.
- **P-C15** — `GET /resources/workload` nặng khi nhiều người (chưa có `userIds`/cache); "còn trống" gọi một tuần cho cả không gian mỗi lần mở danh sách.
- Đã xử lý ngay trong phần C (không còn mở): P-C2, P-C3, P-C5 đến P-C8, P-C11, P-C12 (8 chỗ `useAuth((s)=>s.can)`).

### Giới hạn đã biết

- **Chưa chuyển hết sang primitive mới:** 5 công tắc tự viết (Ma trận quyền cũ, AdminUsers, AdminConfig, PrivacySection, DigestsSection); khoảng 10 `Field` cục bộ chưa sang `FormField` (Hợp đồng, Khách hàng, Mục tiêu, Nghỉ phép, Phân bổ, Môi trường, Duyệt việc, Widget, RAID, Nhóm…); ô màu của Mức nghiêm trọng, Mức ưu tiên, Quy trình, `RoleBadge` và biểu đồ vẫn là màu cũ (RC11); `PortfolioPage`, `EpicPanel`, thanh thời gian, checklist làm quen chưa gộp vào `BulletBar`; `IssueRow` của Việc chờ chưa dùng tuỳ chọn "Hiển thị".
- **Lưu theo trình duyệt, không đồng bộ giữa thiết bị:** cột bảng kết quả, tuỳ chọn "Hiển thị" Bảng việc, tab chuông, trạng thái mục thu gọn. Bố cục cột ad-hoc không mang sang bộ lọc đã lưu.
- **Xem nhanh:** nấc nửa của sheet đáy có thể che nửa dưới thẻ ở Bảng việc (đã bù cuộn, chưa hoàn hảo); sheet là modal nên `j`/`k` tắt trên điện thoại; "n/N+" ở Bộ lọc đếm số dòng đã nạp, không phải tổng thật; tiêu đề việc ở Cây là liên kết thật nên chuột phải hoặc nhấn giữ có menu liên kết của trình duyệt (kéo-thả đã chặn menu nhấn giữ iOS bằng CSS).
- **Menu thao tác:** sau khi ghi từ menu, `/search` không làm mới (chỉ Bộ lọc phản ánh ngay qua lớp phủ; widget JQL của bảng tổng quan và ô tìm nhanh làm mới theo chu kỳ riêng); chuột phải vào mã công việc không còn menu liên kết gốc.
- **Hàng loạt:** Bảng việc chỉ chọn được việc của sprint đang chạy đang hiện; Hoàn tác trạng thái chỉ khả thi khi quy trình cho bước ngược; Hoàn tác không nạp lại bản mới (một lần bấm, việc kẹt được báo số lượng); Bộ lọc: lỗi giữa chừng khi chạy hơn 100 việc chỉ kiểm bằng test thuần.
- **Kết nối:** thông điệp "thay đổi vẫn được lưu" vẫn hiện khi chỉ đường thời gian thực đứt, kể cả nếu REST cũng hỏng (lỗi ghi vẫn báo bằng toast riêng); sau khi nối lại thật banner giữ trạng thái "đang thử lại" thêm tới 3 giây (chủ ý, chống chớp); mỗi lần thử nối làm mới một token.
- **Sửa tiêu đề tại chỗ:** đổi trường khác của việc (kể cả của chính bạn) trong lúc đang sửa tiêu đề làm lần lưu đầu mất thêm một lượt nạp lại; lần tự thử lại cần một GET + một PATCH.
- **"Sẽ thông báo":** danh sách người được nhắc lấy từ trang đầu của danh sách người (có giới hạn) nên có thể thiếu người; quy tắc "ai được báo" có hai bản (web và máy chủ), test web là tài liệu.
- **Đếm và xem trước:** gợi ý nới bộ lọc và "Khớp N việc" dùng chung 3 chỗ mỗi tiến trình; giới hạn tốc độ theo IP; tối đa 8 mệnh đề được đếm; xem trước của JQL `text ~` đếm theo `contains` (như engine, không full-text); `dueDate contains` không xem trước được; điều kiện trường chưa điền giá trị vẫn qua kiểm tra (câu hiện "(chưa chọn)"); `fieldConditionSchema` nay là `ZodEffects` (ai dùng `.shape`/`.extend` sẽ vỡ — hiện không ai); NUL trong tên/hành động quy tắc chưa chặn (chỉ điều kiện).
- **Chia sẻ:** nút Chia sẻ chỉ có ở danh sách Bộ lọc và trình soạn bảng tổng quan (người xem bảng chưa có đường sao chép liên kết); `WORKSPACE` kèm `sharedProjectId` khác null (chỉ khi client lạ gửi) máy chủ vẫn coi như mức dự án.
- **Ma trận quyền:** chốt chặn "quản trị cuối cùng" ở web tính theo danh sách thành viên đã tải (máy chủ là quyết định cuối); bật "Chỉ hiện khác biệt" rồi sửa ô có thể làm dòng biến mất sau lưu; refetch giữa lúc đang lưu có thể làm ô nháy về giá trị cũ.
- **Cảm xúc:** `list` nạp mọi cảm xúc của trang bình luận (một truy vấn, nhóm trong bộ nhớ; đủ cho quy mô hiện nay); trên cảm ứng không có rê chuột nên danh sách người chỉ đọc được qua trình đọc màn hình; không có giới hạn tốc độ riêng cho route.
- **AI có nguồn:** tìm việc tương tự chỉ theo tiêu đề; Huỷ chỉ ngừng chờ (yêu cầu đã gửi vẫn chạy và tính hạn mức); trợ lý lập sprint không có nguồn (đã có liên kết sẵn).
- **Đồng hồ năng lực:** phân bổ tính theo ngày T2–T6, chưa trừ nghỉ phép/ngày lễ (đã ghi trên màn); "còn trống" dùng ước lượng giờ (hoặc 4 giờ/điểm).
- **Thuật ngữ:** "Cả tổ chức" vẫn còn ở phạm vi nghỉ của Nghỉ phép (khái niệm khác) và vài chữ "tổ chức" ngoài phạm vi chia sẻ; test thuật ngữ mới chỉ quét `features/sharing` và `features/saved-filters`.
- **Kỹ thuật (không ảnh hưởng người dùng):** test chủ yếu là hàm thuần, kết xuất tĩnh và đọc mã nguồn; có thêm bộ đối chứng Postgres thật (`pnpm --filter @tirapro/api test:parity` với `PARITY_DATABASE_URL`, chỉ cơ sở dữ liệu tên kết thúc `_w2c`/`_parity`/`_scratch`; mặc định không chạy trong `pnpm test`) — **chạy lại trên cơ sở dữ liệu đích khi đổi phiên bản/hạ tầng Postgres** (phép `contains` phụ thuộc locale).

### Cần kiểm trên API thật / thiết bị thật (đã gộp, bỏ trùng)

Chưa có báo cáo nào xác nhận các mục này đã chạy; người kiểm chạy một lượt sau khi build lại API (≥ `c45d27e8`) và áp migration.

**API thật (sau khi build lại API và `migrate deploy`)**

- Migration `20261019100000_comment_reaction` trên cơ sở dữ liệu thật (`migrate deploy`, `migrate diff --exit-code` sạch).
- Cảm xúc: `PUT`/`DELETE` bởi thành viên chỉ-xem (được), người ngoài dự án riêng tư (404), dự án lưu trữ (422), bình luận của việc đã xoá mềm (404); sửa/xoá bình luận của việc đã xoá mềm cũng trả 404; ❤️ đi qua proxy đúng mã hoá; sự kiện `comment:reaction` chỉ tới phòng của dự án.
- `GET /auth/workspaces` `memberCount` với tài khoản vô hiệu hoá; đầu trang Thành viên; cột Thành viên của bảng quản trị không gian.
- `POST /search/relax-counts` bởi người không thuộc dự án riêng tư (số đếm không đổi) và khi truy vấn chậm (`count:null`).
- `POST /automation/rules/preview-match` bởi người soạn không thuộc dự án riêng tư; một lần đối chiếu `pnpm test:parity` trên cơ sở dữ liệu đích.
- `GET /projects/:id/members` bởi người không thuộc dự án riêng tư (kết quả đã kiểm trên API thật: **404** "Dự án không tồn tại" — cố ý, giống dự án không có thật để không lộ dự án riêng tư tồn tại; không phải 403); `PATCH /filters/:id` thật (và `/filters/:id`).
- `PATCH /roles/:id` thật: 200 và 409 qua HTTP (hai quản trị cùng sửa một vai trò từ hai tab → 409 thật); một vai trò tuỳ chỉnh thật được sửa qua ma trận; `GET /roles` có `updatedAt`; thử gỡ quản trị cuối cùng trên không gian nháp (`LAST_WORKSPACE_ADMIN`).
- `GET /issues/:id/watchers` (đã lọc) với dự án riêng tư thật, ở xem nhanh.
- Gợi ý AI có nguồn: dự án riêng tư, việc đã xoá mềm, việc báo ngoài chưa duyệt; chế độ cơ bản không có `ANTHROPIC_API_KEY`; phản hồi AI đến muộn sau khi bấm Huỷ không hiện toast; quyền `ai:use` chỉ cấp qua vai trò dự án vẫn thấy trợ lý.
- Mục tiêu có `expectedProgress` (vạch kỳ vọng) và thông báo có `actorAvatarUrl` trên dữ liệu thật.
- Đồng hồ năng lực với phân bổ chồng nhau thật; người dùng không có `workspace:view`; người xem dự án riêng tư.
- Kết nối thời gian thực: phiên bị thu hồi hoặc thành viên bị gỡ trong lúc đang mở; nginx `/realtime` có nâng cấp WebSocket.

**Trình duyệt / thiết bị thật**

- Gõ tên để xác nhận bằng Telex/VNI thật (Safari và Chrome); các hộp xác nhận còn lại chưa mở tay.
- Báo lỗi biểu mẫu: bàn phím ảo trên điện thoại che ô lỗi; trình đọc màn hình đọc "N trường cần sửa" mỗi lần Gửi.
- Hộp Tạo công việc (menu nút tách) chạy lại trên dữ liệu thật; Telex/VNI ở ô nhãn và ô tiêu đề.
- Sửa tiêu đề: trên trang chi tiết và xem nhanh thật — đổi việc bằng back/forward khi đang sửa, 409 thật từ hai tab, `j`/`k` khi focus ở ✓, Esc không đóng panel, chế độ tối.
- Xem nhanh: Bảng việc (Scrum/Kanban, swimlane), Việc chờ khu hơn 50 dòng (ảo hoá), Bộ lọc nhiều trang bằng cursor thật và "Tải thêm" từ panel, Cây việc kéo-thả với tiêu đề là liên kết, iPhone thật nhấn giữ 250 ms trên Cây/thẻ (không menu xem trước, vẫn kéo được), Safari tô hàng `<tr>`, trình đọc màn hình đọc "Việc N trên ít nhất M".
- Sheet đáy: Chrome Android và iOS Safari (chạm giữa thẻ, nút "…" góc trên phải), nút Back của Android, bàn phím ảo che sheet khi gõ bình luận, vùng an toàn (notch).
- Sáu biểu mẫu có khoảng ngày (Bắt đầu/Sửa sprint, Hợp đồng, Chương trình, Nghỉ phép, Phân bổ): payload không đổi và lịch chọn ngày bản địa có `min` trên Chrome/Safari/iOS.
- Bảng màu: lưu vai trò/nhóm/chương trình rồi kiểm payload; VoiceOver đọc tên màu; xem trước khi in.
- Ô nhãn: tạo-và-gắn thật, tình huống trùng 422, bộ gõ thật.
- Bảng việc: "Hiển thị" với trình đọc màn hình và thả thẻ thật ở chế độ Gọn; chọn nhiều — nhấn giữ trên ô tick (cảm ứng), Safari, Hoàn tác khi có xung đột phiên bản thật; Bộ lọc — dự án thứ hai thật, 409 thật, lỗi giữa chừng với hơn 100 dòng.
- Chi tiết công việc trên điện thoại: chuyển giữa dải thuộc tính và cột phải khi xoay màn hình lúc đang sửa.
- Menu thao tác: bộ lọc đã lưu (kiểm thật), máy lai (con trỏ chuột + cảm ứng), trình đọc màn hình.
- Tour: chạy với dữ liệu hướng dẫn thật từ API.
- Trình đọc màn hình thật: ma trận Vai trò & quyền và các chip nguồn AI; sau đó (VoiceOver/NVDA) cho mọi điều khiển mới trước khi phát hành (yêu cầu sẵn có của `UX_CONVENTIONS.md`).

---

# Lưu tệp trên S3/MinIO (2026-10-26)

## 1. Cần làm khi triển khai

- **Không đổi cơ sở dữ liệu** (không migration). Mặc định vẫn `STORAGE_DRIVER=local`, hành vi và đường dẫn tệp không đổi — nâng cấp mà không đặt gì thì mọi thứ chạy như cũ.
- Muốn dùng MinIO/S3: làm theo `docs/DEPLOY.md` mục "Lưu tệp trên S3/MinIO" (tạo bucket riêng → đặt `S3_*` → dừng API → `storage:migrate-local-to-s3 [-- --dry-run]` → đổi `STORAGE_DRIVER=s3` → khởi động → kiểm HeadBucket trong log). Cổng API S3 của MinIO công ty khác mặc định (9001) — thử HeadBucket để xác định.
- Dependency mới: `@aws-sdk/client-s3@3.1156.0` (API, ghim đúng phiên bản).
- Image Docker chứa thêm `scripts/storage-migrate-local-to-s3.mjs`.

## 2. Thay đổi

- Mọi tệp người dùng (đính kèm, ảnh đại diện, tệp phân tích import Jira, `system-settings.json`) đi qua một lớp lưu trữ chung `ObjectStorage` (Local giữ nguyên bố cục thư mục; S3 dùng cùng khoá). Có test guard cấm dùng `fs` ngoài `LocalStorage`.
- `STORAGE_DRIVER=s3` bắt buộc `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` (API không khởi động nếu thiếu, thông báo tiếng Việt nêu đúng biến). Lúc khởi động gọi HeadBucket: thiếu bucket/sai quyền chỉ log lỗi rõ và đèn "Lưu trữ" đỏ — **không tự tạo bucket**.
- Tải tệp vẫn stream qua API sau kiểm quyền (không presigned công khai); thêm `Content-Length` cho tải đính kèm và ảnh đại diện.
- Upload lỗi S3 → "Không lưu được tệp, thử lại" (422, không lộ chi tiết); đọc lỗi hạ tầng → "Không tải được tệp, thử lại" (không giả làm 404). Upload thành công nhưng ghi DB lỗi → object vừa ghi được dọn.
- Console quản trị: Tổng quan hiện `s3 · <bucket>` và trạng thái HeadBucket; Cấu hình hiện driver + bucket. Không lộ khoá/endpoint.
- Công cụ vận hành `storage:migrate-local-to-s3` (idempotent, `--dry-run`, không xoá local).

## 2b. Sau đợt rà soát (fix round 1)

- **Cờ hệ thống không bị ghi đè khi S3 chập chờn:** đọc lỗi ≠ không có tệp; chưa đọc được thì `setFlags` từ chối (503) và đăng ký công khai tạm đóng, tự đọc lại có backoff; lưu cờ lỗi giờ báo lỗi thay vì "thành công giả".
- **Chống chạy trùng import Jira ở DB** (advisory lock + `ImportJob`), không phụ thuộc `If-None-Match`; thử lại sau khi mất phản hồi nhận lại đúng job cũ. Probe lúc khởi động báo nếu máy chủ S3 bỏ qua ghi có điều kiện.
- **Khởi động chặt** (`STORAGE_STARTUP_STRICT`, mặc định bật ở production): cấu hình S3 sai dứt khoát → API dừng ngay; lỗi mạng → vẫn lên, thử lại mỗi 30 giây.
- **Cắt chuyển an toàn hơn:** thứ tự "dừng API → chép lần cuối → đổi driver → khởi động"; `system-settings.json` so theo nội dung; không đè object S3 mới hơn nếu không `--force`; báo nguyên nhân từng khoá lỗi.
- **Tên tệp tiếng Việt đúng:** giải mã lại tên multer đọc sai, `Content-Disposition` theo RFC 6266/5987; script tuỳ chọn `attachments:fix-filenames` sửa dòng cũ.
- Khác: giới hạn dung lượng ở multer, NoSuchBucket không còn thành 404 im lặng, tên avatar `.`/`..` trả 400, tổng quan admin nhớ kết quả HeadBucket ~30 giây, huỷ client S3 khi tắt.

## 2c. Dùng chung bucket: `S3_KEY_PREFIX`

- Biến mới `S3_KEY_PREFIX` (mặc định rỗng) cho trường hợp key chỉ có quyền trên một bucket dùng chung (vd `auto-test`): mọi object của Tirapro có khoá `<tiền tố><storageKey>` (vd `tirapro/…`); `storageKey` trong DB vẫn không có tiền tố. Chỉ `S3Storage` áp tiền tố (một hàm duy nhất dựng khoá + assert thuộc tiền tố; guard test cấm lệnh S3 dựng khoá ngoài hàm đó); mọi `ListObjects` đều có `Prefix`. Gồm cả claim Jira, probe lúc khởi động và `system-settings.json`. Script `storage:migrate-local-to-s3` tôn trọng tiền tố và `--dry-run` in khoá đích. Không tiền tố ⇒ hành vi như cũ.

## 3. Còn mở

- Chưa chạy trên MinIO công ty (172.20.20.100) và VM 172.20.20.128 — đã kiểm với MinIO cục bộ (`pnpm test:parity` + e2e API thật); cần một lượt kiểm trên hạ tầng thật khi triển khai (cổng API, quyền của access key, `If-None-Match` ở bản MinIO của công ty).
- Không có vòng đời/dọn object mồ côi (xoá object lỗi chỉ log); bucket versioning/lifecycle do người vận hành cấu hình.

