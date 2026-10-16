# Release notes — đợt follow-up 2026-10 (`fix/review-findings`)

Gộp toàn bộ thay đổi của nhánh (base `22c116c`): 35 task (26 task kế hoạch: S1-S6, C1-C9, W1-W6, T1-T5; 9 task nhóm X: X1, X2a/b/c, X3-X7) + đợt sửa cuối (FW). Chi tiết từng mục: `docs/superpowers/plans/2026-10-15-follow-ups.md`.

> **Vòng UX 2 (143 task, 28 migration) nằm ở phần cuối file** (mục "UX vòng 2", có đủ 5 phần: triển khai, hành vi, API, bảo mật, còn mở). Đọc cả hai phần khi nâng cấp từ bản trước đợt follow-up.

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
10. **Tác vụ nền mới:** digest chạy `0 * * * *` (mỗi giờ, so khớp thứ/giờ/múi giờ từng báo cáo; trước đây một lần/ngày) và tự gửi khi kết thúc sprint; cron chụp giá trị Key Result `01:30 UTC` hằng ngày (khoá Redis, idempotent theo ngày UTC). Cron dùng khoá Redis; không có Redis thì chạy ở chế độ một node (không khoá) — đừng chạy nhiều instance API mà thiếu Redis, digest/chụp KR sẽ chạy trùng.
11. **Email digest/đặt lại mật khẩu đi qua `MAIL_DRIVER`**: `console` chỉ ghi log; `smtp` mới là khung (chưa cài thư viện gửi) và ném lỗi khi gửi — nên báo cáo định kỳ qua Email chưa gửi thật được trong bản này; kênh Telegram thì chạy.
12. **Rollback:** sau khi người dùng đã dùng bản mới không nên quay lại image cũ — `InviteToken` đã bị xoá, enum `HistoryField` có giá trị mới (`DESCRIPTION`/`COMPONENT`/`FIX_VERSION`), `wiki:manage` đã đổi scope và quyền đã cấp (suy ra từ cấu trúc migration, chưa thử rollback thật). Sao lưu DB trước bước 1 là đường lùi duy nhất.

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
- **Digest có cấu trúc:** chọn khối (tóm tắt, quá hạn, sprint, rủi ro, OKR, nhân lực, sức khoẻ), xem trước, lịch thứ/giờ/múi giờ, tự gửi khi kết thúc sprint, kênh **Email + Telegram**, chọn người nhận (email dựng theo quyền xem của từng người), sửa lỗi `&amp;`. Báo cáo cũ giữ lịch "thứ Hai 08:00 giờ VN" nhưng bố cục có tiêu đề khối, tối đa 3 sprint (L19–L21).
- **Wizard Telegram 4 bước** (token → thêm bot vào nhóm → gửi `/link@bot MÃ` → thử), trạng thái thật (Hoạt động / Lỗi token / Chưa có bot / Chưa có kênh), mã 6 ký tự hạn 15 phút (L22–L24).

**Dashboard / Báo cáo / OKR**

- **Báo cáo** mở bằng tab **Sprint** (chọn sprint, Burndown có vạch "Hôm nay", velocity, tóm tắt), **Tổng kết sau Kết thúc sprint** (đã chuyển gì đi đâu, so velocity) — sau khi Kết thúc sprint người dùng được chuyển sang trang Báo cáo thay vì ở lại Việc chờ; hộp xác nhận **Bắt đầu sprint** (sửa ngày/mục tiêu); header Board/Việc chờ hiện ngày kết thúc + "còn N ngày" (L10–L13).
- **Xuất CSV** (mở được bằng Excel; tối đa 5.000 dòng): Việc chờ, danh sách bug, kết quả JQL/bộ lọc (theo cột đang chọn), sprint, Danh mục, RAID, Nhân lực; **In / Lưu PDF** Tổng quan, Báo cáo sprint, dashboard (L1–L4).
- **Tổng quan lãnh đạo:** cột/huy hiệu **Sức khoẻ dự án** (tự tính + quản trị dự án ghi đè kèm ghi chú), thẻ Top rủi ro / OKR chậm / Người quá tải (báo lỗi nguồn thay vì giả "không có vấn đề") (L16–L18).
- **Dashboard tuỳ biến:** bộ chọn ở Tổng quan, 9 loại widget, soạn kéo-thả (chuột/bàn phím/cảm ứng, Hoàn tác), chia sẻ riêng tư / cả workspace / theo dự án / theo nhóm; chỉ chủ sửa (L5–L7).
- **OKR:** Key Result **tự đo** (bug mở, % sprint, JQL — tính lúc đọc theo quyền người xem), giá trị bắt đầu + đơn vị, check-in có ghi chú, lịch sử + đường tiến độ (cron chụp hằng ngày, ngày tính theo UTC) (L25, L26, L29).

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
- Thông báo/@mention: thông báo @ở bình luận đi qua listener sau commit (lỗi chỉ ghi log); `canSee` chạy trong giao dịch tương tác của bình luận (rủi ro cạn pool khi rất nhiều @mention đồng thời); `issue:<id>` presence room không rút khi đổi quyền xem (A1, P5).
- OKR/dashboard: KR cũ có JQL chứa `me` không kiểm lại khi lưu không đổi; trình soạn chưa cảnh báo inline; chưa cache phép đo KR (L6a).
- Telegram wizard: `jsonb_set` trên config không phải object; hai quản trị cùng mở wizard vô hiệu mã của nhau (L3). Nhập Jira: tóm tắt epic/sprint khi nhập lại tính theo kế hoạch tệp; hàng chờ email của người đã là thành viên không bao giờ được gán (L7).
- Tài khoản: race hẹp ở `ApiKeyService.validate` có thể để cache 60s ngay lúc khoá; `RequireAuth` chặn mọi đường dẫn khi chưa có workspace kể cả đổi mật khẩu tạm; chỉ mục `AuditLog(createdAt)` và lọc theo nhóm hành động chưa có (P1, P2).
- Bộ lọc đã lưu chia sẻ của dự án công khai đã xoá mềm hiện lại; chưa test FE cho cờ `scoped` (P4). `unreadCount` thêm một truy vấn kiểm quyền (chưa cache) (P5).
- Mobile: ô nhập 16px đang `!important` nên thu nhỏ ô tiêu đề lớn (Wiki `text-lg`, Dashboard/Issue `text-xl`) trên mobile; vùng chạm chồng chưa kiểm trên cảm ứng thật; còn 8 mục Gantt trong allowlist `small-targets` (U7).

**Đợt sửa cuối đang xử lý** (kết quả review toàn nhánh, sẽ cập nhật mục này khi xong)

- Bảo mật: việc báo lỗi chưa duyệt vẫn hiện realtime trên Board/Việc chờ (`ISSUE_CREATED` phát trước khi đặt `triageState`); sự kiện `ISSUE_UPDATED` của triage sai dạng payload (người theo dõi không được báo); `accept` một chạm gán người phụ trách không kiểm; API triage chỉ đòi `issue:edit` chứ chưa `issue:triage`; đổi dự án sang riêng tư chưa ngắt kênh Telegram sự kiện gắn dự án; đổi vai trò/quyền chưa rà lại socket đang mở; bộ chọn người chưa theo dự án/giới hạn 50; xuất CSV "Việc chờ"/"Bug" chưa lọc việc chưa duyệt.
- Dữ liệu: hạ vai trò chưa rút socket khỏi room dự án riêng tư; cờ `bulk` bị Telegram/automation bỏ qua (nhập/gán hàng loạt gửi hàng trăm tin); danh mục trạng thái JQL còn lộ tên trạng thái của quy trình dự án riêng tư.
- Web: soạn Wiki mất bản nháp khi chuyển trang/Esc/rời trang (chưa có chặn rời trang hay autosave); Wiki gọi `GET /projects/:id/permissions/me` cho mọi dự án mỗi lần mở (nguy cơ 429 ở workspace nhiều dự án); kết quả bộ lọc/JQL cắt ở 100 dòng nhưng hiện như tổng và nút Xuất CSV hứa "đủ"; 16px `!important` thu nhỏ ô tiêu đề lớn trên mobile (đã nêu ở trên).
- Review web-core và chất lượng mã chưa hoàn tất; mục này sẽ được cập nhật khi đợt sửa cuối xong.
