# Design

> Hệ thống thị giác cho Tirapro. Register: **product** (UI phục vụ tác vụ). Mood:
> _"đài quan sát ban ngày — ánh sáng trong, dữ liệu tĩnh, xanh cobalt điềm tĩnh"_.
> Chiến lược màu: **Restrained** — nền trung tính gần như trắng, một màu brand (cobalt)
> dẫn dắt nhận diện (≤10% bề mặt). Mood nằm ở brand color + typography, KHÔNG ở nền.
> Mọi giá trị dùng **OKLCH**. Token map thẳng sang CSS variables + Tailwind theme.

## Color Strategy

Restrained. Nền light = trắng tinh (`oklch(1 0 0)`); cobalt primary và type gánh "cảm giác".
Nền dark = slate xanh sâu (KHÔNG đen tuyền → tránh dark-terminal). Neutral được tint nhẹ về
hue brand (chroma 0.004–0.008) để cả hệ thống "thuộc về nhau", không phải xám chết.

## Color Tokens — Light (default)

| Role               | OKLCH                         | Dùng cho                                 |
| ------------------ | ----------------------------- | ---------------------------------------- |
| `--bg`             | `oklch(1 0 0)`                | nền app gốc (trắng tinh)                 |
| `--surface`        | `oklch(0.985 0.004 250)`      | panel, card, sidebar                     |
| `--surface-2`      | `oklch(0.968 0.005 250)`      | hàng hover, input, vùng chìm             |
| `--surface-3`      | `oklch(0.945 0.006 250)`      | column board, vùng nhấn nhẹ              |
| `--disabled-bg`    | `oklch(0.93 0.006 250)`       | nền control vô hiệu (thay opacity)       |
| `--disabled-fg`    | `oklch(0.62 0.01 256)`        | chữ/icon control vô hiệu                 |
| `--border`         | `oklch(0.915 0.006 250)`      | đường kẻ, viền 1px                       |
| `--border-strong`  | `oklch(0.86 0.008 250)`       | viền nhấn, divider rõ                    |
| `--ink`            | `oklch(0.27 0.013 256)`       | text chính (body) — ~10:1 trên bg        |
| `--ink-strong`     | `oklch(0.20 0.014 256)`       | heading, số liệu                         |
| `--muted`          | `oklch(0.46 0.012 256)`       | text phụ — vẫn ≥4.5:1 trên bg/surface    |
| `--faint`          | `oklch(0.60 0.010 256)`       | icon phụ, placeholder (chỉ non-critical) |
| `--primary`        | `oklch(0.52 0.17 252)`        | brand cobalt — nút chính, link, focus    |
| `--primary-hover`  | `oklch(0.46 0.17 252)`        | hover nút chính                          |
| `--primary-fg`     | `oklch(0.99 0.005 250)`       | text trên nền primary (trắng, ≥4.5:1)    |
| `--primary-subtle` | `oklch(0.95 0.03 252)`        | nền nhạt cho badge/selected              |
| `--ring`           | `oklch(0.52 0.17 252 / 0.55)` | focus ring (offset 2px)                  |

## Color Tokens — Dark

| Role               | OKLCH                        | Ghi chú                         |
| ------------------ | ---------------------------- | ------------------------------- |
| `--bg`             | `oklch(0.17 0.013 256)`      | slate xanh sâu, KHÔNG đen tuyền |
| `--surface`        | `oklch(0.205 0.014 256)`     | panel/card                      |
| `--surface-2`      | `oklch(0.235 0.015 256)`     | hover, input                    |
| `--surface-3`      | `oklch(0.265 0.015 256)`     | column board                    |
| `--disabled-bg`    | `oklch(0.255 0.012 256)`     | nền control vô hiệu             |
| `--disabled-fg`    | `oklch(0.52 0.012 256)`      | chữ/icon control vô hiệu        |
| `--border`         | `oklch(0.30 0.012 256)`      | viền 1px                        |
| `--border-strong`  | `oklch(0.37 0.012 256)`      | divider rõ                      |
| `--ink`            | `oklch(0.92 0.006 256)`      | text chính                      |
| `--ink-strong`     | `oklch(0.98 0.004 256)`      | heading                         |
| `--muted`          | `oklch(0.70 0.012 256)`      | text phụ — ≥4.5:1 trên bg       |
| `--faint`          | `oklch(0.56 0.012 256)`      | icon phụ                        |
| `--primary`        | `oklch(0.66 0.15 252)`       | cobalt sáng hơn cho nền tối     |
| `--primary-hover`  | `oklch(0.72 0.15 252)`       |                                 |
| `--primary-fg`     | `oklch(0.16 0.02 256)`       | text tối trên primary sáng      |
| `--primary-subtle` | `oklch(0.30 0.05 252)`       | nền badge selected              |
| `--ring`           | `oklch(0.66 0.15 252 / 0.6)` |                                 |

## Semantic & Status Colors

Trạng thái LUÔN kèm icon + nhãn (màu không phải tín hiệu duy nhất — WCAG AA).
Status category (Jira): TODO / IN_PROGRESS / DONE.

| Token               | Light                   | Dark                   | Dùng                               |
| ------------------- | ----------------------- | ---------------------- | ---------------------------------- |
| `--status-todo`     | `oklch(0.60 0.018 256)` | `oklch(0.68 0.02 256)` | cột/badge To Do (slate trung tính) |
| `--status-progress` | `oklch(0.55 0.13 245)`  | `oklch(0.68 0.13 245)` | In Progress (xanh hoạt động)       |
| `--status-done`     | `oklch(0.58 0.13 150)`  | `oklch(0.70 0.14 150)` | Done (xanh lá)                     |
| `--success`         | `oklch(0.58 0.14 150)`  | `oklch(0.70 0.14 150)` | thành công                         |
| `--warning`         | `oklch(0.72 0.15 75)`   | `oklch(0.80 0.15 75)`  | cảnh báo (amber)                   |
| `--warning-ink`     | `oklch(0.48 0.12 75)`   | `oklch(0.85 0.12 80)`  | CHỮ cảnh báo (AA, ≥ 6:1 trên nền)  |
| `--danger`          | `oklch(0.55 0.20 25)`   | `oklch(0.66 0.19 25)`  | lỗi/xóa (đỏ)                       |
| `--info`            | `var(--primary)`        | `var(--primary)`       | thông tin                          |

Priority ramp (highest→lowest): `danger` → `oklch(0.65 0.17 45)` (cam) → `warning` →
`status-progress` → `faint`. Hiển thị kèm icon mũi tên, không chỉ màu.

**Ưu tiên = `PriorityIcon`**, không bao giờ chỉ là chấm màu: mũi tên chọn theo **vị trí hạng** trong cấu hình ưu tiên (⇈ cao nhất · ↑ cao · = trung bình · ↓ thấp · ⇊ thấp nhất; cấu hình 2–3 mức thì chỉ dùng ↓ / ↑ hoặc ↓ = ↑), màu lấy từ ramp trên / cấu hình, kèm `aria-label` + tooltip "Ưu tiên: <tên>". Dùng ở thẻ board, dòng Việc chờ, Tổng quan, Việc mới vào, SLA, Cây việc.

## Typography

- **UI / body**: **Geist Sans** (self-host qua `@fontsource-variable/geist`). KHÔNG dùng
  Inter / Arial / system default (anti AI-slop). Một family, nhiều weight để tạo hierarchy.
- **Mono**: **Geist Mono** — issue key (`PROJ-123`), số story point, code block, JQL.
- Pairing trên trục cùng-họ (sans + mono cùng designer) → an toàn, không "hai sans na ná".

Type scale (rem, 1rem=16px) — line-height đặc cho mật độ cao:

| Token     | Size / LH     | Weight | Dùng                                     |
| --------- | ------------- | ------ | ---------------------------------------- |
| `display` | 2.0 / 1.15    | 700    | tiêu đề trang lớn (hiếm)                 |
| `h1`      | 1.5 / 1.2     | 650    | tiêu đề màn                              |
| `h2`      | 1.25 / 1.25   | 620    | section                                  |
| `h3`      | 1.075 / 1.3   | 600    | tiêu đề card/issue                       |
| `body`    | 0.875 / 1.5   | 400    | text mặc định (14px — chuẩn product dày) |
| `body-sm` | 0.8125 / 1.45 | 400    | meta, phụ                                |
| `caption` | 0.75 / 1.4    | 500    | nhãn, badge                              |
| `mono`    | 0.8125 / 1.4  | 500    | key/số                                   |

- Heading: `letter-spacing: -0.011em` (floor −0.04em); `text-wrap: balance` cho h1–h3.
- Prose dài (issue description): `max-width: 72ch`, `text-wrap: pretty`.
- Tabular numbers (`font-variant-numeric: tabular-nums`) cho mọi số liệu/report.

## Spacing & Layout

- Base 4px. Scale: `0,1=4,2=8,3=12,4=16,5=20,6=24,8=32,10=40,12=48,16=64`.
- **Density without noise**: ưu tiên whitespace + hierarchy thay vì viền hộp. Card chỉ dùng
  khi là affordance tốt nhất (issue card trên board). **Cấm card lồng card.**
- App shell: sidebar trái (collapsible, 240px / 56px) + topbar (52px) + content. Flexbox cho
  1D, Grid cho 2D. Board = flex ngang các column, mỗi column flex dọc các card.
- Responsive grid không breakpoint: `repeat(auto-fit, minmax(280px,1fr))` (vd lưới project).
- Mobile (dưới `lg`): sidebar **thay bằng thanh tab đáy** (xem "Điều hướng mobile"); board column → vuốt ngang; touch target ≥ 44px.

## Radius, Border, Elevation

- Radius: `sm=4px md=6px lg=8px xl=12px full=9999px`. Mặc định md. **Không bo quá lớn** (anti đồ chơi).
- Border 1px `--border`. KHÔNG dùng side-stripe `border-left` màu làm accent (cấm tuyệt đối).
- Shadow (cool-tinted, nhẹ, phân lớp):
  - `--shadow-sm`: `0 1px 2px oklch(0.4 0.03 256 / 0.06)`
  - `--shadow-md`: `0 2px 8px oklch(0.4 0.03 256 / 0.08), 0 1px 2px oklch(0.4 0.03 256 / 0.06)`
  - `--shadow-lg` (popover/dialog): `0 8px 28px oklch(0.35 0.03 256 / 0.14)`
- Z-index scale (ngữ nghĩa, không bao giờ 999/9999):
  `dropdown=1000, sticky=1100, backdrop=1200, modal=1300, toast=1400, tooltip=1500`.

## Motion

- Durations: `fast=120ms, base=180ms, slow=240ms`. Easing: `ease-out-quart`
  `cubic-bezier(0.25,1,0.5,1)` / `ease-out-expo` `cubic-bezier(0.16,1,0.3,1)`. **Không bounce/elastic.**
- Dùng cho: mở dialog/popover (fade+scale 0.98→1), toast (slide+fade), drag card (lift shadow),
  stagger nhẹ khi load list (≤4 item đầu). Optimistic UI: card di chuyển tức thời.
- **`@media (prefers-reduced-motion: reduce)`**: thay bằng crossfade/instant cho MỌI animation.
- Reveal phải tăng cường default đã hiển thị; không gate nội dung sau transition.

## Khung trang (đợt 2 · phần B)

Mọi màn trong AppShell dựng từ bốn khối dùng chung ở `components/layout` + `components/ui`; trang/feature **không tự đặt** `max-w-*`, đệm trang, tiêu đề h1 hay thẻ có viền (test `pageFrame.test.ts` chặn).

**`PageFrame` — bề rộng + đệm (B-D1).** Nội dung mọi màn bắt đầu cùng một vị trí ngang. Đệm ngang 16px (mobile) / 24px (từ `sm`), dọc trên 24 → 32px, dưới 32px; từ `lg` đệm đáy 112px (`lg:pb-28`) để nút nổi (FAB) không che dòng cuối.

| Cỡ     | Bề rộng            | Dùng cho                                                                                                                                              |
| ------ | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sm`   | `max-w-3xl`        | form/danh sách hẹp: Cài đặt (trừ Vai trò & quyền, Quy trình), Thành viên, Thông báo, Tài khoản, Kết nối, Tự động hoá, Cấu hình dự án                  |
| `lg`   | `max-w-5xl`        | màn làm việc vừa: chi tiết công việc, Bộ lọc, Wiki, Quản trị hệ thống, Quy trình, Vai trò & quyền                                                     |
| `xl`   | `max-w-7xl`        | bảng mật độ cao: Tổng quan, Dự án, Bảng tổng quan, các trang Danh mục                                                                                 |
| `full` | theo vùng nội dung | tab trong dự án: Việc mới vào, Thùng rác, Hoạt động, Cây việc, Báo cáo (Bảng việc/Việc chờ/Lịch trình là bề mặt công cụ riêng, không qua `PageFrame`) |

Ngoại lệ có chủ đích ngoài `PageFrame` (allowlist trong test, kèm lý do): cỡ hộp thoại `xl` của `Dialog`; bài viết của trang Hướng dẫn công khai.

**`PageHeader` — đầu trang (B-D2).** Thứ tự: breadcrumb → tiêu đề (không icon) → **mô tả đúng một câu, một dòng** → nút bên phải.

- Mô tả ngắn; giải thích dài đặt ở trang Hướng dẫn và nối bằng `DocsLink` ("Tìm hiểu thêm", mở `/documentation#<mục>` ở tab mới).
- `variant="page"` là h1 (mỗi route đúng **một** h1). `variant="tab"` là h2, dành cho tab trong dự án và các mục của Cấu hình dự án — đã có h1 của header dự án; thẻ bên dưới dùng `SectionCard headingLevel={3}` (không nhảy cấp).
- **h1 của dự án:** `ProjectLayout` vẽ tên dự án là h1 duy nhất của mọi tab dự án. Dưới `lg` ô chọn dự án đã hiện tên nên h1 chuyển sang `sr-only` (KHÔNG `hidden`/`display:none`, vì như vậy trang mất h1 với trình đọc màn hình).
- **Nút chính:** tối đa MỘT nút chính trong `actions` (xuống dòng riêng dưới `sm`); khung `actions` không vẽ gì thì tự ẩn (`empty:hidden`) để khỏi chừa khe (Tổng quan, Danh mục).
- **Không tiêu đề** (bỏ `title`): chỉ breadcrumb + actions, dành cho trang tự vẽ h1 hiển thị ngay bên dưới — chi tiết công việc, nơi ô tiêu đề sửa tại chỗ (bọc trong `<h1>`, kể cả khi đang sửa, có `aria-label="Tiêu đề công việc"`) chính là h1.
- **`titleHidden`**: h1 chỉ cho trình đọc màn hình (`sr-only`) cùng hàng breadcrumb + actions — dùng cho trạng thái chưa có tiêu đề hiển thị (đang tải/lỗi/không thấy của chi tiết công việc) để mọi trạng thái vẫn có **đúng một h1**.

**Vị trí nút tạo (RB4).** Nút tạo chính của trang nằm ở `PageHeader.actions`. Ba ngoại lệ:

1. Trang sửa danh sách tại chỗ (Mức ưu tiên, Mức nghiêm trọng, Trường thông tin thêm, Quy trình): form thêm mở **ngay dưới danh sách** nên nút "Thêm…" (secondary) đứng ở đó, không lên header.
2. Tạo theo phạm vi tab (vd tab Nhóm của Thành viên, tab của Tự động hoá): nút nằm ở header của thẻ (`SectionCard.actions`), vì chỉ áp cho tab đó.
3. Nút tạo trong `EmptyState` luôn là **secondary** (B-D6): lối vào chính đã ở header; khối trống không được tranh sự chú ý.

**`SubNavLayout` — menu con (B-D4).** Dùng cho Cài đặt, Quản lý (Danh mục), Kết nối, Cấu hình dự án. Chế độ route: mỗi mục là một route con (`basePath` + id), nên đổi mục đổi pathname và `LeaveGuardHost` bắt form chưa lưu — không tự chặn bằng state. Từ `lg`: rail trái 240px (nhóm chữ thường-hoa kiểu câu, KHÔNG `uppercase`, không heading), route index chuyển hướng tới mục đầu. Dưới `lg`: **"bước vào"** — `basePath` là danh sách mục (không chuyển hướng), trang con có hàng "‹ <khu vực>" (giữ `?query` và slot `top`); Back của trình duyệt về danh sách. Liên kết cũ dạng `?section=` được chuyển hướng sang route con.

**`RailLayout` — master–detail (ngoại lệ có tài liệu của B-D4).** Bộ lọc và Wiki: rail 288px vì là DANH SÁCH ĐỘNG (tìm/xoá/cây trang), không "bước vào"; dưới `lg` rail xếp trên nội dung. Rail không có heading; h1 thuộc `PageHeader` trong nội dung. `RailLayout` và `SubNavLayout` dùng chung chất liệu qua `railSurface.ts` (`RAIL_SURFACE`: nền `surface`, `border-r`, đệm ngang 12px, cuộn riêng từ `lg`); chỉ khác `RAIL_WIDTH` (`nav` 240px, `master` 288px).

**`SectionCard` — thẻ duy nhất có tiêu đề (B-D3).** Một thẻ = icon (tuỳ chọn) + tiêu đề h2/h3 + mô tả + nút + chân thẻ; thẻ đơn mục của trang đã có `PageHeader` thì **không tiêu đề** (mô tả đã chuyển lên header). Cấm khai báo `function SectionCard/Card` cục bộ và header thẻ tự vẽ (viền dưới + tiêu đề) — allowlist có lý do: ô biểu đồ Báo cáo, ô thông số trang Hướng dẫn, hàng lồng trong trình sửa quy tắc, thẻ công việc trên Bảng, panel Epic của Backlog.

- **Giữ `GroupCard` (Danh mục), `ClientCard` (Khách hàng), `GoalCard` (Mục tiêu):** đó là **mục của danh sách** — mỗi thẻ là một thực thể lặp, tiêu đề là nút thu/mở kèm tiến độ/trạng thái/liên hệ — không phải thẻ khu vực tĩnh. `SectionCard` không biểu diễn thu/mở, ép vào chỉ thêm nút thừa. Điều kiện giữ (test kiểm): phải có `aria-expanded`.

**Vùng chạm.** `Button size="icon"` là 36px với chuột và **44px** khi `pointer: coarse`, áp toàn app (không đặt riêng từng nút).

## Components (conventions)

shadcn/ui (Radix primitives) + Tailwind, restyle theo token trên. Primitives P0:
Button (primary/secondary/ghost/danger), Input, Textarea, SearchSelect, SegmentedControl, Dialog (dùng
`<dialog>`/portal — tránh bị clip trong overflow), Dropdown, Tooltip, Popover, Avatar,
Badge/Tag, Tabs, Checkbox, Switch, Toast (sonner-style), Skeleton, Command palette (cmdk).

**Button — vô hiệu:** nền `disabled-bg`, chữ `disabled-fg`, không dùng opacity (ghost/outline: nền trong suốt, chỉ đổi chữ); đang tải giữ màu biến thể + spinner (`aria-busy`). Hover chỉ khi bật. Ô nhập/trigger vô hiệu dùng cùng token + `cursor-not-allowed`. Chip bật/tắt (`aria-pressed`) khi vô hiệu vẫn phải thấy rõ bật hay tắt: nhánh "bật" có kiểu vô hiệu riêng, nhánh "tắt" dùng token.

**Nút Lưu/Tạo — chống bấm đúp:** thao tác tạo bản ghi từ nút hoặc phím tắt (Ctrl/⌘+Enter, giữ phím lặp) bọc bằng `singleFlight(ref, fn)` (`lib/singleFlight.ts`) — `ref` đặt **đồng bộ** nên lần gọi thứ hai trong cùng tick bị bỏ. Dùng ở chỗ chưa có cờ "đang chạy" đồng bộ (cờ `isPending` của react-query chỉ đổi sau một lượt render nên chưa chặn được lần gọi thứ hai).

Đặc tả chủ đạo:

- **Issue card** (board): key mono + type icon + summary (2 dòng max) + avatar assignee +
  priority icon + story points (tabular). Không viền nặng; nền `--surface`, hover `--surface-2`,
  shadow-sm khi kéo. Selected: ring `--primary`.
- **Board column**: nền `--surface-3`, header dính (count + WIP), cuộn dọc độc lập.
- **Issue detail**: hai cột (nội dung + sidebar field), KHÔNG card lồng; divider mảnh.
- **Status badge**: chấm màu category + nhãn; pill bo `full`, nền `*-subtle`.
- **Thay đổi chưa lưu** (form trang có nút Lưu: Chung của dự án, Hồ sơ, banner bảo trì): `UnsavedBar` dính đáy vùng nội dung — "Có thay đổi chưa lưu · Bỏ thay đổi · Lưu" — thay nút Lưu cuối thẻ; rời trang/đổi mục khi đang sửa thì hỏi xác nhận (một `LeaveGuardHost` duy nhất giữ chặn điều hướng).
- **Empty/loading/error states**: bắt buộc cho mọi list. Dùng đúng component dùng chung, không tự vẽ:
  - `EmptyState` — danh sách/khối trống (viền đứt): `icon` **bắt buộc** (trang trí, `aria-hidden`), tiêu đề + một câu giải thích + nút hành động kế tiếp; `compact` cho ô nhỏ trong thẻ/panel. Khối phụ thuộc dữ liệu (vd ma trận rủi ro) **ẩn** khi danh sách rỗng, không vẽ khung trống.
  - `StatusPanel` — cả màn không dùng được, 3 loại: `not-found` (không tìm thấy), `forbidden` (không có quyền), `error` (lỗi, `role="alert"`). Lỗi mạng ≠ không tìm thấy; refetch nền lỗi thì **giữ nội dung đang hiển thị**, không thay bằng màn lỗi. Đường lạ → trang 404 thật trong khung app (gợi ý tối đa 3 trang gần đúng); công việc không tồn tại → gợi ý mã gần đúng.

**Chọn ô nhập lựa chọn:** KHÔNG dùng `<select>` native (test `noNativeSelect` chặn).

- `SegmentedControl` (radiogroup) khi **≤ 4 lựa chọn ngắn, cố định**, loại trừ nhau (hướng sắp xếp, chế độ, phạm vi). Bấm lại mục đang chọn không làm gì.
- `SearchSelect` cho mọi trường hợp còn lại (danh sách dài/động/nhóm). Có đủ bàn phím (↑↓ Home End, Enter, Esc) và ARIA combobox/listbox; mục được 2 dòng (mô tả) + icon; **≤ 6 mục thì ẩn ô tìm** (gõ chữ cái để nhảy), trừ khi tìm phía máy chủ hoặc đặt `searchable`. Chọn lại giá trị hiện tại không phát `onChange`.
- `Tabs` + `TabPanel` cho hàng tab đổi **phần nội dung cùng trang** (kể cả khi lưu tab ở `?tab=`): `tablist`/`tab`/`tabpanel`, `aria-selected`, `aria-controls` ↔ `aria-labelledby`, roving tabindex, ←/→/Home/End vòng tròn bỏ qua tab tắt và kích hoạt ngay. Một kiểu duy nhất (gạch chân), không có biến thể pill. Chọn một trong vài **kiểu xem** của cùng nội dung (Sơ đồ/Danh sách) là `SegmentedControl`, không phải tab; chuyển **trang/route** thì dùng liên kết `aria-current`, không dùng `Tabs`.

## Điều hướng mobile (dưới `lg`)

- **Thanh tab đáy** 5 ô: Tổng quan · Dự án · ＋ Tạo · Thông báo · Tôi. Không drawer, không nút hamburger, **không nút nổi (FAB)** — FAB chỉ còn từ `lg` trở lên.
- "＋ Tạo" và "Tôi" mở **sheet đáy** (`Dialog placement="bottom"`): Tạo = các tác vụ tạo giống menu FAB; Tôi = các mục điều hướng còn lại + tài khoản. Chế độ Quản trị: 4 mục + "Tôi".
- Topbar có nút **Tìm** (mở Bảng lệnh). Gợi ý phím (`.kbd-hint`) ẩn trên màn cảm ứng; trang Hướng dẫn và bảng phím tắt vẫn hiện tên phím.
- Thanh hàng loạt và thanh "chưa lưu" (`UnsavedBar`) nằm **ngay trên** thanh tab, không đè lên. Toast nổi trên thanh tab (+ vùng an toàn iOS). Không notch, không gradient, không nảy.

## Absolute Bans (kế thừa impeccable)

Side-stripe border màu · gradient text (`background-clip:text`) · glassmorphism mặc định ·
hero-metric template · lưới card y hệt lặp vô tận · eyebrow chữ hoa nhỏ trên mỗi section ·
numbered markers 01/02/03 làm scaffold · text tràn container ở mobile/tablet · nền cream/beige ·
gradient tím "AI". Body text xám nhạt trên nền tint → luôn kéo về phía `--ink`.

## Accessibility

WCAG 2.1 AA. Contrast đã chọn để body (`--ink`/`--muted`) ≥4.5:1, large ≥3:1 trên bg & surface.
Focus ring `--ring` luôn hiện (`:focus-visible`, offset 2px). Keyboard-first: mọi action có
phím tắt + Cmd+K. Trạng thái = icon + nhãn + màu. Dark & light đều AA.
