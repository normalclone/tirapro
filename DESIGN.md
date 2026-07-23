# Design

> Hệ thống thị giác cho Tirapro. Register: **product** (UI phục vụ tác vụ). Mood:
> *"đài quan sát ban ngày — ánh sáng trong, dữ liệu tĩnh, xanh cobalt điềm tĩnh"*.
> Chiến lược màu: **Restrained** — nền trung tính gần như trắng, một màu brand (cobalt)
> dẫn dắt nhận diện (≤10% bề mặt). Mood nằm ở brand color + typography, KHÔNG ở nền.
> Mọi giá trị dùng **OKLCH**. Token map thẳng sang CSS variables + Tailwind theme.

## Color Strategy

Restrained. Nền light = trắng tinh (`oklch(1 0 0)`); cobalt primary và type gánh "cảm giác".
Nền dark = slate xanh sâu (KHÔNG đen tuyền → tránh dark-terminal). Neutral được tint nhẹ về
hue brand (chroma 0.004–0.008) để cả hệ thống "thuộc về nhau", không phải xám chết.

## Color Tokens — Light (default)

| Role | OKLCH | Dùng cho |
|---|---|---|
| `--bg` | `oklch(1 0 0)` | nền app gốc (trắng tinh) |
| `--surface` | `oklch(0.985 0.004 250)` | panel, card, sidebar |
| `--surface-2` | `oklch(0.968 0.005 250)` | hàng hover, input, vùng chìm |
| `--surface-3` | `oklch(0.945 0.006 250)` | column board, vùng nhấn nhẹ |
| `--border` | `oklch(0.915 0.006 250)` | đường kẻ, viền 1px |
| `--border-strong` | `oklch(0.86 0.008 250)` | viền nhấn, divider rõ |
| `--ink` | `oklch(0.27 0.013 256)` | text chính (body) — ~10:1 trên bg |
| `--ink-strong` | `oklch(0.20 0.014 256)` | heading, số liệu |
| `--muted` | `oklch(0.46 0.012 256)` | text phụ — vẫn ≥4.5:1 trên bg/surface |
| `--faint` | `oklch(0.60 0.010 256)` | icon phụ, placeholder (chỉ non-critical) |
| `--primary` | `oklch(0.52 0.17 252)` | brand cobalt — nút chính, link, focus |
| `--primary-hover` | `oklch(0.46 0.17 252)` | hover nút chính |
| `--primary-fg` | `oklch(0.99 0.005 250)` | text trên nền primary (trắng, ≥4.5:1) |
| `--primary-subtle` | `oklch(0.95 0.03 252)` | nền nhạt cho badge/selected |
| `--ring` | `oklch(0.52 0.17 252 / 0.55)` | focus ring (offset 2px) |

## Color Tokens — Dark

| Role | OKLCH | Ghi chú |
|---|---|---|
| `--bg` | `oklch(0.17 0.013 256)` | slate xanh sâu, KHÔNG đen tuyền |
| `--surface` | `oklch(0.205 0.014 256)` | panel/card |
| `--surface-2` | `oklch(0.235 0.015 256)` | hover, input |
| `--surface-3` | `oklch(0.265 0.015 256)` | column board |
| `--border` | `oklch(0.30 0.012 256)` | viền 1px |
| `--border-strong` | `oklch(0.37 0.012 256)` | divider rõ |
| `--ink` | `oklch(0.92 0.006 256)` | text chính |
| `--ink-strong` | `oklch(0.98 0.004 256)` | heading |
| `--muted` | `oklch(0.70 0.012 256)` | text phụ — ≥4.5:1 trên bg |
| `--faint` | `oklch(0.56 0.012 256)` | icon phụ |
| `--primary` | `oklch(0.66 0.15 252)` | cobalt sáng hơn cho nền tối |
| `--primary-hover` | `oklch(0.72 0.15 252)` |  |
| `--primary-fg` | `oklch(0.16 0.02 256)` | text tối trên primary sáng |
| `--primary-subtle` | `oklch(0.30 0.05 252)` | nền badge selected |
| `--ring` | `oklch(0.66 0.15 252 / 0.6)` |  |

## Semantic & Status Colors

Trạng thái LUÔN kèm icon + nhãn (màu không phải tín hiệu duy nhất — WCAG AA).
Status category (Jira): TODO / IN_PROGRESS / DONE.

| Token | Light | Dark | Dùng |
|---|---|---|---|
| `--status-todo` | `oklch(0.60 0.018 256)` | `oklch(0.68 0.02 256)` | cột/badge To Do (slate trung tính) |
| `--status-progress` | `oklch(0.55 0.13 245)` | `oklch(0.68 0.13 245)` | In Progress (xanh hoạt động) |
| `--status-done` | `oklch(0.58 0.13 150)` | `oklch(0.70 0.14 150)` | Done (xanh lá) |
| `--success` | `oklch(0.58 0.14 150)` | `oklch(0.70 0.14 150)` | thành công |
| `--warning` | `oklch(0.72 0.15 75)` | `oklch(0.80 0.15 75)` | cảnh báo (amber) |
| `--danger` | `oklch(0.55 0.20 25)` | `oklch(0.66 0.19 25)` | lỗi/xóa (đỏ) |
| `--info` | `var(--primary)` | `var(--primary)` | thông tin |

Priority ramp (highest→lowest): `danger` → `oklch(0.65 0.17 45)` (cam) → `warning` →
`status-progress` → `faint`. Hiển thị kèm icon mũi tên, không chỉ màu.

## Typography

- **UI / body**: **Geist Sans** (self-host qua `@fontsource-variable/geist`). KHÔNG dùng
  Inter / Arial / system default (anti AI-slop). Một family, nhiều weight để tạo hierarchy.
- **Mono**: **Geist Mono** — issue key (`PROJ-123`), số story point, code block, JQL.
- Pairing trên trục cùng-họ (sans + mono cùng designer) → an toàn, không "hai sans na ná".

Type scale (rem, 1rem=16px) — line-height đặc cho mật độ cao:

| Token | Size / LH | Weight | Dùng |
|---|---|---|---|
| `display` | 2.0 / 1.15 | 700 | tiêu đề trang lớn (hiếm) |
| `h1` | 1.5 / 1.2 | 650 | tiêu đề màn |
| `h2` | 1.25 / 1.25 | 620 | section |
| `h3` | 1.075 / 1.3 | 600 | tiêu đề card/issue |
| `body` | 0.875 / 1.5 | 400 | text mặc định (14px — chuẩn product dày) |
| `body-sm` | 0.8125 / 1.45 | 400 | meta, phụ |
| `caption` | 0.75 / 1.4 | 500 | nhãn, badge |
| `mono` | 0.8125 / 1.4 | 500 | key/số |

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
- Mobile: sidebar → drawer; board column → vuốt ngang; touch target ≥ 44px.

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

## Components (conventions)

shadcn/ui (Radix primitives) + Tailwind, restyle theo token trên. Primitives P0:
Button (primary/secondary/ghost/danger), Input, Textarea, Select, Combobox, Dialog (dùng
`<dialog>`/portal — tránh bị clip trong overflow), Dropdown, Tooltip, Popover, Avatar,
Badge/Tag, Tabs, Checkbox, Switch, Toast (sonner-style), Skeleton, Command palette (cmdk).

Đặc tả chủ đạo:
- **Issue card** (board): key mono + type icon + summary (2 dòng max) + avatar assignee +
  priority icon + story points (tabular). Không viền nặng; nền `--surface`, hover `--surface-2`,
  shadow-sm khi kéo. Selected: ring `--primary`.
- **Board column**: nền `--surface-3`, header dính (count + WIP), cuộn dọc độc lập.
- **Issue detail**: hai cột (nội dung + sidebar field), KHÔNG card lồng; divider mảnh.
- **Status badge**: chấm màu category + nhãn; pill bo `full`, nền `*-subtle`.
- **Empty/loading/error states**: bắt buộc cho mọi list (onboard/harden sau).

## Absolute Bans (kế thừa impeccable)

Side-stripe border màu · gradient text (`background-clip:text`) · glassmorphism mặc định ·
hero-metric template · lưới card y hệt lặp vô tận · eyebrow chữ hoa nhỏ trên mỗi section ·
numbered markers 01/02/03 làm scaffold · text tràn container ở mobile/tablet · nền cream/beige ·
gradient tím "AI". Body text xám nhạt trên nền tint → luôn kéo về phía `--ink`.

## Accessibility

WCAG 2.1 AA. Contrast đã chọn để body (`--ink`/`--muted`) ≥4.5:1, large ≥3:1 trên bg & surface.
Focus ring `--ring` luôn hiện (`:focus-visible`, offset 2px). Keyboard-first: mọi action có
phím tắt + Cmd+K. Trạng thái = icon + nhãn + màu. Dark & light đều AA.
