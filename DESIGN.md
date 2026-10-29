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

| Token               | Light                   | Dark                   | Dùng                                                                                              |
| ------------------- | ----------------------- | ---------------------- | ------------------------------------------------------------------------------------------------- |
| `--status-todo`     | `oklch(0.60 0.018 256)` | `oklch(0.68 0.02 256)` | cột/badge To Do (slate trung tính)                                                                |
| `--status-progress` | `oklch(0.55 0.13 245)`  | `oklch(0.68 0.13 245)` | In Progress (xanh hoạt động)                                                                      |
| `--status-done`     | `oklch(0.58 0.13 150)`  | `oklch(0.70 0.14 150)` | Done (xanh lá)                                                                                    |
| `--success`         | `oklch(0.58 0.14 150)`  | `oklch(0.70 0.14 150)` | thành công                                                                                        |
| `--warning`         | `oklch(0.72 0.15 75)`   | `oklch(0.80 0.15 75)`  | cảnh báo (amber)                                                                                  |
| `--warning-fill`    | `oklch(0.55 0.11 75)`   | `oklch(0.80 0.15 75)`  | THANH/mảng cảnh báo (≥ 3:1 trên nền và rãnh; `--warning` sáng chỉ 2.4:1 nên không dùng làm thanh) |
| `--warning-ink`     | `oklch(0.48 0.12 75)`   | `oklch(0.85 0.12 80)`  | CHỮ cảnh báo (AA, ≥ 6:1 trên nền)                                                                 |
| `--danger`          | `oklch(0.55 0.20 25)`   | `oklch(0.66 0.19 25)`  | lỗi/xóa (đỏ)                                                                                      |
| `--info`            | `var(--primary)`        | `var(--primary)`       | thông tin                                                                                         |

Khi in ấn, `--warning-fill` dùng giá trị của chế độ sáng (`oklch(0.55 0.11 75)`) dù màn hình đang ở chế độ tối.

Priority ramp (highest→lowest): `danger` → `oklch(0.65 0.17 45)` (cam) → `warning` →
`status-progress` → `faint`. Hiển thị kèm icon mũi tên, không chỉ màu.

**Ưu tiên = `PriorityIcon`**, không bao giờ chỉ là chấm màu: mũi tên chọn theo **vị trí hạng** trong cấu hình ưu tiên (⇈ cao nhất · ↑ cao · = trung bình · ↓ thấp · ⇊ thấp nhất; cấu hình 2–3 mức thì chỉ dùng ↓ / ↑ hoặc ↓ = ↑), màu lấy từ ramp trên / cấu hình, kèm `aria-label` + tooltip "Ưu tiên: <tên>". Dùng ở thẻ board, dòng Việc chờ, Tổng quan, Việc mới vào, SLA, Cây việc.

## Màu nhãn (`--label-1..8`)

Một bảng 8 màu cho nhãn, nhóm, chương trình, cột mốc và vai trò (`lib/labelPalette.ts` + `components/ui/ColorPicker`). **Lưu** hex sRGB của biến thể sáng (API chỉ nhận hex — không migration; vai trò lưu chuỗi OKLCH của biến thể sáng như trước). **Hiển thị** luôn qua token, không dùng hex: `--label-N` (chữ/chấm) và `--label-N-bg` (nền chip) có biến thể sáng/tối. Nền chip: sáng `oklch(0.95 c H)`, tối `oklch(0.30 c H)` (c = 0.03/0.05, Xám 0.01/0.015). Chữ trên nền chip ≥ 4.5:1 và chấm/swatch ≥ 3:1 trên nền trang ở cả hai giao diện — `labelPalette.test.ts` tính tương phản từ chính các giá trị OKLCH và đối chiếu với `styles/globals.css`.

| `--label-N` | Tên        | Hex lưu   | Sáng (chữ/chấm)         | Tối (chữ/chấm)         |
| ----------- | ---------- | --------- | ----------------------- | ---------------------- |
| 1           | Xanh dương | `#3263c3` | `oklch(0.52 0.16 262)`  | `oklch(0.72 0.13 262)` |
| 2           | Xanh lơ    | `#087479` | `oklch(0.51 0.085 200)` | `oklch(0.76 0.1 200)`  |
| 3           | Xanh lá    | `#017b37` | `oklch(0.51 0.14 150)`  | `oklch(0.74 0.14 150)` |
| 4           | Vàng       | `#846305` | `oklch(0.52 0.105 85)`  | `oklch(0.82 0.13 85)`  |
| 5           | Cam        | `#a94e00` | `oklch(0.53 0.14 50)`   | `oklch(0.76 0.14 50)`  |
| 6           | Đỏ         | `#c52b30` | `oklch(0.54 0.19 25)`   | `oklch(0.72 0.17 25)`  |
| 7           | Tím        | `#794db6` | `oklch(0.52 0.16 300)`  | `oklch(0.74 0.13 300)` |
| 8           | Xám        | `#626a75` | `oklch(0.52 0.02 256)`  | `oklch(0.74 0.02 256)` |

Màu cũ không thuộc bảng (nhãn tạo bằng ô màu native, nhóm/chương trình cũ…) hiển thị bằng tông GẦN NHẤT (`labelTone`, so theo sắc độ trong OKLab); không bao giờ chữ khó đọc, dữ liệu đã lưu không bị sửa. Trong `ColorPicker` màu cũ hiện thêm một swatch "Màu hiện tại" đang chọn. Swatch: tên truy cập là tên màu tiếng Việt, đang chọn = viền + dấu tick, 44px trên cảm ứng.

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
  `sticky=1100, backdrop=1200, modal=1300, dropdown=1350 (menu/popover mở từ TRONG modal, phải nằm trên), toast=1400, tooltip=1500`.

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

## Primitive biểu mẫu, dữ liệu và cộng tác (đợt 2 · phần C)

Dùng lại, không tự dựng bản thứ hai. Cùng một hợp đồng trợ năng cho mọi điều khiển mới: **tên truy cập = chữ nhìn thấy của nhãn** (`aria-labelledby` trỏ span nhãn); gợi ý, mô tả và phím tắt đi qua `aria-describedby` / `aria-keyshortcuts`, không nằm trong tên; trạng thái không chỉ bằng màu; vùng chạm 44px khi `pointer: coarse`; `motion-reduce`. Đường dẫn dưới đây tính từ `apps/web/src`.

### Biểu mẫu và nhập liệu

| Primitive                                         | Dùng khi                                                                                                                                                 | Hợp đồng trợ năng                                                                                                                                                                                                                                                                                                                                              | Tệp                                                                                                             |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `FormField` + `ErrorSummary` + `useErrorFlow`     | Biểu mẫu có thể sai nhiều trường. Hàm thuần `validateX` trả MỌI lỗi theo thứ tự trên màn kèm id trường; submit lỗi gọi `flow.fail()`.                    | `ErrorSummary` "N trường cần sửa": mỗi lỗi là nút đưa focus tới trường (không đổi hash); `attempt={flow.attempts}` bắt buộc — mỗi lần gửi lỗi dựng một `role="alert"` ẩn mới nên đọc lại kể cả khi focus không đổi, phần đếm hiển thị là `aria-live="polite"`. Ô nhập nhận `invalid` (boolean hoặc chuỗi) → `aria-invalid` + `aria-describedby` = gợi ý + lỗi. | `components/ui/ErrorSummary.tsx`, `FormField.tsx`, `FieldError.tsx`, `lib/useErrorFlow.ts`, `lib/formErrors.ts` |
| `RequireText` (qua `useConfirm({ requireText })`) | Hành động không đảo được: CHỈ thu hồi API key, xoá quy trình, xoá trường thông tin thêm, xoá vai trò. Xoá khác dùng xác nhận thường + một dòng hậu quả.  | Ô "Gõ **X** để xác nhận" có nhãn `htmlFor`; nút xác nhận tắt tới khi khớp (trim + gộp khoảng trắng + NFC, phân biệt hoa/thường); Enter không xác nhận khi đang gõ bộ gõ (Telex/VNI, Safari `keyCode` 229); Ctrl/⌘+Enter chỉ xác nhận khi khớp.                                                                                                                 | `components/ui/RequireText.tsx`, `lib/confirmText.ts`                                                           |
| `RadioCard`                                       | Chọn một trong vài lựa chọn **có mô tả** (mẫu dự án, cách giải quyết, phạm vi). Lựa chọn ngắn ≤ 4 mục vẫn là `SegmentedControl`.                         | `radiogroup` gồm `button role="radio"`, một điểm dừng Tab (roving), mũi tên/Home/End bỏ qua mục tắt. Tên = span nhãn, mô tả qua `aria-describedby`, `meta` ngoài cả hai; `children` chỉ hiện ở thẻ đang chọn và nằm NGOÀI nút radio. Chọn = chấm đặc + viền + nền, không chỉ màu. Trong biểu mẫu, Enter chọn thẻ chứ không gửi form.                           | `components/ui/RadioCard.tsx`                                                                                   |
| `Switch`                                          | Bật/tắt có hiệu lực ngay (không có nút Lưu). Chọn trong biểu mẫu rồi mới Lưu vẫn là `Checkbox`.                                                          | `button role="switch"` + `aria-checked`; tên = span nhãn, mô tả `aria-describedby`; núm trượt + dấu tích (không chỉ màu); Space/Enter của `<button>`; khoá vẫn thấy rõ bật hay tắt.                                                                                                                                                                            | `components/ui/Switch.tsx`                                                                                      |
| `SaveStatus`                                      | Đi kèm lưu-ngay: "Đang lưu…" · "Đã lưu lúc HH:mm" · "Lỗi · Thử lại". Lưu chồng nhau: mutation `scope` (lần cuối thắng), hoàn tác về giá trị ĐÃ XÁC NHẬN. | `role="status" aria-live="polite"` luôn có trong DOM (rỗng khi nhàn rỗi); "Thử lại" là nút thật; lỗi dùng `text-danger` + chữ.                                                                                                                                                                                                                                 | `components/ui/SaveStatus.tsx`, `lib/saveStatus.ts`, `lib/useSaveTracker.ts`                                    |
| `SplitButton`                                     | Hành động chính có biến thể (Tạo ▸ Tạo & nhập tiếp). Chỉ MỘT primary; không "nhớ hành động cuối" (nút chính không đổi dưới tay người dùng).              | Nút chính + nút ▾ (`aria-label`, `aria-haspopup`) chung `loading`/`disabled`; tên mục menu = nhãn, gợi ý describedby, `aria-keyshortcuts` + `<kbd class="kbd-hint">`; hành động chạy SAU khi menu đóng (không cướp focus của ô lỗi), focus dự phòng về ▾. "Tạo" = Ctrl/⌘+Enter; Ctrl/⌘+Shift+Enter = "Tạo & nhập tiếp" (`onSubmitAlt`).                        | `components/ui/SplitButton.tsx`, `lib/submitShortcut.ts`                                                        |
| `InlineText`                                      | Sửa tiêu đề/tên tại chỗ (chi tiết và xem nhanh công việc).                                                                                               | Chế độ xem là `<button>` nằm trong đúng MỘT thẻ tiêu đề (`as` h1/h2); chế độ sửa: ô có nhãn + ✓ Lưu / ✕ Huỷ + `SaveStatus`. Enter lưu (chống bộ gõ), Shift+Enter không làm gì, Esc huỷ và `preventDefault`. Khối mang `data-inline-edit` nên `isTypingTarget` → phím tắt toàn cục tắt. Gắn `key` theo id thực thể.                                             | `components/ui/InlineText.tsx`, `useInlineEdit.ts`, `lib/inlineEdit.ts`                                         |
| `DateRangeInput`                                  | Hai ngày bắt đầu–kết thúc (sprint, hợp đồng, chương trình, nghỉ phép, phân bổ).                                                                          | Hai `DateInput` trong `FormField`, `role="group"`; dòng tóm tắt `<p role="status">` luôn có chỗ ("14 ngày · 20/10 – 02/11"); lỗi khoảng gắn vào ô KẾT THÚC; `onErrorChange` → host tắt Lưu. Đếm ngày **gồm cả hai đầu**; "n tuần" = bắt đầu + 7n − 1.                                                                                                          | `components/ui/DateRangeInput.tsx`, `lib/dateRange.ts`                                                          |
| `ColorPicker` / `LABEL_PALETTE` / `--label-N`     | Chọn màu nhãn, nhóm, chương trình, cột mốc, vai trò. Chi tiết bảng màu: mục "Màu nhãn".                                                                  | `radiogroup`, một điểm dừng Tab; tên = tên màu tiếng Việt (không hex); đang chọn = viền + dấu tick; màu cũ ngoài bảng có thêm swatch "Màu hiện tại".                                                                                                                                                                                                           | `components/ui/ColorPicker.tsx`, `lib/labelPalette.ts`                                                          |

### Dữ liệu và số liệu

| Primitive               | Dùng khi                                                                                                                                                                                                                                | Hợp đồng trợ năng                                                                                                                                                                                                                       | Tệp                                                       |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `LimitMeter`            | Dùng so với một **giới hạn** (WIP của cột, sức chứa sprint so với velocity, ngân sách năng lực). `tone="strict"` (đầy/vượt = đỏ) hoặc `"advisory"` (cảnh báo).                                                                          | `role="meter"`, `aria-valuenow` kẹp vào [0, max], `aria-valuetext` là câu đủ nghĩa. Mức: dưới 80% ổn · 80–99% gần đầy · 100% "Đầy" · trên 100% "Vượt N". Chữ luôn hiện, không chỉ màu.                                                  | `components/ui/LimitMeter.tsx`, `limitLevel.ts`           |
| `BulletBar` / `StatRow` | Thay mọi ô số to. `BulletBar` = thanh + vạch đích 2px + dòng "so với … ±n"; `StatRow` = hàng ô thống kê (`bare` bỏ viền/đệm khi nằm trong widget). Số cỡ `text-lg`, không `text-2xl`/hero. Vạch kỳ vọng OKR chỉ cho mục tiêu đang chạy. | `BulletBar` là `role="meter"` kẹp giá trị, `aria-valuetext` gồm giá trị + đích + chênh lệch. Thanh cảnh báo tô `--warning-fill`, chữ cảnh báo `text-warning-ink`; không bao giờ dùng `--warning` sáng (2,4:1). "0 quá hạn" không tô đỏ. | `components/ui/BulletBar.tsx`, `StatRow.tsx`, `bullet.ts` |

### Danh sách và thao tác trên công việc

| Primitive                             | Dùng khi                                                                                                                                                                                                                                                                    | Hợp đồng trợ năng                                                                                                                                                                                                                                                                                                                                            | Tệp                                                                                                         |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `BulkDock` + `useBulkSelection`       | Chọn nhiều công việc rồi sửa một lần (Bảng việc, Việc chờ, Bộ lọc). Dock là con flex ngay trên thanh tab đáy (không `fixed`, không blur); dưới 640px một hàng + "…" mở sheet. Bộ lọc nhóm theo dự án, hành động xuyên dự án bị giới hạn. Hoàn tác chỉ cho phần đã cập nhật. | Ô chọn "Chọn {MÃ}": hiện khi rê/focus, luôn hiện khi đang chọn và trên cảm ứng (44px). Shift = chọn dải theo thứ tự hiển thị; Cmd/Ctrl-click chọn trên **thẻ Bảng việc** (dòng Việc chờ/Bộ lọc/Cây giữ "mở tab mới"). Phím dòng dùng `stopRowKeys` (chỉ Enter/Space/mũi tên — không nuốt phím tắt toàn cục). Esc bỏ chọn trừ khi đang gõ hoặc có lớp phủ mở. | `features/bulk/BulkDock.tsx`, `useBulkSelection.ts`, `selection.ts`, `SelectCheckbox.tsx`, `lib/rowKeys.ts` |
| `IssueContextMenu` / `IssueMenuItems` | Menu thao tác một công việc (Bảng việc, Việc chờ, Bộ lọc, Cây việc). MỘT nguồn nội dung (`issueMenuModel` thuần theo bề mặt + quyền) cho chuột phải và nút "…" — không viết menu thứ hai.                                                                                   | Chuột phải/phím Menu/Shift+F10 mở `ContextMenu`; nút "…" tên "Thao tác cho {KEY}" mở `DropdownMenu`. Tắt chuột phải trên cảm ứng (nhấn giữ thuộc về kéo-thả). Hành động chạy ở `IssueActionHost` nên menu đóng ngay khi chọn; huỷ xoá trả focus về dòng. Phụ thuộc `@radix-ui/react-context-menu` ghim đúng 2.3.1.                                           | `features/issues/menu/IssueContextMenu.tsx`, `IssueMenuItems.tsx`, `IssueActionHost.tsx`                    |
| Xem nhanh: ‹ › và sheet đáy           | ‹ › "n/N" trong panel xem nhanh; dưới `md` panel là sheet đáy (xem "Điều hướng mobile"). Thứ tự lấy từ `PeekOrderContext` (Việc chờ, Bộ lọc, Cây việc) hoặc thứ tự DOM (Bảng việc, Việc mới vào).                                                                           | "Việc trước/Việc sau" dùng `aria-disabled` (focus không rơi ở hai đầu) + `aria-keyshortcuts`; "n/N" ẩn khỏi trình đọc, thay bằng `sr-only` "Việc n trên N" trong `role="status"` ("ít nhất N" khi còn trang). Dòng đang xem: `aria-current` + `PEEKED_ROW_CLS`. Sheet là modal: Esc/Back/X đóng, focus về dòng đã mở.                                        | `features/issues/peek/PeekNavControls.tsx`, `PeekSheet.tsx`, `PeekOrderContext.ts`                          |

### Trạng thái và cộng tác

| Primitive          | Dùng khi                                                                                                                                                                                                                 | Hợp đồng trợ năng                                                                                                                                                                                                                                                                                              | Tệp                                                                                             |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `ConnectionBanner` | Báo mất kết nối thời gian thực (cạnh `MaintenanceBanner`, nằm trong luồng, không che nội dung). Hiện sau 3 giây mất; "Đã kết nối lại" chỉ khi đường truyền ổn định ≥ 3 giây; nối lại: làm mới token trước, tối đa 5 lần. | Vùng `role="status" aria-live="polite"` `sr-only` luôn có, chỉ chứa câu chính (số "đang chờ gửi" nằm ngoài vùng live); câu chữ trung thực: "thay đổi vẫn được lưu" chỉ khi còn mạng, hết lượt thử thì "tải lại trang" + nút "Tải lại".                                                                         | `components/layout/ConnectionBanner.tsx`, `lib/connectionState.ts`                              |
| Hộp chia sẻ        | Chia sẻ bảng tổng quan và bộ lọc: `SharePanel` = chọn phạm vi + "Ai có quyền xem" + sao chép liên kết nội bộ. Không có liên kết công khai ẩn danh.                                                                       | Dòng "Ai có quyền xem" tính từ CÙNG hàm hiển thị với máy chủ (gồm Quản trị chung xem được, dự án công khai/riêng tư) — copy sai quyền là lỗi. Mức dự án bắt buộc chọn dự án. Nút sao chép chỉ khi đã lưu. Thuật ngữ: "Cả không gian làm việc", "Quản trị chung" (mục 19 của UX_CONVENTIONS).                   | `features/sharing/SharePanel.tsx`, `AudiencePanel.tsx`, `SharePicker.tsx`, `CopyLinkRow.tsx`    |
| Cảm xúc bình luận  | Thả cảm xúc: bộ cố định 👍 ❤️ 🎉 😄 🙏 👀 (không 👎), không thông báo. API `PUT`/`DELETE` đặt trạng thái tường minh nên bấm đúp không đảo kết quả.                                                                       | Chip là `button aria-pressed`, tên bắt đầu bằng chữ nhìn thấy ("👍 3 — Đồng ý: bạn và 2 người khác"), danh sách người ở describedby/`title`; chip của mình đậm + nền (không chỉ màu). Bộ chọn là `role="group"` các nút bật/tắt, roving tabindex kẹp khi vẽ. Dự án lưu trữ: chỉ đọc (`role="img"`, không nút). | `features/issue-edit/CommentReactionStrip.tsx`, `commentReactions.ts`, `commentReactionSave.ts` |

## Điều hướng mobile (dưới `lg`)

- **Thanh tab đáy** 5 ô: Tổng quan · Dự án · ＋ Tạo · Thông báo · Tôi. Không drawer, không nút hamburger, **không nút nổi (FAB)** — FAB chỉ còn từ `lg` trở lên.
- "＋ Tạo" và "Tôi" mở **sheet đáy** (`Dialog placement="bottom"`): Tạo = các tác vụ tạo giống menu FAB; Tôi = các mục điều hướng còn lại + tài khoản. Chế độ Quản trị: 4 mục + "Tôi".
- Topbar có nút **Tìm** (mở Bảng lệnh). Gợi ý phím (`.kbd-hint`) ẩn trên màn cảm ứng; trang Hướng dẫn và bảng phím tắt vẫn hiện tên phím.
- **Xem nhanh việc** (`?peek=KEY`): dưới `md` (768px) là **sheet đáy modal** 2 nấc — nửa màn (`50dvh`) ↔ gần toàn màn — đổi bằng nút tay nắm (44px, `aria-expanded`), chuyển chiều cao `ease-out-expo` không nảy; chỉ tay nắm + đầu sheet cố định, thân cuộn. Back của Android/trình duyệt, Esc và X đều đóng; focus về thẻ/dòng đã mở. Sheet là modal nên phím `j`/`k` tắt (chấp nhận trên điện thoại) và nó phủ cả thanh hàng loạt lẫn thanh tab. Từ `md` giữ panel cột phải **phi-modal** (bấm hết dòng này sang dòng khác, `j`/`k` dùng được).
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
