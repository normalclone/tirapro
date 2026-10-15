# Việc còn lại sau nhánh `fix/review-findings` (2026-10-15)

Toàn bộ 23 task của `2026-10-15-review-fixes.md` + đợt sửa review cuối đã merge. Danh sách dưới là các điểm reviewer đánh giá **không chặn merge**, gom lại để làm tiếp.

## Bắt buộc khi triển khai
- Chạy `prisma migrate deploy` + `db:raw` trên DB thật (6 migration mới: sprint_sequence_unique, perf_indexes, mail_invite_reset, project_archive, worklog_rules, ai_log_index) rồi smoke test tay: kéo thả board, backlog > 50 dòng (virtualization), các dialog, Cmd+K trên trang issue, mời thành viên/đặt lại mật khẩu (driver console).
- Prod: đặt `INTEGRATION_ENCRYPTION_KEY` mới, giữ key cũ ở `INTEGRATION_ENCRYPTION_KEY_PREVIOUS`, chạy `pnpm --filter @tirapro/api run integrations:rekey` (xem `docs/DEPLOY.md`).
- Project đang `isArchived` sẽ thành chỉ-đọc và bị ẩn sau migration — ghi vào release note.

## Bảo mật / quyền
- Các route `ISSUE_EDIT`/`ISSUE_TRANSITION` khác (links, labels, components, attachments, triage, custom fields, `transition`, `move`) vẫn cho `:own` mà không kiểm ownership — gắn `@OwnOnly`.
- `PUT /raid/:id` đổi được `projectId` sang dự án khác cùng workspace mà không kiểm quyền ở dự án đích; link liên dự án chỉ kiểm quyền một đầu.
- `move()` đổi status không qua workflow/resolution và không phát `ISSUE_TRANSITIONED`; `assigneeId` chưa kiểm là thành viên workspace; `sprintId` chỉ kiểm theo workspace.
- Webhook automation: thiếu dải `2002::/16`, `2001::/32`; chỉ pin IP đầu tiên; `lookup` nằm ngoài timeout; secret webhook lưu plaintext.
- `decrypt` trả null → integrations/digests rơi về bot toàn cục; nên báo "token không dùng được".
- Xoá mềm project chưa ẩn issue của nó ở `/issues/:key`, search, list.

## Đúng đắn / dữ liệu
- Burndown vẫn tính delta `oldCategory` (CFD đã sửa sang "last category wins").
- Rebalance rank bump version mọi issue nhưng chưa ai nghe `PROJECT_RANKS_REBALANCED`; `prev >= next` cũ kích hoạt rebalance toàn project.
- `bulkUpdate` đổi cả status lẫn assignee không phát `ISSUE_ASSIGNED`; web `runBulk` không chia lô > 100.
- Cột board nhiều status luôn nhắm status đầu tiên khi thả.
- JQL `text ~` lấy top 200 toàn workspace rồi mới lọc project; mất match substring ở description/key.
- Jira import: chạy trùng `analyzeId` tạo issue trùng; job kẹt RUNNING khi restart; parse CSV 25MB đồng bộ.
- Digest có thể gửi đôi khi lệch đồng hồ giữa node (lock DEL, không có `lastRunAt`).
- Comment `updated/deleted` chưa được server phát qua WS.
- `setColumns` chưa lock board / bắt P2002.

## Web / UX
- `can()` chỉ dùng quyền workspace → member chỉ có quyền ở mức project không thấy "Ghi thời gian", kéo thả backlog…
- Burndown `REPORT_VIEW` kiểm ở workspace → Member bị 403.
- Viewer vẫn thấy nút lưu bộ lọc; hotkey `w` (worklog) chỉ chạy khi panel đã vào viewport.
- PlanningPanel (drawer) chưa focus-trap/`data-state`; một số dialog còn `if (!open) return null` (mất animation đóng); header icon/màu bị bỏ.
- Bỏ toggle cá nhân "Nhóm theo người" (swimlane giờ theo cấu hình board).
- `setTimeout(0)` dedupe toast lỗi khá mong manh; `currentProjectKey` trong Cmd+K còn `decodeURIComponent` không try/catch.

## Tooling / nợ kỹ thuật
- Hạ ratchet lint từ 275 xuống 246 (số cảnh báo hiện tại) và trả dần họ `no-unsafe-*`.
- Một commit `prettier --write` toàn repo (265+ file chưa đạt) rồi bật `--max-warnings 0` cho lint-staged.
- CI thêm job Postgres chạy `migrate deploy` + `migrate diff --exit-code`.
- Đổi tên module `dev` → `dev-links`; cấu hình `knip`; `HEALTH_PATHS` đang hardcode `/api/v1`.
- `issues.service.ts` ~1000 dòng → tách `RankService`/WIP helper.
