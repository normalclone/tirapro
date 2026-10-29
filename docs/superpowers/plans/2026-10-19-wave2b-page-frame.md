# Đợt 2 · Phần B — Khung trang & điều hướng — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mọi trang dùng một khung (`PageFrame` + `PageHeader`), một menu con (`SubNavLayout`, mobile kiểu "bước vào"), một `SectionCard`, đúng một h1 mỗi route — theo B-D1…B-D6 của spec.

**Architecture:** Chỉ web. Primitive mới ở `apps/web/src/components/layout/` (`PageFrame`, `PageHeader`, `SubNavLayout`) và `components/ui/` (`Breadcrumb`, `SectionCard`); logic thuần (`subNavModel.ts`, `pageFrame` sizes) có test. Tích hợp & Cấu hình dự án chuyển sang route con.

**Tech Stack:** React 18, react-router 6.28 data router, Tailwind, vitest (node), Playwright.

**Spec:** `docs/superpowers/specs/2026-10-19-ui-std-wave2.md` (phần B). Kiểm kê: `inv-B.md` trong workspace SDD (bảng từng trang/size, tiêu đề, menu con, SectionCard, tour/test bị ảnh hưởng, đề xuất API ở §3.2, mobile §3.3, chia task §7.2). Đọc mục được chỉ định trước khi làm.

## Global Constraints

- Như phần A (ràng buộc đợt 1 + primitive đợt 1 bắt buộc + test thuần/đọc-source + gate + không dependency mới + không đụng hạ tầng dùng chung).
- B-D1 kích thước (ràng buộc): `full` = tab trong dự án (Bảng việc, Việc chờ, Lịch trình, Cây việc, Việc mới vào, Hoạt động, Thùng rác, Báo cáo); `xl` = Tổng quan, Dự án, Bảng tổng quan, mọi trang Danh mục; `lg` = chi tiết công việc, Bộ lọc, Wiki, Quản trị hệ thống, Quy trình, Vai trò & quyền; `sm` = Cài đặt còn lại, Thành viên, Thông báo, Tài khoản, Kết nối, Tự động hoá. Không trang nào tự đặt `max-w-*` cho khung.
- B-D2: `PageHeader` = [breadcrumb] → h1 (`text-2xl font-semibold`, không icon) → mô tả ≤ 1 dòng (muted) · actions phải (≤ 1 primary). Tab trong dự án: `variant="tab"` → h2. Đúng một h1 / route; rail menu con không có heading cấp 1.
- B-D4: `SubNavLayout` rộng 240px, nhóm sentence-case (không `uppercase`), active `bg-primary-subtle text-primary`; dưới `lg` hiển thị danh sách mục ở `basePath` và "← <Khu vực>" ở trang con.
- Giữ mọi `data-tour` (forward qua component); `tourSelectors.test.ts` xanh. Giữ `data-audit` của `ProjectLayout`.
- Mỗi task chụp trước/sau 1440 + iPhone 13 cho các trang mình đụng.

## Review Focus

1. Không trang nào mất nút/hành động khi dời lên `PageHeader.actions` (quyền ẩn/hiện giữ nguyên).
2. Route mới của Tích hợp/Cấu hình dự án: `?section=` cũ và link cũ vẫn tới đúng chỗ; guard rời trang (`LeaveGuardHost`) vẫn bắt khi đổi mục có thay đổi chưa lưu.
3. Mobile "bước vào": Back trình duyệt đúng, không vòng lặp chuyển hướng ở `basePath` trên desktop, không mất mục do lọc quyền.
4. Một h1 / route (kể cả trang lỗi/không quyền) và heading không nhảy cấp.
5. Không đổi độ rộng làm vỡ bảng/biểu đồ (Danh mục, Báo cáo full).

---

## Tasks

### Task 1: Nền tảng — `PageFrame`, `PageHeader`, `Breadcrumb`, `SectionCard` (chưa áp dụng)

**inv-B:** §1.1, §2, §4, §5.3, §6.2.
**Files:** Create `components/layout/PageFrame.tsx` (size `sm|lg|xl|full`, padding 24px desktop/16px mobile, dọc 32px; bỏ/giữ `pageContainer` làm wrapper mỏng gọi PageFrame để migrate dần), `components/layout/PageHeader.tsx` (`title`, `description?`, `breadcrumb?: {label,to?}[]`, `actions?`, `variant?: 'page'|'tab'`, `data-tour` forward, `back?: {label,to}` cho mobile "bước vào"), `components/ui/Breadcrumb.tsx` (`nav aria-label="Đường dẫn"`, `ol`, mục cuối `aria-current="page"`, cắt chữ dài), `components/ui/SectionCard.tsx` (header: icon tile `bg-primary-subtle text-primary` tuỳ chọn + title + description + `actions?`; body; `footer?`; forward `data-tour` và `id`). Test: `components/layout/pageFrame.test.ts` (map size → class; không `max-w` ngoài bảng), test thuần `breadcrumbItems`. Cập nhật `layoutTokens.test.ts` nếu `page.ts` đổi.
**Kiểm trực quan:** không (chưa dùng) — thay bằng một trang thử trong test đọc-source.
**Commit:** `feat(web): PageFrame, PageHeader, Breadcrumb, SectionCard dùng chung (chưa áp dụng)`

### Task 2: Gộp mọi `SectionCard`

**inv-B:** §5.1–5.3 (3 bản chuẩn + 3 bản local + 6 chỗ viết tay, ~21 file).
**Quyết định:** thay tất cả bằng `components/ui/SectionCard`; xoá 3 file cũ; giữ `data-tour` (`members-add`, `members-list`…); tile icon trung tính của Tích hợp → dùng tile chuẩn (ghi trong report). Test đọc-source: không còn `SectionCard.tsx` ngoài `components/ui`, không `function SectionCard` cục bộ.
**Commit:** `refactor(web): một SectionCard dùng chung thay mọi bản sao`

### Task 3: `SubNavLayout` + Cài đặt / Danh mục / Kết nối (+ mobile "bước vào")

**inv-B:** §3 (API đề xuất §3.2, mobile §3.3).
**Quyết định:** `components/layout/SubNavLayout.tsx` + `subNavModel.ts` thuần (`visibleGroups`, `isIndexPath`, `backLabel`) có test; `SettingsLayout`, `ManageLayout`, `ConnectLayout` thành lớp mỏng truyền `groups` (đã lọc quyền); bỏ h1 rail và `uppercase`; một độ rộng 240. Dưới `lg`: ở `basePath` hiện danh sách mục (hàng 2 tầng, chevron), các redirect index chỉ chạy ở `lg+` (dùng `useMediaQuery(DESKTOP_MIN_QUERY)`); trang con có `PageHeader.back` "← Cài đặt"/"← Danh mục"/"← Kết nối" (`lg:hidden`). Cập nhật `mobile.test.ts` (scroll-fade), `terminology2.test.ts` (nhãn), thêm `/settings`, `/manage`, `/connect` vào `DEFAULT_ROUTES` của `scripts/mobile-audit.mjs`.
**Kiểm trực quan:** 3 khu × (1440, iPhone 13 danh sách mục, iPhone 13 trang con); Back trình duyệt.
**Commit:** `feat(web): SubNavLayout chung cho Cài đặt/Danh mục/Kết nối; mobile kiểu "bước vào"`

### Task 4: Trang Cài đặt

**inv-B:** §2.2, task T4 ở §7.2.
**Quyết định:** mọi trang con Cài đặt dùng `PageFrame` (sm; Quy trình + Vai trò & quyền: lg) + `PageHeader` (h1 = nhãn menu, mô tả, actions); bỏ h2 trùng tiêu đề, bỏ icon cạnh h1 (`ApiKeysPage`); nút tạo lên header (giữ `data-tour="roles-create"` trên nút); nút tạo trong trạng thái trống → secondary (B-D6). `SlaPage` làm ở task này (cả bản Danh mục nếu dùng chung component).
**Commit:** `refactor(web): trang Cài đặt dùng PageFrame/PageHeader — một tiêu đề, nút chính ở đầu trang`

### Task 5: Trang Danh mục

**inv-B:** §2.3. **Quyết định:** Portfolio, Mục tiêu, Rủi ro & vướng mắc, Nhân lực, Khách hàng, Thời gian xử lý → `PageFrame size="xl"` + `PageHeader`; nút tạo ở header, trạng thái trống dùng secondary. Không đụng số liệu/KPI (phần C).
**Commit:** `refactor(web): trang Danh mục dùng khung chung (xl), nút chính ở đầu trang`

### Task 6: Kết nối — Tích hợp thành route con, Tự động hoá, Báo cáo định kỳ

**inv-B:** §2.4, §3.3 mục 4. **Quyết định:** `/connect/integrations/:section` (Telegram, Kho mã nếu bật cờ, Báo cáo định kỳ…), `?section=` → `Navigate` tới route mới (giữ link `DashboardPage.tsx:~196` và kịch bản `mobile-audit.mjs`); bỏ rail tầng 3 → tab ngang (dùng `Tabs` của phần A nếu là chuyển mục cùng trang, hoặc link có `aria-current` khi là route); bỏ `useConfirmDiscard` thủ công nếu route đã được `LeaveGuardHost` bắt (kiểm bằng ảnh: sửa → đổi mục → hỏi).
**Commit:** `refactor(web): Tích hợp dùng route con (giữ đường dẫn cũ), Kết nối dùng khung chung`

### Task 7: Quản trị hệ thống

**inv-B:** §2.5. **Quyết định:** 5 trang admin → `PageFrame size="lg"` + `PageHeader`; bỏ icon cạnh h1 (`AdminUsersPage`); nút "vừa xong/làm mới" thành icon button có tooltip "Làm mới · <thời gian>" trong actions.
**Commit:** `refactor(web): trang Quản trị hệ thống dùng khung chung`

### Task 8: Trang workspace phẳng

**inv-B:** §2.1. **Quyết định:** Dự án (xl), Thành viên (sm), Thông báo (sm), Tài khoản (sm), Bảng tổng quan danh sách/xem/sửa (xl) → khung chung; Tổng quan (xl) chỉ đổi wrapper/header, không đụng khối KPI.
**Commit:** `refactor(web): trang Dự án, Thành viên, Thông báo, Tài khoản, Bảng tổng quan dùng khung chung`

### Task 9: Wiki, Bộ lọc, chi tiết công việc

**inv-B:** §2.1, §3.1 (Filters/Wiki), §4. **Quyết định:** size `lg`; Bộ lọc/Wiki dùng khung rail của `SubNavLayout` qua slot `rail` (master–detail, không "bước vào"); Wiki bỏ card viền bao rail; "Tạo bộ lọc" lên `PageHeader.actions`; breadcrumb Wiki và chi tiết công việc dời vào `PageHeader.breadcrumb` (một chỗ); bỏ icon cạnh h1 `FiltersPage`.
**Commit:** `refactor(web): Wiki, Bộ lọc, chi tiết công việc dùng khung chung; breadcrumb trong tiêu đề trang`

### Task 10: Tab trong dự án + Cấu hình dự án thành route con

**inv-B:** §2.6, §2.7, §3.3 mục 4. **Quyết định:** Việc mới vào/Thùng rác/Hoạt động/Cây việc/Báo cáo/Bảng việc/Việc chờ/Lịch trình → `PageFrame size="full"` + `PageHeader variant="tab"` (h2) khi trang có tiêu đề riêng; Cấu hình dự án → `/p/:key/config/:section` (giữ `?section=` bằng chuyển hướng), `SubNavLayout` mode route, bỏ 3 h1 — header dự án là h1 của trang, mục cấu hình dùng `PageHeader variant="tab"` (h2); không đụng `ProjectLayout` ngoài phần cần cho route con.
**Commit:** `refactor(web): tab dự án full-bleed dùng tiêu đề tab; Cấu hình dự án thành route con`

### Task 11: Chốt — test chặn tái phạm, tài liệu, chụp lại

**Quyết định:** `components/layout/pageFrame.test.ts` mở rộng: cấm `max-w-(3xl|4xl|5xl|6xl|7xl)` cho khung ngoài `PageFrame` (allowlist có lý do: dialog/popover/nội dung bài viết), cấm `uppercase` ở menu con, cấm `SectionCard` cục bộ, mỗi file trang có tối đa một `<h1` hoặc dùng `PageHeader`. `DESIGN.md`: mục "Khung trang" (bảng size B-D1, PageHeader, SubNav, SectionCard). `UX_CONVENTIONS.md`: DoD thêm dùng `PageFrame/PageHeader/SubNavLayout/SectionCard`. Release notes "# Giao diện đợt 2 · Phần B". Chạy `pnpm --filter @tirapro/web mobile:audit` trên dev server worktree (chỉ điều hướng — đọc script trước) và ghi kết quả.
**Commit:** `test+docs: chặn tái phạm khung trang; DESIGN/UX_CONVENTIONS/release notes phần B`
