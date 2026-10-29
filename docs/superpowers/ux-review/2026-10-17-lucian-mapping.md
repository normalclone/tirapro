# Gợi ý từ Lucian UX/UI Prompt → phương án thay cho Tirapro

Nguồn: https://lucianlabs.dev/uxui-prompt/ — 400 mẫu (001–200 component giao diện, 201–400 hiệu ứng/landing). Mỗi mẫu có prompt + code HTML/JS thuần, CSS scope `.uNNN`, màu qua token `--ux-*`.
Đã đọc toàn bộ danh mục 400 mẫu, chụp và xem kỹ 60 ứng viên (`scratchpad/lucian/shots/`), ghép 11 cặp "Tirapro hiện tại ↔ mẫu" (`scratchpad/lucian/pairs/`). Số `#` trong bảng = số dòng ở bảng không nhất quán của `report.md` (review Fable).

## Nguyên tắc dùng
- **Lấy hành vi, không lấy giao diện.** Code mẫu dùng accent tím `#6A57F2`, nền cream `#F4F2EE`, gradient, glass và easing `--ux-spring cubic-bezier(.34,1.45,.64,1)` (nảy) — đều trái DESIGN.md (bans: nền cream, gradient tím, glass mặc định, side-stripe; motion "Không bounce/elastic", 120/180/240ms ease-out-quart, có `prefers-reduced-motion`). Viết lại bằng React + Radix + token Tirapro.
- **Không cài** `npx skills add Seokwoooo/lucian-uxui`: skill bên thứ ba nạp prompt vào agent — rủi ro chuỗi cung ứng, không cần thiết vì chỉ lấy ý tưởng.

## A. Phương án thay cho lỗi đã review

| # | Tirapro hiện tại | Mẫu | Áp dụng | Bỏ đi | Công |
|---|---|---|---|---|---|
| 3 | Đường lạ → màn lỗi đỏ, mất shell (062) | **089** 404 sửa lỗi gõ | `NotFoundPage` trong AppShell: "Không tìm thấy trang" + "Có phải bạn muốn:" top-3 route/mã việc gần đúng (Levenshtein trên danh sách route + key issue, vd `DEMO-BUG-22` → `DEMO-BUG-2`), CTA "Về Tổng quan" | la bàn quay, đếm số | 0.5 ngày |
| 12 | `<select>` native lẫn combobox (104, 21 file) | **031** listbox tuỳ biến | Nâng `SearchSelect`: Enter/Space mở, ↑↓ di chuyển, gõ chữ cái nhảy tới mục, ✓ ở mục đang chọn, mục 2 dòng (tên + mô tả) khi cần; rồi thay cả 21 file + test `noNativeSelect` | thanh highlight trượt có quán tính | 1.5 ngày (gộp đợt 1) |
| 13 | ≥6 kiểu control chọn-1 | **047** segmented, **015** radio card | `SegmentedControl` cho ≤4 lựa chọn ngắn (kỳ báo cáo, Cơ bản/Nâng cao, chế độ xem); `RadioCard` khi có mô tả (loại dự án, quyền riêng tư, mẫu) | số lăn, giá nhạt dần | 1 ngày |
| 14 | Switch/checkbox lẫn nghĩa | **023** cài đặt thông báo mở rộng | Switch bật thì mở tuỳ chọn con ngay dưới (digest: Hằng ngày/Tuần/Tháng); áp cho Thông báo cá nhân + `DigestsSection` | icon tile màu | 0.5 ngày |
| 20 | 3 bảng màu nhãn | **029** tag input màu | Ô nhãn: Enter tạo chip, màu lấy từ `LABEL_PALETTE` (băm tên → màu cố định), Backspace 2 lần để xoá, gợi ý nhãn có sẵn bên dưới | dấu `#` | 1 ngày |
| 24 | FAB đè nội dung, tooltip kẹt, hint phím trên cảm ứng (083) + drawer (081) | **041** thanh tab đáy | Mobile: thanh tab đáy 5 ô `Tổng quan · Dự án · ＋ Tạo · Thông báo · Tôi`, thay cả drawer + FAB; ẩn khi bàn phím/sheet mở; safe-area | notch, nút tròn nổi, gradient | 2 ngày (đụng AppShell) |
| 26 | Thanh hàng loạt bị cắt trên mobile (121) | **178** dock chọn nhiều | Dock nổi đáy: "2 đã chọn · Trạng thái · Giao · Sprint · … · ✕"; mobile 1 hàng, hành động thừa vào "…"; sau thao tác hiện toast **Hoàn tác** (đã có 21 chỗ). Mở rộng cho Board và kết quả Bộ lọc | — | 1.5 ngày |
| 27 | Chi tiết issue mobile ~7000px, thuộc tính ở cuối (028) | **336** bottom sheet 3 nấc | Mobile: bấm thẻ ở board/backlog → sheet nửa màn (tiêu đề + trạng thái/phụ trách/hạn) → kéo lên = trang chi tiết đầy đủ; dải thuộc tính chính ngay dưới h1 | nảy khi thả (dùng ease-out-expo) | 2–3 ngày |
| 10 | Sub-nav Cài đặt mobile = dải chip bị cắt (046 m) | **286** menu con "bước vào" | Mobile: trang danh sách mục Cài đặt/Danh mục/Kết nối → bấm → trang con có "← Cài đặt" ở header (kiểu push stack 324) | animation thả từng dòng | 1 ngày |
| 9 | 5 kiểu page header | **103** breadcrumb | Breadcrumb 1 dòng trong `PageHeader`; bấm cấp cha mở danh sách anh em (Wiki, Danh mục) | — | gộp vào PageHeader |
| 33 | Confirm xoá không nêu hậu quả (093) | **269** gõ tên để xoá | Chỉ cho thao tác **không đảo được** (xoá vĩnh viễn trong Thùng rác, xoá workspace/API key): nêu hậu quả + gõ tên mới bật nút | vỡ mảnh thẻ | 0.5 ngày |
| 29 | Hành động hàng = icon không nhãn | **038** menu chuột phải | Chuột phải (hoặc Shift+F10) trên thẻ board, hàng backlog, hàng bộ lọc, cây việc → cùng nội dung menu "…" (Jira có). Thêm `@radix-ui/react-context-menu` | menu nở từ con trỏ | 1 ngày |
| 5 | KPI số to (hero-metric bị cấm) (006, 014) | **163** bullet chart | Sprint/OKR: thanh thực tế + vạch mục tiêu + "so với cam kết +4" trên 1 dòng thay ô số to | slider mục tiêu | 1 ngày |
| 17–18 | Footer tạo issue 3 nút (073) | **010** split button | "Tạo công việc ▾" (menu: Tạo & nhập tiếp · Tạo & mở) → footer còn Huỷ + 1 nút | progress chạy trong nút | 0.5 ngày |
| 4.5 | Nút lưu 3 vị trí; **không có cảnh báo rời trang** (0 `beforeunload`/`useBlocker`) | **250** thanh chưa lưu | Trang Cài đặt: thanh dính "2 thay đổi chưa lưu · Bỏ · Lưu" thay nút lưu cuối card; chặn rời trang bằng `useBlocker` (router đã là data router) | thanh rung đỏ | 1 ngày |
| 4.5 | Lỗi form dài | **244** dẫn tới lỗi | Submit lỗi → focus trường lỗi đầu + "3 trường cần sửa" ở đầu form (tạo issue nâng cao, quy tắc tự động hoá, SLA) | rung | 0.5 ngày |
| 4.5 | "Đã lưu" tự viết ở 20 file | **355** chỉ báo tự lưu | 1 component `SaveStatus`: Đang lưu… → Đã lưu lúc 14:02 → Lỗi · Thử lại (mô tả, wiki, inline edit) | mây nhún | 0.5 ngày |
| 21, 30 | Popover thông báo "Ai đó", không tab (077) | **074** chuông thông báo | Popover có tab Tất cả/Nhắc đến/Được giao (trang đã có, popover chưa), avatar người làm + biểu tượng hành động, chấm chưa đọc | chuông lắc | 0.5 ngày |
| 4.4 | Peek chưa duyệt được hàng kế (074) | **273** panel chi tiết từ hàng | Trong peek: ↑↓ / J K sang việc trước/sau, "3/25", hàng đang xem được tô trong list; Esc đóng | — | 1 ngày |
| 048 | Trang Vai trò dài, nhiều card | **184** ma trận quyền | Hàng = nhóm quyền, cột = vai trò, ô ✓ bấm để bật/tắt; quyền thiết yếu của Chủ sở hữu khoá | — | 1.5 ngày |
| 104 | Quy tắc tự động hoá: điều kiện rời rạc | **132** dựng điều kiện | Điều kiện thành câu "Loại việc [là] [Bug] **VÀ/HOẶC** …", hiện "khớp 12 việc hiện có" (đếm qua JQL) | — | 1.5 ngày |

## B. Gợi ý mới đáng thêm
- **092** tìm kiếm rỗng gợi ý nới bộ lọc — Bộ lọc/JQL không ra kết quả: liệt kê từng điều kiện kèm "bỏ điều kiện này → 12 việc" (cần API đếm theo từng mệnh đề).
- **299** đồng hồ hạn mức — WIP limit cột board (số/giới hạn, cam ≥80%, đỏ khi vượt), sức chứa sprint.
- **077** thả cảm xúc vào bình luận (Tirapro chưa có reaction).
- **268** danh sách @nhắc — đã có; thêm dòng "Sẽ thông báo: [avatar]" dưới ô bình luận.
- **285** mời thành viên — hàng "Đang chờ" chèn đầu danh sách, đổi vai trò ngay trên hàng.
- **037** đổi workspace — mục 2 dòng (tên + số thành viên), ✓ ở workspace hiện tại, Cài đặt/Đăng xuất cùng menu.
- **254** chia sẻ — bộ lọc/bảng tổng quan: ai có quyền + "ai có link" + Sao chép link.
- **224 / 086** AI — câu trả lời có số nguồn bấm ra issue/wiki gốc; hiển thị dần + nút Dừng (Sprint assistant, AI triage).
- **144** sửa cột bảng — bấm tiêu đề cột kết quả bộ lọc → Dời trái/phải, Ẩn cột.
- **289** cài đặt hiển thị — Cài đặt bảng: mật độ, trường hiện trên thẻ, xem trước trực tiếp.
- **091** hàng đợi ngoại tuyến — mất realtime: banner "Mất kết nối · 2 thay đổi chờ gửi", thay đổi chờ có viền đứt.
- **030** chọn khoảng ngày — ngày sprint 1 lịch 2 đầu + "14 ngày · 20/10 – 02/11".
- **109 / 181 / 171** — lịch nghỉ tô ô theo giờ; giao việc theo sức chứa; chia ngân sách năng lực (Phân bổ nguồn lực).
- **197** tour nổi bật — so với Hướng dẫn hiện có (080): lỗ sáng + "2/4 · Bỏ qua · Quay lại · Tiếp".

## C. Loại (không hợp)
- Trái Absolute Bans: 001 Liquid glass, 211 viền phát sáng, 228 viền theo con trỏ, 263 chữ gradient, 226/319/341/352/363 nền hero, 072 cảnh báo có sọc cạnh (lấy ý gập/mở, bỏ sọc).
- Nảy/confetti/trang trí: 011 FAB hình quạt, 013 switch co giãn, 088 thư mục nuốt giấy, 093 pháo giấy, 003 giữ để xoá (khó khám phá, kém a11y).
- Phần lớn 201–400 (landing, thương mại, khuyến mãi, chữ/scroll chuyển động): không hợp công cụ B2B.

## D. Gắn vào lộ trình của review Fable
- **Đợt 1** (+1.5 ngày): 089 trang 404 gợi ý gần đúng · 031 nâng `SearchSelect` khi thay `<select>` · 250 thanh chưa lưu + chặn rời trang cho Cài đặt.
- **Đợt 2**: 103 breadcrumb trong `PageHeader` · 286 menu con mobile · 041 thanh tab đáy thay drawer + FAB (cần chốt).
- **Đợt 3**: 047/015 `SegmentedControl`/`RadioCard` · 029 tag input + `LABEL_PALETTE` · 163 bullet thay KPI · 010 split button · 184 ma trận quyền · 074 popover thông báo · 132 dựng điều kiện · 355 `SaveStatus` · 244.
- **Đợt 4**: 178 dock hàng loạt · 336 sheet mobile · 273 J/K trong peek · 038 menu chuột phải · 269 gõ tên để xoá.
- Phụ thuộc mới có thể cần: `@radix-ui/react-context-menu` (038); sheet kéo nấc (336) tự viết trên Radix Dialog hoặc thêm `vaul`.
