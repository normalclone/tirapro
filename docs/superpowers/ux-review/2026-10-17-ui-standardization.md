> Review bằng mắt 443 ảnh / 129 màn tại commit 2e9f6e3 (Fable 5.1, 2026-10-17). Số `NNN` trỏ tới bộ ảnh chụp trong phiên làm việc (không commit vào repo). Phương án thay lấy từ Lucian UX/UI Prompt: `2026-10-17-lucian-mapping.md`.

# Tirapro — Review chuẩn hoá giao diện (bằng mắt, 443 ảnh / 129 màn)

Nguồn ảnh: `scratchpad/ui-shots/` (build 2e9f6e3, 2026-10-17). Ghi chú chi tiết theo nhóm: `scratchpad/ui-review/notes.md`. Chuẩn đối chiếu: `DESIGN.md`, `PRODUCT.md`, `docs/UX_CONVENTIONS.md`. Tên ảnh ghi tắt theo số thứ tự (vd `046-d-light` = `046-settings-general__d-light.png`).

---

## 1. Nhận xét tổng quan

- **Ấn tượng chung:** nền tảng thị giác tốt và đúng chuẩn tự đặt: Geist, cobalt ≤10%, viền mảnh, dark mode theo token, dialog/form có kỷ luật. Nhìn riêng từng màn thì "ổn"; nhìn 129 màn cạnh nhau thì lộ ra app được xây theo **feature chứ không theo khung**: mỗi feature tự quyết độ rộng, header, vị trí nút, kiểu select, kiểu empty state.
- **Mức nhất quán:** 6/10. Màn làm việc chính (board/backlog/issue/cmdk/dialog tạo việc) nhất quán cao; Settings, Danh mục, Kết nối, Quản trị hệ thống và mobile là nơi lệch nặng.
- **Điểm mạnh nên giữ:** issue detail 2 cột không card lồng (027–029); dialog tạo việc + các editor Danh mục (073, 100–103); confirm dialog (092); cmdk (071); khuôn `SectionCard` icon-tile + list divider (022–024, 051–053); radio card (085, 116); combobox có search + mã mono (119); bảng so sánh vai trò (125); timeline hoạt động (018).
- **5 vấn đề lớn nhất:**
  1. **Không có khung trang chuẩn** — ≥5 độ rộng nội dung và ≥5 kiểu page header trong cùng app; Settings có 4 trang liền kề 4 khung (046/048/049/050), Admin 3 độ rộng (057–061).
  2. **Button primary disabled không có dark variant** — ở dark hiện xanh đậm như enabled (≥11 màn: 015, 020, 027, 030, 036, 056, 060, 073, 085, 101, 117). Lỗi a11y + gây bấm nhầm.
  3. **`<select>` native xen lẫn combobox custom trong cùng form** (020, 049, 104, 108, 111, 036, 056…) — rõ nhất ở mobile (mũi tên hệ, cỡ chữ khác).
  4. **Mobile chưa được "đóng gói"**: FAB đè nội dung + tooltip kẹt (083), select dự án 2 mũi tên chồng (008/063/070), hint phím ⌘K/c/↵ trên cảm ứng (071/081/083), truncation tên thành "A.."/"B…"/"Scr…" (021/034/050/053), bulk bar cắt (121), cột thuộc tính issue chôn cuối trang ~7000px (028/029).
  5. **Vi phạm Absolute Bans của chính DESIGN.md**: KPI "label nhỏ + số to" (006/014/015/017/057/061), eyebrow chữ hoa ở sub-nav và header bảng (020/030/046, 006/012/013), card lồng card (006 "Cần chú ý", 032, 050, 044-mobile), nền xám đặc ngoài token ở ô "Quá hạn" (006/015).

---

## 2. Nhận xét theo khu vực

### Auth (001–004)
- Được: một khung 384px, nút primary full-width, light/dark/mobile sạch.
- Chưa: 001 dùng brand làm header, 002–004 dùng tên tác vụ → thiếu h1 "Đăng nhập". 004 error state đóng trong card, CTA là link — khác pattern lỗi còn lại. Nền dark cảm nhận gần đen (DESIGN nói "slate xanh sâu, không đen tuyền") — cần đo lại `--bg` dark. [001-d-light vs 002-d-light; 004-d-light; 001-d-dark]

### Tài liệu công khai (005)
- Được: nội dung tĩnh rõ, mobile dùng chip nav gọn.
- Chưa: shell riêng với nhóm nav chữ hoa; mục cuối sidebar cắt dưới mép không scroll hint; callout tip dùng icon sparkle (ngữ nghĩa AI). [005-d-light]

### Trang chủ (006, 069)
- Được: checklist Bắt đầu, 3 callout cảnh báo có icon + màu + chữ, dev view (069) gọn.
- Chưa: 5 ô KPI hero-metric; ô "Quá hạn" nền xám đặc (dark thành nâu xám); header section "Tổng quan chung · Báo cáo định kỳ · 2 dự án · In/Lưu PDF" gãy 4 cột ở mobile; card "Cần chú ý" là card lồng card; header bảng in hoa khác 007 sentence-case; 069 số "Quá hạn 0" vẫn tô đỏ. [006-d-light, 006-d-dark, 006-m-light, 069-d-light]

### Dự án: board / backlog / triage / gantt / tree (008–013, 026, 070)
- Được: board/backlog full-bleed mật độ tốt; chip lọc; sprint header có meta rõ; quick-add; empty column copy tốt (026).
- Chưa: loại việc hiển thị 4 kiểu (pill màu / icon / chip chữ / chip xám) qua 4 màn; severity "Maj/Cri" vs "Major/Critical"; ưu tiên chỉ chấm màu không nhãn (vi phạm "màu không phải tín hiệu duy nhất"); triage và tree bó hẹp căn giữa trong khi board/backlog full → nhảy lề khi đổi tab; 010 có 5 nút primary trên 1 màn; "Cài đặt bảng" chiếm nguyên 1 hàng; cột Done cắt không fade; gantt timeline chỉ 55% rộng, 4 màu không chú giải. [008-d-light, 009-d-light, 010-d-light, 013-d-light, 012-d-light]

### Báo cáo (014–017)
- Được: tab cấp 2 underline tách rõ với tab cấp 1 pill; card biểu đồ cùng mẫu; mobile KPI 2 cột gọn.
- Chưa: KPI hero-metric lặp; 015 "Tốt/Cần chú ý/Nguy cơ" là 3 nút rời không trạng thái chọn còn 017 dùng segmented; donut "In Progress" và "In Review" cùng tông; 016 trục ngày ISO `2026-09-22` vi phạm §19 dd/MM. [015-d-light, 016-d-light vs 014-d-light, 015-d-dark]

### Hoạt động / Thùng rác / Cấu hình dự án (018–025)
- Được: timeline 018 chuẩn; `SectionCard` 022–024 là khuôn tốt nhất app.
- Chưa: 4 kiểu header trang con (018 icon+h2+mô tả / 019 chữ nhỏ / 010 h2+badge / 020 h1 lặp tên dự án + breadcrumb); 018 lộ enum `TIME_SPENT`; 020 combobox custom cạnh `<select>` native cùng hàng; "Lưu trữ dự án" nút danger dù khôi phục được; 021 mobile tên cắt "A.."; hành động hàng = 2 icon không nhãn, thùng rác không màu danger. [020-d-light, 021-m-light, 018-d-light-full]

### Chi tiết công việc + peek (027–029, 074–075)
- Được: màn chuẩn nhất app — breadcrumb, pill inline-edit, transition kèm số phím, sidebar divider mảnh.
- Chưa: tiêu đề section trong cột chính 4 kiểu, vùng nhập 3 kiểu (hộp viền / viền đứt / xám); "Thời gian" là card ngoại lệ trong sidebar; 3 pill đỏ cạnh nhau (Bug/Highest/Critical) không phân biệt chiều; peek đặt field trước mô tả (ngược detail); mobile cột thuộc tính rơi cuối ~7000px, FAB đè "Thêm bước". [027-d-light, 028-d-light, 028-m-light-full, 074-d-light]

### Bộ lọc / Wiki / Thành viên / Thông báo / Tài khoản (030–036)
- Được: 033/035/036 cùng khung 720 + h1 — khung workspace nên lấy làm chuẩn; 031 list mobile 2 tầng tốt; 076 user menu chuẩn.
- Chưa: 030 cột trái 288 + eyebrow in hoa + primary full-width, 020 cột 240 eyebrow không nút, 032 cột trái là card → 3 kiểu cột trái; tiêu đề cùng cấp menu 3 độ rộng/3 vị trí (030/032/033); 032 3 lớp viền lồng; 033 2 card 2 kiểu header, nút submit trái-dưới (khác 020 phải); chip admin đỏ như cảnh báo (033/048) nhưng xanh ở 059; 035/077 "Ai đó" thay tên người; 036 `<select>` "English" trong app tiếng Việt. [030-d-light, 032-d-light, 033-d-light, 059-d-light]

### Danh mục (037–042, 126–129)
- Được: 040 bảng tải + legend + công thức; 037 badge sức khoẻ icon+viền+màu là mẫu status badge đúng; 102 ô "Điểm rủi ro = 3×3" tính live.
- Chưa: nút chính 3 vị trí trong cùng sub-nav (037 góc phải / 038-039-042-129 dưới mô tả / 045 trong header card); 041 bó 720 còn lại full; 037 dải KPI inline = kiểu KPI thứ 3; 039/129 legend lẫn chữ màu và pill đặc, ma trận 25 ô rỗng khi 0 mục; mô tả header 3 dòng (040); 126 "T10/26" là định dạng tháng thứ 4; mobile sub-nav chip cắt không fade, filter xếp dọc rộng lệch (038/129). [037-d-light vs 038-d-light, 041-d-light vs 042-d-light, 129-d-light-full]

### Kết nối / Tự động hoá (043–045, 123–124)
- Được: 045 tab ngang Quy tắc/Mẫu/Lặp lại; wizard Telegram (109) hộp hướng dẫn mono tốt.
- Chưa: 3 tầng nav dọc → nội dung còn 720px ở 1440; tầng 3 chỉ 2 mục nên là tab; 043/044 không có page header còn 045 có; nút tạo lặp 2 lần (header card + empty) ở 042/045/123/124/127/128; 044 mobile card lồng card. [043-d-light vs 045-d-light, 123-d-light]

### Cài đặt (046–056, 125)
- Được: 051–053 cùng `SectionCard`; 125 bảng so sánh tốt; 047 copy rõ.
- Chưa: sub-nav vừa "Cài đặt" sentence-case vừa nhóm in hoa; 046/047 không header + card 720, 048 h1 + 720, 049 h1 ~848 lệch trái, 050 h1 full 950; 046 cả trang 1 card logo; 047 checkbox làm on/off trong khi 020/044/060 dùng switch; 048 "Tạo vai trò" 3 lần; 049 3 kiểu control trên 1 hàng; 050 card lồng card; **tên menu ≠ tên trang ở 6/13 mục** (Mức ưu tiên→Độ ưu tiên, Trường thông tin thêm→Trường tuỳ chỉnh, API & kết nối lập trình→API & MCP…). [046-d-light, 048-d-light, 049-d-light, 050-d-light, 051-d-light, 053-d-light]

### Quản trị hệ thống (057–061, 110)
- Được: shell tách biệt, 060 key-value list (AI/Redis/Lưu trữ) là component tốt.
- Chưa: sidebar admin cùng màu app → không nhận ra đã đổi chế độ; 4 trang 3 độ rộng; h1 có icon (059) / không (057/058/060/061); KPI hero-metric; 058 bảng không responsive (mobile gãy 4 dòng), nút "Lưu trữ" text-danger là biến thể nút thứ 5; 057 nút refresh nhãn là "vừa xong" (thời gian, không phải động từ). [057-d-light, 058-m-light, 059-d-light]

### Lỗi / không quyền (062–068)
- Được: 065–068 cùng 1 component (khoá + tiêu đề + CTA).
- Chưa: không có 404 thật — đường lạ rơi vào RouteError nền đỏ "Có lỗi khi hiển thị trang này" + nút "Tải lại" (CTA sai), không shell; 063 vẫn render header dự án NOPE với 2 nút disabled; 064 spinner quay dưới thông báo lỗi + breadcrumb có 2 dấu "/" liền; 4 bố cục not-found khác nhau. [062-d-light, 063-d-light, 064-d-light]

### Lớp UI: cmdk, dialog, popover, FAB (071–122)
- Được: cmdk, confirm, create-issue, editor Danh mục, Kết thúc sprint radio card, callout warning (088), Tạo vai trò (105) nhãn người + mã mono.
- Chưa: header dialog 3 kiểu (icon primary / không icon / icon tròn đỏ) và icon không mang nghĩa (091 "Từ chối" icon xanh); footer: "Hủy" (18 chỗ) vs "Huỷ" (47 chỗ) vs "Để sau"; 104/108 primary enabled khi form trống (khác 20 dialog còn lại); 090 2 primary trong 1 dialog; 117 không footer, không Huỷ; 106/112/113 inline form đảo thứ tự Lưu-trái Huỷ-phải; ≥6 hình thức control chọn-1 (015/017/084/088/102/116); chọn màu 3 kiểu (palette 8 chấm ở 103/114 ≠ 105, swatch native 112); 115 nút "Gửi yêu cầu" mở dialog tiêu đề "Báo lỗi"; 117 "Tạo bằng AI" nhưng mô tả "Chưa dùng AI"; 083 tooltip "Thao tác nhanh" kẹt đè nội dung; 121 bulk bar không có xoá và cắt ở mobile. [084-d-light, 090-d-light, 104-m-light, 106-d-light, 117-d-light, 083-m-light]

---

## 3. Bảng không nhất quán

| # | Vấn đề | Màn liên quan (ảnh) | Mức | Chuẩn đề xuất |
|---|---|---|---|---|
| 1 | Button primary `disabled` ở dark hiện như enabled (opacity-50 trên nền tối không đủ) | 015, 020, 027, 030, 036, 056, 060, 073, 085, 101, 117 (`*__d-dark`) | **P0** | `components/ui/Button.tsx`: disabled = nền `--surface-3` + chữ `--faint` + viền, không dùng opacity; thêm `aria-disabled`. |
| 2 | Ưu tiên chỉ hiển thị bằng chấm màu, không nhãn/icon | 008, 009, 069, 121 d-light | **P0** | Chấm + icon mũi tên + tooltip nhãn (DESIGN §Priority ramp); trong list luôn có `aria-label`. |
| 3 | Không có trang 404; đường lạ rơi vào RouteError "có lỗi" + nút Tải lại | 062 (3 biến thể) | **P0** | `NotFoundPage` trong AppShell: icon, "Không tìm thấy trang", CTA "Về Tổng quan". `RouteError.tsx` chỉ cho lỗi thật. |
| 4 | Spinner "Đang tải…" vẫn quay dưới thông báo "Không tìm thấy công việc" | 064-d-light, 064-d-dark | **P0** | `QueryBoundary`: trạng thái error loại trừ loading. |
| 5 | KPI "label nhỏ + số to" (hero-metric bị cấm) + ô "Quá hạn" nền xám đặc ngoài token | 006, 014, 015, 017, 057, 061 d-light/d-dark | **P0** (Bans) | Một `StatRow` inline (như 037): số tabular 20px + nhãn cùng dòng, không card, không tô nền. Sửa DESIGN: cho phép "stat row" nhưng cấm "stat card". |
| 6 | Card lồng card | 006 "Cần chú ý", 032 wiki (3 lớp), 050 workflow, 044-m-light | **P0** (Bans) | Trong card chỉ dùng hàng divider; list item không viền riêng. |
| 7 | Eyebrow chữ hoa ở sub-nav & header bảng | 020, 030, 046 sub-nav; 006, 012, 013 header bảng; 006 card Dự báo | P1 (Bans) | Nhãn nhóm sub-nav sentence-case `caption` màu muted (như 037/043); header bảng sentence-case như 007/031. |
| 8 | Độ rộng nội dung: full / 1200 / 976 / 848 / 720 không theo loại trang | 006 vs 007; 010/013 vs 009; 041 vs 042; 046/048 vs 049/050; 057 vs 058 vs 059 | P1 | Dùng `pageContainer(size)` đã có trong `components/layout/page.ts` cho MỌI trang không full-bleed; cùng khu = cùng size. |
| 9 | Page header 5 kiểu (không có / h1 / h1+icon / h2+icon+mô tả / breadcrumb+h1 lặp tên) | 018, 019, 010, 020; 030/032/033; 043 vs 045; 046/047 vs 048; 059 vs 057 | P1 | `PageHeader` chung (mục 4.2). |
| 10 | Sub-nav 3 kiểu nhãn nhóm, 3 độ rộng (240/256/288), Kết nối có 3 tầng dọc | 020, 030, 046, 037, 043 d-light | P1 | `SubNav` 240px chung; tầng ≥3 thành tab ngang. |
| 11 | Nút chính trang ở 4 vị trí và lặp 2–3 lần trên 1 màn (header + card header + empty + FAB) | 037 vs 038; 042, 045, 048, 123, 124, 127, 128 | P1 | Primary chỉ ở `PageHeader.actions`; empty state dùng CTA secondary; FAB chỉ mobile. |
| 12 | `<select>` native xen combobox custom trong cùng form | 020, 036, 049, 056, 058, 086, 104, 105, 108, 111 (rõ ở m-light); 20 file có `<select` | P1 | Cấm `<select>` native; dùng `SearchSelect`/Combobox (119). Thêm test như `noNativeDate.test.ts`. |
| 13 | Control chọn-1 có ≥6 hình thức | 015, 017/061, 084/111/125, 088, 102/104, 085/116 | P1 | 2 component: `SegmentedControl` (≤4 lựa chọn ngắn) và `RadioCard` (có mô tả). |
| 14 | Checkbox vs Switch cho cùng ngữ nghĩa bật/tắt | 047 (checkbox) vs 020/044/060 (switch); 085 checkbox vs 020 switch cho "riêng tư" | P1 | Switch = bật/tắt có hiệu lực tức thì; Checkbox = chọn trong form cần Lưu. |
| 15 | Empty state 4 biến thể; not-found/forbidden 4 bố cục | 011/019 (icon) vs 017/064/111 (không icon) vs 025 (chữ trần); 062/063/064/065 | P1 | Dùng `EmptyState` trong `components/ui/primitives.tsx` ở mọi nơi, icon bắt buộc; thêm `StatusPanel` variant not-found/forbidden/error. |
| 16 | Loại việc hiển thị 4 kiểu; severity "Maj/Cri" vs "Major/Critical" | 008, 009, 010, 013 d-light | P1 | `IssueTypeBadge` một kiểu (icon + nhãn, pill nhạt) ở mọi list; severity luôn đầy đủ, viết tắt chỉ khi `compact`. |
| 17 | Dialog header 3 kiểu; icon không mang nghĩa; footer "Hủy/Huỷ/Để sau"; hint phím có/không | 084/091/092/086; 073 vs 086; 116; 101 vs 100 | P1 | `Dialog` chuẩn mục 4.4; chính tả "Huỷ" thống nhất (47 vs 18 chỗ trong source). |
| 18 | Primary enabled khi form trống (2 dialog), 2 primary trong 1 dialog, dialog không footer | 104, 108; 090; 117 | P1 | Mọi dialog: 1 primary ở footer, disabled tới khi hợp lệ. |
| 19 | Inline form đảo thứ tự nút (Lưu trái, Huỷ phải) | 106, 112, 113 | P1 | Luôn Huỷ (ghost) trái, primary phải, căn phải. |
| 20 | Palette màu nhãn 3 bộ khác nhau; chip vai trò/nhóm/nhãn mỗi nơi một hue | 103/114 vs 105 vs 024 vs 112 (swatch); 021/048/097 | P1 | Một `LABEL_PALETTE` 8 màu OKLCH trong DESIGN; `ColorPicker` chung. |
| 21 | Vai trò admin: chip đỏ (033/048) vs xanh (059); vai trò tiếng Anh trong popover | 033, 048 vs 059; 079, 087, 097 | P1 | Đỏ chỉ cho danger; admin = primary-subtle. Nhãn vai trò luôn tiếng Việt theo §19 (`RoleBadge`). |
| 22 | Tên menu ≠ tên trang | 051, 052, 053, 054, 055, 056 d-light | P1 | Một nguồn `NAV` cho label menu = h1 = title dialog tạo. |
| 23 | Định dạng ngày/tháng 4 kiểu | 016 ISO; 014 "05/10"; 069 "Thứ Bảy, 17 thg 10 2026"; 126 "T10/26" | P1 | `formatDate` một nơi: dd/MM, dd/MM/yyyy, "T10/2026"; cấm ISO trong UI. |
| 24 | Mobile: select dự án 2 mũi tên; FAB đè nội dung, tooltip kẹt; hint phím trên cảm ứng | 008/063/070-m-light; 083-m-light; 071/081/083-m-light | P1 | `features/projects/ProjectLayout.tsx` select → combobox; `components/layout/FloatingActions.tsx`: `bottom: safe-area + 16px`, ẩn khi dialog/panel mở, ẩn `<kbd>` khi `pointer: coarse`. |
| 25 | Mobile truncation tên thành "A..", "B…", "Scr…", "Môi trườ…" | 021, 034, 050, 053, 113 m-light | P1 | Hàng list mobile 2 tầng (như 031): tên full-width, meta xuống dưới. |
| 26 | Mobile: bảng/tab/chip tràn phải không fade; bulk bar cắt; bảng admin không responsive | 008, 038, 125, 128, 121, 058 m-light | P1 | Áp `.scroll-fade-x` (UX_CONVENTIONS §10) cho mọi dải cuộn; bulk bar wrap. |
| 27 | Mobile issue: cột thuộc tính chôn cuối trang | 028, 029 m-light-full | P1 | Dưới `md`: thuộc tính chính (trạng thái, phụ trách, hạn) thành dải gọn ngay dưới h1; phần còn lại accordion. |
| 28 | Topbar icon "?" có/không theo màn → chuông/avatar nhảy vị trí | 006/008/033 vs 007/012/030 d-light | P2 | Luôn giữ slot "?" (disabled hoặc mở trang Hướng dẫn chung). |
| 29 | Hành động hàng: icon không nhãn, thùng rác không màu danger, tooltip không thấy | 022, 034, 044, 053 d-light | P2 | `RowActions`: icon ghost + tooltip; xoá màu danger khi hover; mobile → menu "…". |
| 30 | Copy sai ngữ cảnh / máy móc: "bên trái" ở mobile; "Ai đó"; lộ enum `TIME_SPENT`; "Project ID"; "dashboard"; "board" | 030/063 m-light; 035/077; 018; 106; 099; 078 | P2 | Rà theo §19; thêm test terminology cho các chuỗi này. |
| 31 | Nút "Gửi yêu cầu" mở dialog "Báo lỗi"; "Tạo bằng AI" nhưng "Chưa dùng AI" | 115; 117 | P2 | Tiêu đề dialog = nhãn nút mở nó. |
| 32 | Dark: nền `--bg` cảm nhận gần đen, sidebar/content mất phân lớp | 001, 008 d-dark | P2 | Đo lại `--bg`/`--surface` dark theo DESIGN (0.17/0.205); tăng chênh lệch sidebar–content. |
| 33 | Archive dùng nút danger dù khôi phục được; confirm xoá không nêu hậu quả | 020-d-light-full; 093 | P2 | Danger chỉ cho không đảo được; confirm luôn có 1 dòng hậu quả. |
| 34 | 3 bản `SectionCard.tsx` khác nhau (`features/settings`, `features/project-config`, `features/integrations`) | 022–024, 051–053, 043–044 | P2 | Gộp thành 1 `SectionCard` trong `components/ui`. |

---

## 4. Bộ chuẩn giao diện đề xuất

Nguyên tắc: **mỗi khái niệm một component, mỗi component một chỗ.** Mọi quy tắc dưới đây đều kiểm được bằng mắt (so 2 ảnh) hoặc bằng grep/test.

### 4.1 Khung trang (PageFrame)
- **Loại trang → độ rộng** (dùng `pageContainer` trong `components/layout/page.ts`, đã có, 28 file đang gọi nhưng chọn size tuỳ ý):
  - `full` (không container): Bảng việc, Việc chờ, Lịch trình, Cây việc, Việc mới vào, Hoạt động, Thùng rác — **mọi tab trong dự án** cùng full-bleed, lề 24px. (Lệch: 010, 013, 018, 019.)
  - `xl` (max-w-7xl): Tổng quan, Báo cáo, Danh mục (037–040, 126–129), Nhân lực, So sánh vai trò.
  - `lg` (max-w-5xl): Issue detail, Bộ lọc, Wiki, Quy trình, mọi trang Admin.
  - `sm` (max-w-3xl): mọi trang Cài đặt, Thành viên, Thông báo, Tài khoản, Kết nối, Tự động hoá, SLA, Khách hàng. (Lệch: 049, 050, 041 vs 042, 058–061.)
- Padding ngang 24px desktop, 16px mobile; padding dọc 32px. Mobile lề tiêu đề thống nhất 16px (lệch: 035/033 48px vs 036 24px).
- Component: `PageFrame size="sm|lg|xl"` bọc `PageHeader` + nội dung; cấm page tự đặt `max-w-*`.

### 4.2 PageHeader chuẩn
- Cấu trúc duy nhất: `[breadcrumb?] h1 (24px/650) + mô tả ≤ 1 dòng (muted) | actions phải`. Không icon cạnh h1 (bỏ ở 030, 018, 056, 059). Mô tả dài → 1 câu + link "Tìm hiểu thêm" (040, 129).
- Trang trong dự án: `ProjectLayout` đã có header dự án → trang con **không** lặp h1 tên dự án (020), chỉ có tiêu đề tab dạng `h2` 18px + actions (chuẩn theo 010 "Việc mới vào ③ | Gửi yêu cầu").
- Trang Cài đặt/Danh mục/Kết nối: luôn có `PageHeader` (bổ sung cho 043, 044, 046, 047, 051–053, 055).
- `actions`: tối đa 1 primary + 1 secondary; **primary không xuất hiện lần 2 trong body** (bỏ nút trong header card 045/054/123/124/127/128; empty state dùng secondary).
- Màn lệch: 018, 019, 020, 030, 032, 033, 043, 044, 046, 047, 048, 049, 056, 059.

### 4.3 SubNav chuẩn (Cài đặt / Danh mục / Kết nối / Cấu hình dự án / Bộ lọc)
- Rộng 240px, nền `--surface`, nhãn gốc sentence-case `caption` muted (vd "Cài đặt"), nhóm con cũng sentence-case **không uppercase**; mục active = nền `--primary-subtle` + chữ primary (đã đúng ở 037/043).
- Tối đa **2 tầng** dọc (sidebar + subnav). Tầng 3 → tab ngang trong nội dung (sửa Kết nối 043/044 theo mẫu 045).
- Mobile: chip cuộn ngang có `.scroll-fade-x`, chip active cuộn vào tầm nhìn (lệch 038, 128).
- Cột trái của Bộ lọc (030) và Wiki (032) dùng cùng `SubNav` (bỏ card viền ở 032; "Tạo bộ lọc" lên `PageHeader.actions`).
- Gộp `SettingsLayout.tsx`, `ManageLayout.tsx`, `ConnectLayout.tsx`, sub-nav trong `ProjectConfigPage.tsx` thành 1 `SubNavLayout`.

### 4.4 Dialog & Sheet chuẩn
- Size theo `components/ui/Dialog.tsx` đã có (sm 384 / md 512 / lg 672 / xl 896): confirm = sm; form ≤6 trường = md; form 2 cột = lg; create-issue/automation = xl. Không tự đặt width.
- Header: **tiêu đề + mô tả 1 dòng (tuỳ chọn) + ✕**. Icon chỉ cho 2 trường hợp: confirm danger (icon tròn đỏ, 092) và AI (sparkle, 117). Bỏ icon trang trí ở 084/085/087/088/090/105/109/111; bỏ "chấm màu" làm icon ở 103/114.
- Body: max-height `calc(100vh − 160px)`, cuộn nội bộ có fade (lệch 078, 118); textarea mặc định 120px auto-grow (073).
- Footer bắt buộc, căn phải: `Huỷ` (ghost) → `Primary`. Hint phím ở trái footer **luôn có** nếu dialog hỗ trợ Cmd+Enter (bổ sung 085/086/089/100/103). Primary disabled tới khi hợp lệ (sửa 104, 108). Một primary duy nhất (090: "Đề xuất" thành secondary; 117: thêm footer).
- Chính tả: **"Huỷ"** (theo đa số, 47 chỗ). "Để sau" (116) chỉ giữ nếu dialog là nhắc nhở không-bắt-buộc.
- Inline form (106/112/113): cùng footer rule (Huỷ trái, Lưu phải, căn phải).
- Sheet (peek 074/075): thứ tự nội dung giống trang detail; mobile có nút "← Quay lại" bên trái header.
- Confirm: luôn có 1 dòng hậu quả (093 thiếu); danger chỉ khi không đảo được (020 Lưu trữ → secondary/warning).

### 4.5 Form & Settings chuẩn
- Label trên input, help-text **dưới** input (muted, 13px); "(tuỳ chọn)" sau label. Không nhét giải thích dài vào ngoặc trong label (101 "Kỳ (khoảng thời gian…)" → help-text).
- **Cấm `<select>` native.** Chọn-1 có ≤7 lựa chọn ngắn → `SegmentedControl`; >7 hoặc có mô tả → `SearchSelect` (combobox 119, có search khi >6 mục). Thêm test `noNativeSelect.test.ts` như `noNativeDate`.
- Bật/tắt có hiệu lực ngay → `Switch`; chọn trong form chờ Lưu → `Checkbox`. (047 → switch; 085 giữ checkbox vì trong form tạo; 020 cùng field dùng switch vì lưu ngay — ghi rõ quy tắc này trong DESIGN.)
- `SectionCard` một bản duy nhất (gộp 3 file): header icon-tile + tiêu đề + mô tả; body list divider; footer phải = nút. Mọi màn CRUD danh mục (Thành phần, Phiên bản, Nhãn, Ưu tiên, Severity, Trường, SLA, Quy tắc, Mẫu, Lặp lại, Khách hàng, Vai trò, Feature flags 060) dùng nó.
- Nút lưu form trang: cuối card, căn phải (chuẩn 020); sửa 033 (trái), 025 (giữa card).
- Chọn màu: `ColorPicker` 8 chấm từ `LABEL_PALETTE` duy nhất (103/105/114/112/024 cùng bộ).

### 4.6 Empty / Loading / Error / 404 chuẩn
- `EmptyState` (`components/ui/primitives.tsx`) là **duy nhất**: hộp viền đứt + icon (bắt buộc — đổi prop `icon` thành required) + tiêu đề + mô tả ≤2 dòng + CTA secondary (chỉ khi người dùng tạo được). Sửa 017, 064, 111 (thiếu icon), 025 (chữ trần), 032 (primary → secondary, bỏ card bọc), 041 (thiếu link tới Cài đặt).
- Khi list rỗng: ẩn các khối phụ thuộc dữ liệu (ma trận 25 ô rỗng 129; bảng header 058).
- `StatusPanel` variant `not-found | forbidden | error` dùng trong AppShell: icon + tiêu đề + mô tả + CTA "Về Tổng quan" (chuẩn theo 065). 062 → not-found có shell; 063 không render header dự án; 064 tắt spinner.
- Loading: `DelayedSpinner` ≥350ms (đã có) hoặc skeleton; không bao giờ đồng thời với error.

### 4.7 Quy tắc nút
- Biến thể: `primary | secondary | ghost | danger` (bỏ text-danger 058 → ghost màu danger khi hover, hoặc danger solid trong confirm). Nhãn = động từ (057 "vừa xong" → icon refresh + tooltip "Làm mới · vừa xong").
- Mỗi màn **1 primary** (010: 5 nút "Nhận" → secondary, chỉ hàng đang focus là primary; 048: 1 "Tạo vai trò").
- Disabled: nền `--surface-3`, chữ `--faint`, viền `--border`, **không opacity** → sửa `Button.tsx` dòng 7 (`disabled:opacity-50`). Kiểm bằng ảnh d-dark 073.
- Hành động hàng: `RowActions` = icon ghost 32px có tooltip; xoá/gỡ đổi màu danger khi hover; mobile gom thành menu "…".
- FAB (`FloatingActions.tsx`): chỉ hiện dưới `md`; ẩn khi dialog/sheet/bulk bar mở; `bottom = env(safe-area-inset-bottom) + 16px`; bỏ `<kbd>` khi `pointer: coarse`; sửa tooltip kẹt (083).

### 4.8 Badge / chip / trạng thái
- `StatusBadge`: chấm + nhãn, pill `*-subtle` (đã đúng 018/031). Dùng cho cả dịch vụ admin (057/061) thay chip riêng.
- `IssueTypeBadge` (đã có trong `components/ui`): 1 kiểu (icon loại + nhãn, pill nhạt) ở board/backlog/tree/triage; `compact` = chỉ icon + tooltip.
- `PriorityBadge`: icon mũi tên màu + nhãn; `compact` = icon có `aria-label`. Không bao giờ chỉ chấm.
- Severity: nhãn đầy đủ; viết tắt chỉ khi `compact` + tooltip.
- Màu ngữ nghĩa: đỏ = danger/quá hạn; admin/role = `primary-subtle` hoặc `LABEL_PALETTE`; "Đang hoạt động" = success. Legend (039/129): cùng 1 kiểu (4 pill nhạt), không trộn chữ màu và pill đặc.
- KPI: `StatRow` inline (037) — số 20px tabular + nhãn; không card, không nền, không tô màu khi = 0.

### 4.9 Bảng & list
- Header bảng sentence-case, 13px muted, nền `--surface-2` (chuẩn 031); bỏ in hoa ở 006/012/013.
- Bảng rộng hơn khung → `.scroll-fade-x` bắt buộc (008 Done, 031, 039, 125, 040-mobile).
- Hàng list mobile = 2 tầng (031): dòng 1 mã mono + tiêu đề; dòng 2 badge + avatar + meta. Áp cho 010, 021, 034, 050, 053, 058, 113.

### 4.10 Mobile
- Không `<kbd>`/hint phím khi `pointer: coarse` (071, 081, 083). Bảng phím tắt (078) ẩn khỏi touch.
- Select dự án trong `ProjectLayout.tsx` → `SearchSelect` (hết 2 mũi tên; 008/063/070).
- Issue detail dưới `md`: dải thuộc tính chính ngay dưới h1; sidebar còn lại accordion "Thuộc tính khác".
- Bulk bar: wrap 2 hàng hoặc cuộn ngang có fade (121); ẩn FAB khi bulk bar hiện.
- Dialog: footer 1 hàng; nếu 3 nút → primary full-width hàng dưới (073 ổn); segmented không gãy chữ (084/111 → cho phép cuộn hoặc rút nhãn).
- Toolbar nhiều control (012 gantt 4 hàng, 038/129 filter): gom vào nút "Bộ lọc" mở sheet.

### 4.11 Từ điển thuật ngữ bổ sung (thêm vào UX_CONVENTIONS §19)
| Khái niệm | Dùng | Không dùng |
|---|---|---|
| Nút huỷ dialog | **Huỷ** | Hủy, Để sau, Đóng (trừ dialog chỉ-đọc dùng "Đóng") |
| Dashboard | **Bảng tổng quan** (menu "Tổng quan") | dashboard (099) |
| Board trong text | **Bảng việc** | "Trên board" (078) |
| Vai trò | tên tiếng Việt từ `RoleBadge` | Project Admin, Business Analyst, Workspace Admin (079/087/097) |
| Người thực hiện trong thông báo | tên thật | "Ai đó" (035/077) |
| Project ID trong form | **Dự án** (combobox) | "Project ID" (106) |
| Trường tuỳ chỉnh | **Trường thông tin thêm** (đã trong §19) | Trường tuỳ chỉnh (053/113) |
| Tháng trên trục | **T10/2026** | T10/26, thg 10, 2026-09-22 |
| Tên trang | = tên menu = tiêu đề dialog tạo | "Độ ưu tiên"/"Mức ưu tiên", "API & MCP"/"API & kết nối lập trình" |
| Nút mở dialog | = tiêu đề dialog | "Gửi yêu cầu" → "Báo lỗi" (115) |

### 4.12 Sửa tài liệu chuẩn
- **DESIGN.md**: (a) thêm mục "Page frame" với bảng loại trang → size và quy tắc PageHeader/SubNav (hiện chỉ có app shell); (b) thêm token `--disabled-bg/--disabled-fg` cho cả 2 theme và cấm `opacity` cho disabled; (c) thêm `LABEL_PALETTE` 8 màu OKLCH (light/dark) — hiện màu nhãn/nhóm/vai trò không có token nên mỗi nơi tự chọn; (d) làm rõ Bans: "hero-metric" = card số to; cho phép `StatRow` inline; "eyebrow" áp cả nhãn nhóm sub-nav và header bảng; (e) chốt `--bg` dark và yêu cầu sidebar/content chênh ≥1 bậc surface.
- **UX_CONVENTIONS.md**: (a) §9 thêm "Một primary / màn; nút tạo không lặp"; (b) §10 thêm "không hint phím trên pointer coarse", "hàng list mobile 2 tầng", "FAB ẩn khi overlay"; (c) §19 thêm bảng 4.11 và quy tắc "tên menu = h1 = tiêu đề dialog"; (d) Definition of Done thêm: "dùng `PageFrame`/`PageHeader`/`EmptyState`/`SearchSelect` chung — grep không thấy `max-w-`, `<select`, `border-dashed` tự viết trong feature"; (e) thêm quy tắc Switch vs Checkbox.

---

## 5. Lộ trình chuẩn hoá

### Đợt 1 — Thắng nhanh, tác động lớn (≈3–4 ngày dev)
- `Button.tsx`: disabled không opacity + dark token (sửa 1 file, ảnh hưởng toàn app).
- `FloatingActions.tsx`: ẩn ở `md`-up, ẩn khi overlay, safe-area, bỏ kbd trên touch, sửa tooltip kẹt.
- `ProjectLayout.tsx` select dự án → `SearchSelect`; thay toàn bộ `<select>` native (20 file) bằng `SearchSelect`/`SegmentedControl`; thêm test cấm `<select`.
- `EmptyState` chung ở mọi nơi + ẩn ma trận/bảng khi rỗng; `StatusPanel` + `NotFoundPage`; tắt spinner ở 064.
- Chính tả "Huỷ", tên menu = h1 (6 trang Settings), xoá "Ai đó", enum `TIME_SPENT`, "Project ID", `formatDate` thống nhất.
- Rủi ro: thấp — thay component/chuỗi, không đổi luồng. Chạy lại `mobile:audit`.

### Đợt 2 — Khung trang & điều hướng (≈1–1.5 tuần)
- `PageFrame` + `PageHeader` + `SubNavLayout` dùng chung; áp cho Settings, Danh mục, Kết nối, Admin, Bộ lọc, Wiki, Thành viên, tab trong dự án. Kết nối bỏ tầng nav 3.
- Gộp 3 `SectionCard`; nút tạo chỉ ở header; bỏ eyebrow uppercase; header bảng sentence-case.
- Admin shell: dấu hiệu chế độ (màu sidebar/badge).
- Rủi ro: trung bình — đổi lề/độ rộng ảnh hưởng tour `data-tour` và test visual; cần chụp lại bộ ảnh để so.

### Đợt 3 — Component ngữ nghĩa & Bans (≈1 tuần)
- `IssueTypeBadge`/`PriorityBadge`/`StatusBadge`/`StatRow`/`SegmentedControl`/`RadioCard`/`ColorPicker` + `LABEL_PALETTE`; bỏ KPI card, card lồng card, nền xám ô Quá hạn.
- Dialog: header/footer theo 4.4; sửa 090/104/108/117/106/112/113; issue detail section header 1 kiểu; peek cùng thứ tự với detail.
- Rủi ro: trung bình — đụng board/backlog (màn dùng nhiều nhất); optimistic UI không đổi, kiểm bằng vitest + chụp lại.

### Đợt 4 — Mobile & dark polish (≈1 tuần)
- Hàng list 2 tầng cho 010/021/034/050/053/058/113; `.scroll-fade-x` mọi dải cuộn; issue detail mobile dải thuộc tính trên; bulk bar wrap; toolbar gantt/filter gom vào sheet; bảng admin responsive.
- Đo lại `--bg` dark, phân lớp sidebar/content; tour popover dark.
- Cập nhật DESIGN.md / UX_CONVENTIONS.md theo 4.12; thêm gate CI: grep cấm `max-w-` trong features, `<select`, `uppercase` ngoài allowlist.
- Rủi ro: thấp–trung bình; chủ yếu CSS, cần test trên thiết bị thật (safe-area, pointer coarse).

---

## 6. Ảnh minh hoạ

Đường dẫn gốc: `/private/tmp/claude-501/-Users-inrnee-tirapro/c7a3811a-9d86-4438-aa16-daa54e40d122/scratchpad/ui-shots/`

1. `073-layer-create-issue__d-dark.png` — Nút "Tạo công việc" disabled ở dark hiện xanh đậm như enabled; so `073-layer-create-issue__d-light.png` thấy Button thiếu dark variant (lặp ≥11 màn).
2. `046-settings-general__d-light.png` + `050-settings-workflows__d-light.png` — Hai trang liền kề trong Cài đặt: một card 720 không header, một h1 full-bleed 950 — không có khung trang chuẩn.
3. `037-manage-portfolio__d-light.png` + `038-manage-goals__d-light.png` — Cùng sub-nav Danh mục, nút chính một màn ở góc phải, màn kia dưới mô tả; sub-nav sentence-case khác eyebrow in hoa ở Cài đặt.
4. `104-layer-automation-rule-editor__m-light.png` — `<select>` native (mũi tên hệ, chữ to) ngay dưới combobox custom trong cùng dialog; primary "Tạo quy tắc" enabled dù tên trống.
5. `083-layer-fab__m-light.png` — FAB mở trên mobile: tooltip "Thao tác nhanh" kẹt đè nhãn, hint phím "c"/"⌘K" hiện trên cảm ứng, menu đè nội dung.
6. `006-home-dashboard__d-light.png` — 5 ô KPI hero-metric, ô "Quá hạn" nền xám đặc ngoài token, header bảng in hoa, card "Cần chú ý" lồng card — 4 vi phạm Bans trên 1 màn.
7. `008-project-board__d-light.png` + `009-project-backlog__d-light.png` — Cùng loại việc/ưu tiên/severity nhưng board dùng pill màu + "Maj", backlog dùng icon + chấm không nhãn.
8. `062-error-404-path__d-light.png` — Đường dẫn lạ rơi vào màn lỗi đỏ "Có lỗi khi hiển thị trang này" + nút "Tải lại", không shell: app chưa có trang 404.
9. `028-issue-detail-bug__m-light-full.png` — Trang issue mobile dài ~7000px, cột thuộc tính (phụ trách, hạn) nằm sau cả ô bình luận.
10. `021-project-config-members__m-light.png` — Hàng thành viên mobile cắt tên thành "A.." và email "a…"; cần hàng 2 tầng như `031-filters-result__m-light.png`.
