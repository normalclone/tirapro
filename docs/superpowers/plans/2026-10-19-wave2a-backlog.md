# Đợt 2 · Phần A — Tồn đọng đợt 1 + việc treo vòng 2 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sửa các mục "Còn mở / tồn đọng" của Giao diện đợt 1 và 4 việc treo từ smoke vòng 2, theo quyết định A-D1…A-D5 của spec.

**Architecture:** Chủ yếu web (`apps/web`); API cho R2 (quyền triage) và R3 (khoá rank khi kéo-thả); `packages/shared` cho tour (A2). Không migration.

**Tech Stack:** React 18 + Vite + Tailwind + Radix + TanStack Query, NestJS 10 + Prisma 6, vitest (web: node, không jsdom), Playwright để kiểm trực quan.

**Spec:** `docs/superpowers/specs/2026-10-19-ui-std-wave2.md` (phần A). Kiểm kê chi tiết (hiện trạng `path:line` + đề xuất + test): `inv-A.md` trong workspace SDD (controller đưa đường dẫn tuyệt đối). Mỗi task ghi mục inv-A tương ứng — ĐỌC mục đó trước khi làm.

## Global Constraints

- Giữ nguyên mọi ràng buộc của đợt 1 (`docs/superpowers/plans/2026-10-18-ui-std-wave1.md` → Global Constraints): token OKLCH, motion 120/180/240ms ease-out-quart, không bounce/gradient/glass, `motion-reduce`, WCAG AA, vùng chạm ≥44px trên cảm ứng, chữ tiếng Việt theo `docs/UX_CONVENTIONS.md` §19.
- Primitive đợt 1 là chuẩn bắt buộc: `SearchSelect`, `SegmentedControl`, `EmptyState`, `StatusPanel`, `Dialog`, `useConfirm`, `useLeaveGuard`/`useUnsavedChanges`/`LeaveGuardHost`, `lib/navLabels.ts`, `lib/dateFormat.ts`. Không viết lại thứ đã có.
- Test web là hàm thuần hoặc đọc-source (vitest node); test API là `*.spec.ts` mock prisma. Viết test trước (RED → GREEN) cho mọi logic mới.
- Route API sửa phải giữ policy decorator và qua `rbac-coverage`, `private-project-coverage`, `archived-coverage`, `soft-delete-project-scope`.
- Gate: `pnpm -r typecheck` · `pnpm lint` (0 lỗi, ≤ 91 cảnh báo) · `pnpm test` · `pnpm format:check` · `pnpm knip` · `pnpm --filter @tirapro/web build`. Sửa `packages/shared` thì `pnpm --filter @tirapro/shared build` trước.
- Không thêm dependency. Không đụng :4000/:5173/:8091, nginx, Tailscale, các DB dùng chung (chỉ đọc qua dev server worktree).

## Review Focus

1. A-D1: người không có `issue:triage` không còn thấy danh sách "Việc mới vào" ở bất kỳ đường nào (API 403/ẩn UI) nhưng KHÔNG mất quyền xem/tìm công việc thường; người có quyền không bị ảnh hưởng.
2. A-D2: kéo-thả song song với tạo việc / kéo-thả khác không ra hai việc trùng rank; không deadlock (thứ tự khoá dự án → WIP).
3. A-D3: trang Wiki mới chưa lưu không bao giờ xuất hiện trong cây/server; lưu lần đầu tạo đúng một trang; bản nháp cục bộ không mất khi tải lại.
4. Thay đổi chưa lưu (Task 3): không mất bản nháp khi đổi không gian lỗi; không hỏi giả do autofill; không ghi đè chữ đang gõ.
5. Tabs/SegmentedControl a11y: vai trò ARIA đúng, phím mũi tên, focus.

---

## Tasks

### Task 1: Chữ & nhãn — tháng Gantt/Lộ trình, tour bước 4, gợi ý Ctrl/Cmd+Enter, "Mức ưu tiên"

**inv-A:** A1, A2, A3, A5.
**Quyết định:**
- A1: hàm thuần `monthAxisLabel(date, widthPx)` trong `lib/dateFormat.ts` (≥64px → `T10/2026`; ≥34px → `T10`; nhỏ hơn → `''` kèm `title` đầy đủ); Gantt tách `groupDaysByMonth` ra file thuần; Lộ trình chỉ ghi năm ở tháng đầu và tháng 1, nhãn `truncate` trong bề rộng tháng.
- A2: chữ tour bước 4 đúng cả hai môi trường (vd "Tìm và chạy lệnh nhanh: bấm nút Tìm hoặc nhấn ⌘K / Ctrl+K"); tăng `version` của `tour-home` lên 2 và sửa `default-guides.spec.ts` (đang khoá "mọi guide version 1") cho phù hợp.
- A3: bọc phần gợi ý phím bằng chữ thường ("⌘/Ctrl + Enter …") bằng class `.kbd-hint`. Lưu ý inv-A: ở footer editor nội tuyến dùng `mr-auto`, ẩn span sẽ dồn nút sang trái → thêm `justify-end`/`ml-auto` cho container nút để bố cục không đổi khi gợi ý ẩn.
- A5: mọi chữ hiển thị "Độ ưu tiên" → "Mức ưu tiên" (web + API chuỗi hiển thị); sửa test đang khoá chuỗi; thêm cấm "Độ ưu tiên" vào `lib/terminology2.test.ts`.
**Test:** `dateFormat.test.ts` (30px → `''`, 40px → `T10`, 240px → `T10/2026`, ngày lỗi), test thuần `groupDaysByMonth`, `default-guides.spec.ts`, `terminology2.test.ts`, `mobile.test.ts` (các file có `.kbd-hint` mới).
**Kiểm trực quan:** Gantt khoảng ngắn (tháng 1–2 ngày) và Lộ trình 1440; một dialog có gợi ý Ctrl+Enter ở iPhone 13 (ẩn) và 1440 (hiện) — bố cục nút không đổi.
**Commit:** `fix(web): nhãn tháng Gantt/Lộ trình không tràn, tour bước 4 đúng trên cảm ứng, ẩn gợi ý Ctrl+Enter trên cảm ứng, thống nhất "Mức ưu tiên"`

### Task 2: Vô hiệu không dùng độ mờ ở ô/nút tự viết + nút đang tải không đổi nền khi rê

**inv-A:** A4 (28 dòng / 23 file, phân loại sẵn).
**Quyết định:** ô nhập/nút/chip tự viết → `disabled:bg-disabled-bg disabled:text-disabled-fg disabled:cursor-not-allowed` (hoặc dùng `Button`/`Input` có sẵn nếu thay được 1-1); GIỮ độ mờ cho icon-button ghost không nền, checkbox/radio native và switch (trạng thái bật/tắt phải còn nhìn ra) — ghi lý do ngắn ở code. `Button` đang tải: thêm `aria-busy:hover:*` để giữ màu biến thể khi rê (không dùng `enabled:hover:` — xem ruling R4 đợt 1).
**Test:** mở rộng `styles/disabledTokens.test.ts`: danh sách file đã chuyển không còn `disabled:opacity-`; allowlist có lý do cho icon/checkbox/switch; `Button.tsx` có `aria-busy:hover:`.
**Kiểm trực quan:** 4–5 chỗ vừa đổi ở sáng/tối 1440.
**Commit:** `fix(web): ô và nút tự viết dùng token vô hiệu thay độ mờ; nút đang tải giữ màu khi rê`

### Task 3: Thay đổi chưa lưu — 5 điểm

**inv-A:** A6.
**Quyết định:**
- Đổi/tạo không gian làm việc: tách "hỏi" khỏi "bỏ nháp": hỏi trước khi gửi; chỉ gọi `onDiscard` của các mục sau khi đổi THÀNH CÔNG (ngay trước khi tải lại); lỗi thì giữ nháp. Hỏi trước khi mở `CreateWorkspaceModal` (bỏ confirm lồng nhau).
- `IntegrationsPage` `?section=`: đi qua cùng đường `pick` có guard (sẽ thành route ở phần B — làm bản nhỏ ở đây).
- `ChangePasswordPanel`: dirty chỉ khi người dùng đã gõ (theo dõi sự kiện input của người dùng hoặc so với giá trị autofill ban đầu) — không hỏi do trình duyệt tự điền.
- `GeneralSection` + `ProfilePanel`: sau khi lưu chỉ đặt lại các ô CHƯA bị đổi trong lúc lưu (so với ảnh chụp lúc bấm lưu); hoặc khoá ô trong lúc lưu như `ProfilePanel` — chọn một cách cho cả hai, ghi vào report.
**Test:** hàm thuần cho "giá trị nào được đặt lại sau lưu" và "dirty có tính autofill không"; `leaveGuard.test.ts` thêm case discard-sau-thành-công.
**Kiểm trực quan:** đổi không gian (giả lập lỗi POST bằng `route.abort`) → nháp còn; trang Tài khoản với autofill (điền bằng script trước khi tương tác) → không có thanh/hỏi; gõ trong lúc lưu (giả lập PATCH chậm) → chữ còn.
**Commit:** `fix(web): giữ bản nháp khi đổi không gian lỗi, bỏ confirm lồng nhau, không coi autofill là sửa, không ghi đè chữ đang gõ khi lưu`

### Task 4: Vai trò tiếng Việt + nhãn lấy từ nguồn chung

**inv-A:** A7.
**Quyết định:** tiêu đề dialog Vai trò & quyền và nhãn tài khoản mẫu ở màn đăng nhập (`DemoAccounts.tsx`) hiện tên vai trò qua `roleLabel`; các nhãn viết tay (aria-label Vai trò & quyền, Nhật ký quản trị, Tự động hoá, Danh mục dự án, Bảng lệnh) đọc từ `lib/navLabels.ts` (thêm khoá nếu thiếu) và thêm vào test tiêu thụ trong `terminology2.test.ts`. Mô tả dưới tiêu đề không lặp lại tiêu đề (sửa các câu "Khách hàng và hợp đồng: …", "Thành viên và nhóm. …", "Nhập từ Jira: …", "Cấu hình hệ thống và feature flags: …").
**Test:** `terminology2.test.ts` (tiêu thụ nhãn, cấm tên vai trò EN trong các file trên).
**Commit:** `fix(web): tên vai trò tiếng Việt ở dialog vai trò và màn đăng nhập; nhãn còn lại lấy từ navLabels; mô tả không lặp tiêu đề`

### Task 5: A11y — primitive `Tabs`, SegmentedControl aria passthrough, cấp tiêu đề StatusPanel

**inv-A:** A8.
**Quyết định:**
- `components/ui/Tabs.tsx`: `tablist`/`tab`/`tabpanel`, `aria-controls`/`aria-labelledby`, roving tabindex, ←/→/Home/End (tái dùng `lib/radioNav` helpers nếu hợp), kích hoạt tự động khi di chuyển (automatic activation), kiểu gạch chân như các tab hiện có. Thay ở `BoardSettingsDialog` (đang là radiogroup) và các tab tự vẽ `role="tablist"` mà inv-A liệt kê (tối đa các chỗ cùng kiểu; chỗ nào là điều hướng bằng URL thì dùng link có `aria-current` thay vì tab — ghi rõ từng quyết định).
- `SegmentedControl`: nhận `aria-describedby`, `aria-invalid` (truyền xuống radiogroup).
- `StatusPanel`: prop `headingLevel` (1|2|3, mặc định 1); panel xem nhanh dùng 2.
**Test:** hàm thuần chọn tab kế tiếp (nếu mới), test đọc-source: không còn `role="tablist"` tự viết ngoài `Tabs.tsx` (allowlist có lý do); `StatusPanel` có `headingLevel`.
**Kiểm trực quan:** Cài đặt bảng (bàn phím: Tab vào, ←/→ đổi tab, nội dung đổi), một trang có tab khác.
**Commit:** `feat(web): primitive Tabs đúng ARIA thay tab tự vẽ; SegmentedControl nhận aria-describedby/invalid; StatusPanel chọn cấp tiêu đề`

### Task 6: 404 trong dự án, gợi ý mã không nháy, dọn kỹ thuật

**inv-A:** A9, A10.
**Quyết định:** route `*` lồng trong `p/:key` (giữ rail/header dự án); `IssueNotFound` không hiển thị kết quả của mã trước (không dùng `keepPreviousData` cho gợi ý này, hoặc lọc theo key hiện tại); chuyển `usePriorityRanks` sang nơi trung lập (`features/issue-meta/` hoặc `lib/`), cập nhật import; gộp `fmtNumber`/`fmtInt` (giữ `fmtNumber` ở `lib/locale.ts`); bỏ `mb-2` vô tác dụng ở `BulkActionBar`; kiểm `VersionsSection` ở 390px — chật thì đổi sang `SearchSelect` như #10/#14 đợt 1; thêm test còn thiếu: `routeSuggest` (bỏ dấu, keyword, không gợi ý chính nó, `%` lỗi), terminology với chuỗi JSX xuống dòng.
**Test:** như trên + test router (đọc-source: `p/:key` có con `*`).
**Kiểm trực quan:** `/p/DEMO/khong-co` (có rail dự án); `VersionsSection` 390px.
**Commit:** `fix(web): 404 trong dự án giữ khung dự án, gợi ý mã không nháy, dọn hàm trùng và test còn thiếu`

### Task 7: Việc mới vào chỉ cho người có quyền duyệt (A-D1)

**inv-A:** R2.
**Quyết định:** `GET /triage` và `GET /triage/count` yêu cầu `issue:triage` (403 nếu thiếu); sửa `triage.controller.spec.ts` + giữ `rbac-coverage` xanh. Web: ẩn tab "Việc mới vào" (và mục trong menu "Thêm"/sheet), lệnh `nav.triage` trong Bảng lệnh, phím tắt nếu có, khi người dùng không có `issue:triage` trong dự án — dùng `useCan` (KHÔNG `useCanIn`, xem inv-A: dự án lưu trữ làm `useCanIn` trả false). Mở thẳng URL `/p/:key/triage` khi không có quyền → `NoAccess`.
**Test:** spec controller (có quyền 200, thiếu quyền 403); test thuần cho hàm lọc tab/lệnh theo quyền.
**Kiểm trực quan:** đăng nhập `dev@tirapro.dev` (DEVELOPER) và admin: dev không thấy tab, mở URL thấy "không có quyền"; admin thấy như cũ.
**Commit:** `fix: danh sách "Việc mới vào" chỉ dành cho người có quyền duyệt việc; ẩn tab và lệnh với người không có quyền`

### Task 8: Kéo-thả xếp hạng không ra rank trùng (A-D2)

**inv-A:** R3.
**Quyết định:** trong `IssuesService.move` (đường `/move` và `/rank`): mở transaction, khoá hàng dự án trước (cùng cách `create` dùng `tx.project.update` theo `issueSequence` hoặc `SELECT … FOR UPDATE` tương đương), rồi mới `resolveRank`/`rankOf` qua `tx`; thứ tự khoá: dự án → kiểm WIP (tránh deadlock); timeout transaction như `create` (30s) khi có thể rebalance; sự kiện realtime/rebalance phát SAU commit (theo mẫu `afterCommit`/`deferred` đã có).
**Test:** spec: rank được tính bằng `tx` sau lệnh khoá (kiểm thứ tự gọi mock); move-to-end và move-between đều đi qua khoá; WIP vẫn chặn đúng.
**Kiểm trực quan:** không bắt buộc (logic server) — chạy lại spec + một lần kéo-thả trên dev server (rồi kéo lại vị trí cũ).
**Commit:** `fix(api): kéo-thả xếp hạng tính mốc trong transaction sau khi khoá dự án — không ra hai việc trùng rank`

### Task 9: Wiki "Tạo trang mới" chỉ tạo trên máy chủ khi lưu lần đầu (A-D3)

**inv-A:** R1.
**Quyết định:** trạng thái `pendingNew` phía client (cha + phạm vi), id nháp dạng `new:<parent>:<scope>` cho `useWikiDraft` (tự lưu nháp cục bộ như cũ); khối soạn thảo tách khỏi `QueryBoundary` của trang đang xem; "Lưu" lần đầu → `POST /wiki` một lần, sau đó chuyển sang id thật (chuyển nháp cục bộ sang key thật, xoá key nháp); "Huỷ" → bỏ nháp, không gọi server; rời trang khi có nội dung → hỏi (guard sẵn có). Không thay đổi API.
**Test:** hàm thuần chuyển id nháp → id thật cho draft storage; test đọc-source: nút "Tạo trang mới" không gọi `create` trực tiếp.
**Kiểm trực quan:** tạo trang → gõ → Huỷ: cây không có trang mới (reload vẫn không); tạo → Lưu: đúng một trang; tạo → gõ → F5: nháp còn. (Trang thử đặt tên "[thử] …" và xoá ngay sau khi kiểm bằng tài khoản admin.)
**Commit:** `fix(web): Wiki tạo trang mới chỉ lưu lên máy chủ ở lần lưu đầu; huỷ không để lại trang rỗng`

### Task 10: Múi giờ hồ sơ chọn từ danh sách (A-D4)

**inv-A:** R4.
**Quyết định:** `ProfilePanel` dùng `SearchSelect` (có tìm) với `timeZoneChoices`/`canonicalTimeZone` từ `features/digests/schedule.ts` (dời vào `lib/` nếu cần dùng chung — cập nhật import digest); giá trị lưu là IANA như cũ; giá trị cũ không có trong danh sách vẫn hiện (qua `resolveOption`).
**Test:** test thuần cho hàm dựng lựa chọn khi giá trị hiện tại là tên cũ/lạ.
**Kiểm trực quan:** Tài khoản › Hồ sơ 1440 + iPhone 13 (mở danh sách, tìm "Hà Nội"/"Việt Nam"); không lưu thật (hoặc lưu rồi trả lại ngay).
**Commit:** `feat(web): múi giờ trong hồ sơ chọn từ danh sách thân thiện thay ô gõ tên IANA`

### Task 11: Release notes phần A

**Files:** `docs/RELEASE_NOTES_2026-10-follow-ups.md` — mục mới "# Giao diện đợt 2 · Phần A (2026-10-19)" theo cấu trúc `##` như đợt 1 (Cần làm khi triển khai: deploy API cùng web vì quyền Việc mới vào + kéo-thả; Thay đổi người dùng thấy; Còn mở). Xoá khỏi "Tồn đọng" của đợt 1 những mục đã sửa (ghi "đã sửa ở đợt 2·A") và khỏi "Sau smoke vòng 2 (ruling, chưa sửa)" 4 việc đã sửa. `DESIGN.md`/`UX_CONVENTIONS.md`: thêm `Tabs`.
**Commit:** `docs: release notes đợt 2 phần A`
