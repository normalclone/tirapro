# Release notes — đợt follow-up 2026-10 (`fix/review-findings`)

Gộp toàn bộ thay đổi của nhánh (base `22c116c`): 35 task (26 task kế hoạch: S1-S6, C1-C9, W1-W6, T1-T5; 9 task nhóm X: X1, X2a/b/c, X3-X7) + đợt sửa cuối (FW). Chi tiết từng mục: `docs/superpowers/plans/2026-10-15-follow-ups.md`.

> **Merge PR bằng merge commit (không squash, không rebase-merge).** `.git-blame-ignore-revs` trỏ tới SHA `4fa8273…` của commit `prettier --write` toàn repo (T5); squash/rebase đổi SHA thì file này vô hiệu và `git blame` ngập trong diff format. Sau khi clone/pull chạy một lần: `git config blame.ignoreRevsFile .git-blame-ignore-revs`. Nhánh đang mở cần rebase lên sau commit format.

## 1. Cần làm khi triển khai

Checklist đầy đủ (thứ tự, lệnh theo từng môi trường): `docs/DEPLOY.md` mục "Checklist triển khai / nâng cấp".

1. **PR này không thêm migration riêng, nhưng `migrate deploy` có thể áp 6 migration của base `22c116c` nếu prod chưa từng chạy** (kiểm `prisma migrate status`): `sprint_sequence_unique`, `perf_indexes`, `mail_invite_reset`, `project_archive`, `worklog_rules`, `ai_log_index`. Hệ quả: `project_archive` đặt `archivedAt = updatedAt` cho dự án đang `isArchived` → các dự án đó thành **chỉ-đọc và bị ẩn**; `perf_indexes` dùng `CREATE INDEX` thường trên `Issue` → **khoá ghi bảng `Issue` lúc build** (cửa sổ bảo trì); `sprint_sequence_unique` **đánh lại số** sprint trùng `(projectId, sequence)`; `worklog_rules` **cấp quyền** (INSERT vào `RolePermission`): mọi role đã có `issue:edit` nhận `worklog:create|update|delete`, role có `project:admin`/`workspace:admin` nhận `automation:manage`, đồng thời xoá `WorkLog_issueId_idx` (thay bằng chỉ mục kép), thêm giá trị enum `HistoryField.TIME_SPENT` và tạo bảng automation; `perf_indexes` xoá `RefreshToken_tokenHash_idx` (đã có UNIQUE index). Thứ tự: `prisma migrate deploy` → `db:raw` → (chỉ khi đổi khoá mã hoá) `integrations:rekey` → `automation:seal-secrets`. Render/Docker tự chạy `migrate deploy` + `db:raw` mỗi lần khởi động; hai script cuối luôn chạy tay.
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
- **Nợ còn lại:** ratchet lint 91 cảnh báo (65 `max-lines-per-function` ở web, 12 `no-unsafe-*` ở api…); `knip.jsonc` còn che `@nestjs/testing` và `AiIssuePanel.tsx` (chưa nối UI). `pnpm knip` thoát 0.

---

# UX vòng 2 — nhóm U (thuật ngữ, ngày giờ, validation tiếng Việt)

## Thuật ngữ, ngày giờ, validation tiếng Việt (U22–U26)

- **Thuật ngữ thống nhất** (bảng `docs/UX_CONVENTIONS.md` §19): *Việc chờ* (không "Backlog"), *Bảng việc*, *sprint* (không "đợt làm việc"), nhóm trạng thái *To Do / In Progress / Done* (Tổng quan, Báo cáo, Bộ lọc, Quy trình, CSV chương trình dùng chung `STATUS_CATEGORY_LABEL`), *công việc/việc* (không "issue", "vấn đề" — trừ sổ RAID), *dự án*, *quy trình*, *không gian làm việc*.
- **Danh mục quyền, vai trò hệ thống, khối báo cáo** bằng tiếng Việt (không đổi `key` quyền/enum, không cần migration). Vai trò hệ thống đọc mô tả từ `SYSTEM_ROLE_META` nên có hiệu lực ngay. **Lưu ý:** mô tả `Resolution` (`DEFAULT_RESOLUTIONS`) chỉ gieo khi seed lần đầu nên workspace đã có dữ liệu giữ chữ cũ ("Trùng với issue khác"); mô tả quyền ở bảng `Permission` của DB cũ chỉ cập nhật khi chạy lại `db:seed` (web hiển thị mô tả lấy từ `@tirapro/types` nên không bị ảnh hưởng).
- **Thông báo lỗi và lý do gợi ý của API** dùng cùng bảng: sprint không còn lộ `FUTURE/ACTIVE` ("Đã có sprint đang chạy — hãy kết thúc nó trước"); digest ghi *To Do / In Progress*; lý do gợi ý người nhận và lời chỉ dẫn gửi Claude dùng "công việc" (tên thẻ phân tách prompt `<issue>` giữ nguyên). Mã lỗi `error.code` không đổi.
- **Ô ngày/giờ:** không còn `<input type="date|datetime-local">` trong web — mọi form dùng `DateInput`/`DateTimeInput` (`dd/MM/yyyy`, `HH:mm` 24h; gõ `0508`, báo ngày sai). Giá trị gửi API không đổi. "Hạn hoàn thành" khi tạo công việc tối thiểu là hôm nay. Trường tuỳ biến kiểu ngày lưu khi chốt giá trị (Enter / rời ô / chọn lịch), không lưu mỗi phím.
- **Lời nhắn ngày:** "Ngày kết thúc không được trước ngày bắt đầu" (luật cho phép trùng ngày). Toast xuất CSV chỉ khuyên "thu hẹp bộ lọc" khi nơi xuất có bộ lọc.
- **Chặn tái phạm:** ba bộ quét mã nguồn (`terminology.test.ts`, `noNativeDate.test.ts`, `terminology.spec.ts`) chạy trong `pnpm test`.

## Tài liệu khớp tính năng thật (L8)

- Trang **Hướng dẫn** (`/documentation`) và `docs/FEATURES_BY_ACTOR.md` mô tả đúng đợt 2: thêm thành viên trực tiếp (không lời mời), dự án riêng tư, wiki quyền theo dự án + lịch sử phiên bản, Mức nghiêm trọng / Resolution, form Báo lỗi, xem nhanh, @mention, JQL gợi ý, thông báo, Sức khoẻ dự án + thẻ lãnh đạo, Digest (thứ/giờ/múi giờ, Email + Telegram), dashboard 4 mức chia sẻ, OKR tự đo, nhập Jira giữ mã gốc, phím tắt.
- **Bỏ lời hứa không có thật:** xuất "PDF/Excel" -> "Xuất CSV (mở được bằng Excel) + In / Lưu PDF"; bỏ lệnh Telegram `/newtask`, `/bug`, `/report` (bot chỉ gửi tin; `/link@bot MÃ` liên kết **nhóm**, không phải từng người).
- Phần "Dashboard tuỳ biến — Tổng quan → bộ chọn dashboard" viết theo UI dashboard của nhóm L (L6/L7); nếu nhánh đó chưa vào thì đoạn này đi trước tính năng.

