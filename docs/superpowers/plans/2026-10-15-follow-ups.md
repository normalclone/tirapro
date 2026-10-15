# Việc còn lại sau nhánh `fix/review-findings` (2026-10-15)

Toàn bộ 23 task của `2026-10-15-review-fixes.md` + đợt sửa review cuối đã merge. Danh sách dưới là các điểm reviewer đánh giá **không chặn merge**, gom lại để làm tiếp.

**Trạng thái (cập nhật cuối đợt follow-up):** mọi mục đều đã xử lý bởi task trong `2026-10-15-follow-ups-impl.md` (ID ở ngoặc, `[x]`), trừ các mục đánh dấu **CỐ Ý KHÔNG LÀM** (kèm lý do). `FW*` = đợt sửa cuối (final wave) sau review toàn nhánh. Release notes tổng hợp: `docs/RELEASE_NOTES_2026-10-follow-ups.md`.

## Bắt buộc khi triển khai
- [x] Chạy `prisma migrate deploy` + `db:raw` trên DB thật rồi smoke test tay — nay có checklist thứ tự + cảnh báo khoá bảng `Issue` ở `docs/DEPLOY.md` (FW-OPS; X5 đổi `db:raw`). Smoke test đã chạy lại ở môi trường verify (13 PASS/5 FAIL baseline → xử lý bằng X-task).
- [x] Prod: `INTEGRATION_ENCRYPTION_KEY` mới + `…_PREVIOUS` + `integrations:rekey` — `docs/DEPLOY.md` (đã có; FW-OPS thêm cách chạy trong Docker/Render + `automation:seal-secrets`).
- [x] Project `isArchived` thành chỉ-đọc và bị ẩn — ghi trong release notes (FW9/FW-OPS) và làm nhất quán ở API/web (X4).

## Bảo mật / quyền
- [x] Route `ISSUE_EDIT`/`ISSUE_TRANSITION` khác cho `:own` không kiểm ownership (S1; + coverage spec dùng SENTINEL object ở S1/X1).
- [x] `PUT /raid/:id` đổi dự án + link liên dự án chỉ kiểm một đầu (S2; X1 cho đọc chéo link).
- [x] `move()` không qua workflow/resolution, `assigneeId`/`sprintId` chưa kiểm (S3). Gán vào sprint đã CLOSED (FW1).
- [x] Webhook automation: dải IPv6 chuyển tiếp, pin mọi IP, timeout DNS, secret plaintext (S4; chạy `automation:seal-secrets` khi triển khai).
- [x] `decrypt` null → rơi về bot toàn cục (S5; digest chạy khi tích hợp ERROR trả 422 — X1).
- [x] Xoá mềm project chưa ẩn issue (S6; mở rộng sang dev-links/goals/analytics/programs ở X1).

## Đúng đắn / dữ liệu
- [x] Burndown dùng "category cuối thắng" như CFD (C1).
- [x] Rebalance rank: WS `PROJECT_RANKS_REBALANCED` + `409 RANK_NEIGHBORS_STALE` thay vì rebalance cả dự án (C2; kéo-thả theo rank X2a/b/c).
- [x] `bulkUpdate` phát `ISSUE_ASSIGNED`/`ISSUE_UPDATED`; web chia lô > 100 (C3, X6).
- [x] Cột board nhiều status — hỏi trạng thái đích (C4).
- [x] JQL `text ~` toàn workspace/top 200/mất substring (C5; tìm kiếm tiếng Việt X5).
  - **CỐ Ý KHÔNG LÀM:** `!=` / `NOT IN` trên quan hệ nullable (vd `sprint != X` bỏ backlog) vẫn loại bản ghi EMPTY — giữ ngữ nghĩa Jira; ai cần thì viết `OR x is EMPTY`. Lý do: kỳ vọng tương thích Jira; chi phí nếu sai: người dùng phải thêm `OR … is EMPTY`. (Ruling X5.)
- [x] Jira import: trùng `analyzeId`, job kẹt RUNNING, parse CSV đồng bộ (C6).
  - **CỐ Ý KHÔNG LÀM:** khôi phục job RUNNING mồ côi cho import **generic** (không phải `jira-csv`). Lý do: không có heartbeat → đánh FAILED nhầm job đang chạy tệ hơn để kẹt như trước C6. (Ruling C6.)
- [x] Digest gửi đôi khi lệch đồng hồ (C7: compare-and-set `lastRunAt`).
- [x] Comment `updated/deleted` qua WS (C8; test thiếu `projectId` FW4).
- [x] `setColumns` chưa lock board / bắt P2002 (C9; lọc `deletedAt` + test thứ tự khoá FW3).

## Web / UX
- [x] `can()` chỉ dùng quyền workspace (W1: `useCan(projectId)` + `GET /projects/:id/permissions/me`).
- [x] Burndown `REPORT_VIEW` kiểm ở workspace (W2 + C1).
- [x] Viewer thấy nút lưu bộ lọc; hotkey `w` (W3).
- [x] PlanningPanel focus-trap, dialog `if (!open) return null`, icon/màu header (W4).
- [x] Toggle "Nhóm theo người" (W5).
- [x] Toast lỗi mong manh, `decodeURIComponent` không try/catch (W6).

## Tooling / nợ kỹ thuật
- [x] Hạ ratchet lint và trả `no-unsafe-*` (T1: 281 → 92; FW-OPS: đo lại = **91**, `docs/superpowers/plans/lint-debt.md`).
  - **CHƯA LÀM (có chủ đích):** `--max-warnings 0` cho lint-staged/CI — còn 91 cảnh báo nền (65 `max-lines-per-function` web, 12 `no-unsafe-*` api, 3 `exhaustive-deps`). Chỉ bật khi ratchet về 0.
- [x] Một commit `prettier --write` toàn repo + `format:check` ở CI (T5). Merge PR bằng merge commit để `.git-blame-ignore-revs` còn hiệu lực.
- [x] CI job Postgres: `migrate deploy` + `migrate diff --exit-code` (T2); FW-OPS thêm `db:raw` song song + nhánh nâng cấp `searchVector`.
- [x] Đổi tên `dev` → `dev-links`, `knip`, `HEALTH_PATHS` từ config (T3); tách `RankService` (T4).

## Phát sinh trong đợt follow-up (đã xử lý)
- [x] Kéo-thả board/backlog theo rank (X2a/b/c); `useInView` hỏng dưới StrictMode (X3); dự án lưu trữ chỉ-đọc nhất quán (X4); tìm kiếm tiếng Việt (X5); UX nhỏ + `/auth/refresh` không 401 đỏ (X6); board Scrum theo sprint chạy (X7); rò quyền đọc chéo (X1).
- [x] Đợt cuối API: FW1-FW6, FW11 (`epicId` không lưu), FW12 (API `PATCH /boards/:id` `type`) + 4 Important của review cuối (tạo issue `statusId`, automation/workflow-admin theo dự án lưu trữ, soft-delete còn sót, quyền `/move`).
- [x] Đợt cuối OPS: FW9 release notes + ratchet, `db:raw` advisory lock, `docs/DEPLOY.md`, `Dockerfile` có script vận hành, `api-contract.md`.
- [x] Đợt cuối web: FW7, FW8, FW12 (UI), FW13 (+ dự án lưu trữ chỉ-đọc ở gốc, quyền tạo việc/Cmd+K, phím tắt không cướp phím khi overlay mở, route rank/move theo quyền, `skippedAssignees` ở kết quả import).

## Cố ý không làm (quyết định sản phẩm)
- **Resources → Allocation và clients → Contract trên dự án lưu trữ vẫn ghi được** — dữ liệu cấp workspace/khách hàng, không phải dữ liệu làm việc của dự án (X4). Ghi trong release notes + `api-contract.md` §6.1.
- **Snapshot sprint của dự án lưu trữ vẫn ghi** — chỉ phục vụ biểu đồ, không đổi dữ liệu người dùng; chi phí nếu sai: burndown của sprint lưu trữ phẳng (X4).
- **`knip.jsonc` còn ignore** `@nestjs/testing` và `src/features/ai/AiIssuePanel.tsx` (chưa nối UI) — xoá hay nối là quyết định riêng; có comment lý do trong file.
