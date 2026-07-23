# Design System & UX

Tôi đã có đủ thông tin về model IDs (`claude-opus-4-8`, `claude-sonnet-4-6`) cho phần degrade gracefully của AI features. Giờ tôi viết bản đặc tả thiết kế.

# ĐẶC TẢ THIẾT KẾ: Design System & UX — Tirapro

> **Subsystem:** Design System & UX
> **Phiên bản:** 1.0
> **Tech stack:** React 18 + Vite + TypeScript + Tailwind CSS + shadcn/ui + TanStack Query + Zustand + React Router + Socket.io client
> **Phạm vi:** Design tokens (light/dark), thư viện component nền tảng, Command Palette, keyboard shortcuts toàn cục, layout chính, đặc tả các màn hình cốt lõi (Board / Backlog / Issue Detail / Reports), nguyên tắc a11y & responsive.

---

## 1. Tổng quan & Nguyên tắc thiết kế

### 1.1. Triết lý

Tirapro đặt mục tiêu **nhanh hơn Jira, tối giản hơn Jira, keyboard-first**. Mọi quyết định thiết kế bám 4 nguyên tắc:

| Nguyên tắc | Diễn giải | Hệ quả kỹ thuật |
|---|---|---|
| **Speed-first** | Tương tác phải phản hồi tức thì (< 100ms perceived). | Optimistic UI mặc định, skeleton thay spinner, virtualization cho list dài, prefetch trên hover. |
| **Keyboard-first** | Mọi hành động trọng yếu có shortcut; chuột là tùy chọn, không bắt buộc. | Command Palette (Cmd+K), global hotkeys, focus management chuẩn. |
| **Minimal & calm** | Ít chrome, nhiều nội dung; density cao nhưng dễ thở. | Spacing scale chặt, viền mảnh, màu trung tính chủ đạo, accent có chủ đích. |
| **Accessible by default** | WCAG 2.1 AA là baseline, không phải tính năng thêm. | Contrast ≥ 4.5:1, focus ring rõ, ARIA đầy đủ, `prefers-reduced-motion`. |

### 1.2. Stack thư viện UI (đã chốt)

- **Tailwind CSS** làm utility layer; **CSS variables** làm nguồn token duy nhất (theming light/dark).
- **shadcn/ui** (Radix UI primitives + Tailwind) làm nền component — copy-in source, không phải dependency đóng kín → kiểm soát hoàn toàn token & a11y.
- **lucide-react** cho icon (tree-shakeable, đồng bộ stroke 1.5–2px).
- **cmdk** cho Command Palette (đi cùng shadcn).
- **@tanstack/react-virtual** cho danh sách dài (backlog, board lớn).
- **@dnd-kit/core** + `@dnd-kit/sortable` cho drag-drop (board/backlog) — pointer + keyboard sensor, a11y tốt hơn react-beautiful-dnd.
- **sonner** cho toast.
- **next-themes** (dùng được với Vite/React) hoặc store Zustand tự quản cho theme switching.

### 1.3. Điểm giao tiếp với subsystem khác

| Giao diện | Subsystem đối tác | Hợp đồng |
|---|---|---|
| `useAuth()` / `<AuthGate>` | Auth (JWT) | Cung cấp `currentUser`, `roles`, `permissions[]`. UI ẩn/hiện action theo `hasPermission()`. |
| `usePresence()` / realtime store | Realtime (Socket.io) | Cung cấp presence avatars, optimistic patch events cho board/issue. |
| `useAI()` hooks | AI (Claude API) | Trả `available: boolean` để degrade gracefully (xem §13). |
| Data hooks (`useIssues`, `useSprint`...) | Backend/API (NestJS) | Component nhận data qua TanStack Query; design system không gọi API trực tiếp. |
| JQL input/parser | Search (JQL) | Component `<JqlSearchBar>` chỉ render & emit chuỗi; parsing thuộc subsystem Search. |

Design system **không** sở hữu data fetching. Nó cung cấp **presentational + interaction primitives**; subsystem khác bơm data vào.

---

## 2. Design Tokens

### 2.1. Mô hình token 2 tầng

```
Tier 1 — Primitive tokens (giá trị thô, không dùng trực tiếp trong component)
   --blue-500: 217 91% 60%;   (HSL channels, không có hsl())
Tier 2 — Semantic tokens (alias theo ngữ nghĩa, component CHỈ dùng tầng này)
   --color-primary: var(--blue-500);
```

> **Quy ước HSL channels (theo chuẩn shadcn):** biến lưu `H S% L%` (không bọc `hsl()`), Tailwind bọc lại qua `hsl(var(--token) / <alpha-value>)`. Cho phép điều chỉnh opacity bằng utility (`bg-primary/10`) mà vẫn theming được.

### 2.2. Color tokens (semantic)

File `src/styles/tokens.css`:

```css
:root {
  /* ---- Surface & background ---- */
  --background: 0 0% 100%;            /* nền app */
  --foreground: 222 47% 11%;          /* text mặc định */
  --card: 0 0% 100%;
  --card-foreground: 222 47% 11%;
  --popover: 0 0% 100%;
  --popover-foreground: 222 47% 11%;
  --muted: 210 40% 96%;               /* nền phụ, hover row */
  --muted-foreground: 215 16% 47%;    /* text phụ, placeholder */

  /* ---- Brand / interactive ---- */
  --primary: 221 83% 53%;             /* xanh Tirapro */
  --primary-foreground: 0 0% 100%;
  --secondary: 210 40% 96%;
  --secondary-foreground: 222 47% 11%;
  --accent: 210 40% 94%;
  --accent-foreground: 222 47% 11%;

  /* ---- Borders & inputs ---- */
  --border: 214 32% 91%;
  --input: 214 32% 91%;
  --ring: 221 83% 53%;                /* focus ring = primary */

  /* ---- Feedback / status ---- */
  --success: 142 71% 45%;
  --success-foreground: 0 0% 100%;
  --warning: 38 92% 50%;
  --warning-foreground: 26 83% 14%;
  --destructive: 0 72% 51%;
  --destructive-foreground: 0 0% 100%;
  --info: 199 89% 48%;
  --info-foreground: 0 0% 100%;

  /* ---- Radius / elevation ---- */
  --radius: 0.5rem;                   /* base radius, các kích cỡ khác derive */
  --shadow-color: 222 47% 11%;
}

.dark {
  --background: 222 47% 8%;
  --foreground: 210 40% 96%;
  --card: 222 44% 11%;
  --card-foreground: 210 40% 96%;
  --popover: 222 44% 11%;
  --popover-foreground: 210 40% 96%;
  --muted: 217 33% 17%;
  --muted-foreground: 215 20% 65%;

  --primary: 217 91% 60%;             /* sáng hơn để giữ contrast trên nền tối */
  --primary-foreground: 222 47% 11%;
  --secondary: 217 33% 17%;
  --secondary-foreground: 210 40% 96%;
  --accent: 217 33% 20%;
  --accent-foreground: 210 40% 96%;

  --border: 217 33% 20%;
  --input: 217 33% 22%;
  --ring: 217 91% 60%;

  --success: 142 60% 48%;
  --warning: 38 88% 55%;
  --destructive: 0 63% 52%;
  --info: 199 80% 55%;
  --shadow-color: 0 0% 0%;
}
```

#### Issue-type & priority colors (token riêng — dùng cho icon/badge)

```css
:root {
  --type-epic: 271 70% 56%;       /* tím */
  --type-story: 142 71% 45%;      /* xanh lá */
  --type-task: 217 91% 53%;       /* xanh dương */
  --type-bug: 0 72% 51%;          /* đỏ */
  --type-subtask: 199 89% 48%;    /* xanh nhạt */

  --priority-highest: 0 72% 51%;
  --priority-high: 14 90% 53%;
  --priority-medium: 38 92% 50%;
  --priority-low: 142 60% 45%;
  --priority-lowest: 215 16% 55%;
}
```

> **Giao tiếp:** màu type/priority phải khớp enum của backend (`IssueType`, `Priority`). Map ở `src/lib/issue-meta.ts`.

### 2.3. Spacing scale

Dùng nguyên scale Tailwind (4px base) nhưng **giới hạn token được phép dùng** để giữ nhất quán density:

| Token | px | Dùng cho |
|---|---|---|
| `0.5` | 2 | hairline gaps |
| `1` | 4 | icon padding |
| `2` | 8 | inner padding nhỏ, gap chip |
| `3` | 12 | padding control (button md) |
| `4` | 16 | padding card, gap section |
| `6` | 24 | gap giữa block |
| `8` | 32 | section spacing |
| `12` | 48 | page padding lớn |

### 2.4. Typography

```css
:root {
  --font-sans: "Inter", ui-sans-serif, system-ui, -apple-system, sans-serif;
  --font-mono: "JetBrains Mono", ui-monospace, monospace;
}
```

| Token (Tailwind) | size / line-height | Dùng cho |
|---|---|---|
| `text-xs` | 12 / 16 | meta, label phụ, timestamp |
| `text-sm` | 14 / 20 | **body mặc định** (UI dày đặc) |
| `text-base` | 16 / 24 | nội dung dài (issue description) |
| `text-lg` | 18 / 28 | tiêu đề card / dialog |
| `text-xl` | 20 / 28 | tiêu đề màn hình |
| `text-2xl` | 24 / 32 | page heading |

Weight: `400` (regular), `500` (medium — label/button), `600` (semibold — heading).

### 2.5. Radius & elevation

```css
/* tailwind.config: derive từ --radius */
borderRadius: {
  sm: "calc(var(--radius) - 4px)",   /* 4px  — chip, badge */
  md: "calc(var(--radius) - 2px)",   /* 6px  — input, button */
  lg: "var(--radius)",               /* 8px  — card, dialog */
  xl: "calc(var(--radius) + 4px)",   /* 12px — modal lớn */
}
```

Shadow (mảnh, calm):

```css
--shadow-sm: 0 1px 2px 0 hsl(var(--shadow-color) / 0.05);
--shadow-md: 0 2px 8px -2px hsl(var(--shadow-color) / 0.10);
--shadow-lg: 0 8px 24px -4px hsl(var(--shadow-color) / 0.14);
--shadow-popover: 0 4px 16px -2px hsl(var(--shadow-color) / 0.18);
```

### 2.6. Motion tokens

```css
--duration-fast: 120ms;     /* hover, fade nhỏ */
--duration-base: 200ms;     /* dialog, popover */
--duration-slow: 320ms;     /* drawer, page transition */
--ease-standard: cubic-bezier(0.2, 0, 0, 1);
--ease-emphasized: cubic-bezier(0.2, 0, 0, 1.2);
```

> **Bắt buộc:** mọi animation phải tắt khi `@media (prefers-reduced-motion: reduce)` (xem §12).

### 2.7. Z-index scale (tránh chồng layer hỗn loạn)

| Token | value | Layer |
|---|---|---|
| `z-base` | 0 | nội dung |
| `z-sticky` | 10 | topbar, board column header |
| `z-dropdown` | 30 | dropdown, select |
| `z-drawer` | 40 | issue drawer |
| `z-modal` | 50 | dialog overlay |
| `z-popover` | 60 | tooltip, popover trên modal |
| `z-toast` | 70 | toast |
| `z-command` | 80 | command palette (cao nhất) |

---

## 3. Cấu hình Tailwind

`tailwind.config.ts` (rút gọn, phần mapping token quan trọng):

```ts
import type { Config } from "tailwindcss";

export default {
  darkMode: "class", // toggle qua class .dark trên <html>
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    container: { center: true, padding: "1rem", screens: { "2xl": "1400px" } },
    extend: {
      colors: {
        background: "hsl(var(--background) / <alpha-value>)",
        foreground: "hsl(var(--foreground) / <alpha-value>)",
        card: { DEFAULT: "hsl(var(--card) / <alpha-value>)", foreground: "hsl(var(--card-foreground) / <alpha-value>)" },
        popover: { DEFAULT: "hsl(var(--popover) / <alpha-value>)", foreground: "hsl(var(--popover-foreground) / <alpha-value>)" },
        muted: { DEFAULT: "hsl(var(--muted) / <alpha-value>)", foreground: "hsl(var(--muted-foreground) / <alpha-value>)" },
        primary: { DEFAULT: "hsl(var(--primary) / <alpha-value>)", foreground: "hsl(var(--primary-foreground) / <alpha-value>)" },
        secondary: { DEFAULT: "hsl(var(--secondary) / <alpha-value>)", foreground: "hsl(var(--secondary-foreground) / <alpha-value>)" },
        accent: { DEFAULT: "hsl(var(--accent) / <alpha-value>)", foreground: "hsl(var(--accent-foreground) / <alpha-value>)" },
        destructive: { DEFAULT: "hsl(var(--destructive) / <alpha-value>)", foreground: "hsl(var(--destructive-foreground) / <alpha-value>)" },
        success: { DEFAULT: "hsl(var(--success) / <alpha-value>)", foreground: "hsl(var(--success-foreground) / <alpha-value>)" },
        warning: { DEFAULT: "hsl(var(--warning) / <alpha-value>)", foreground: "hsl(var(--warning-foreground) / <alpha-value>)" },
        info: { DEFAULT: "hsl(var(--info) / <alpha-value>)", foreground: "hsl(var(--info-foreground) / <alpha-value>)" },
        border: "hsl(var(--border) / <alpha-value>)",
        input: "hsl(var(--input) / <alpha-value>)",
        ring: "hsl(var(--ring) / <alpha-value>)",
      },
      borderRadius: {
        sm: "calc(var(--radius) - 4px)",
        md: "calc(var(--radius) - 2px)",
        lg: "var(--radius)",
        xl: "calc(var(--radius) + 4px)",
      },
      fontFamily: {
        sans: ["var(--font-sans)"],
        mono: ["var(--font-mono)"],
      },
      boxShadow: {
        sm: "var(--shadow-sm)", md: "var(--shadow-md)",
        lg: "var(--shadow-lg)", popover: "var(--shadow-popover)",
      },
      transitionTimingFunction: {
        standard: "var(--ease-standard)",
        emphasized: "var(--ease-emphasized)",
      },
      zIndex: {
        sticky: "10", dropdown: "30", drawer: "40",
        modal: "50", popover: "60", toast: "70", command: "80",
      },
      keyframes: {
        "fade-in": { from: { opacity: "0" }, to: { opacity: "1" } },
        "slide-up": { from: { transform: "translateY(8px)", opacity: "0" }, to: { transform: "translateY(0)", opacity: "1" } },
        "scale-in": { from: { transform: "scale(0.96)", opacity: "0" }, to: { transform: "scale(1)", opacity: "1" } },
      },
      animation: {
        "fade-in": "fade-in var(--duration-base) var(--ease-standard)",
        "slide-up": "slide-up var(--duration-base) var(--ease-standard)",
        "scale-in": "scale-in var(--duration-fast) var(--ease-standard)",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
} satisfies Config;
```

---

## 4. Theme switching (light / dark / system)

### 4.1. Store

```ts
// src/stores/theme-store.ts
import { create } from "zustand";
import { persist } from "zustand/middleware";

type ThemeMode = "light" | "dark" | "system";

interface ThemeState {
  mode: ThemeMode;
  resolved: "light" | "dark";        // mode sau khi resolve system
  setMode: (m: ThemeMode) => void;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      mode: "system",
      resolved: "light",
      setMode: (mode) => set({ mode }),
    }),
    { name: "tirapro-theme" },
  ),
);
```

### 4.2. Áp dụng (anti-FOUC)

- Inject script đồng bộ trong `index.html` `<head>` để set `class="dark"` **trước khi React mount** (tránh nháy theme).

```html
<!-- index.html, trong <head>, trước bundle -->
<script>
  (function () {
    var t = localStorage.getItem("tirapro-theme");
    var mode = t ? JSON.parse(t).state.mode : "system";
    var sys = matchMedia("(prefers-color-scheme: dark)").matches;
    var dark = mode === "dark" || (mode === "system" && sys);
    document.documentElement.classList.toggle("dark", dark);
  })();
</script>
```

- `<ThemeProvider>` (React) lắng nghe `matchMedia` để cập nhật khi mode = system, và sync `resolved` về store.

### 4.3. UI

`<ThemeToggle>` ở topbar: dropdown 3 lựa chọn (Light / Dark / System) với icon `Sun` / `Moon` / `Monitor`. Cũng có command palette action (xem §7).

---

## 5. Cấu trúc thư mục component

```
src/
  components/
    ui/                    # shadcn primitives (đã customize token)
      button.tsx
      input.tsx
      select.tsx
      dialog.tsx
      dropdown-menu.tsx
      tooltip.tsx
      avatar.tsx
      badge.tsx
      tabs.tsx
      toast.tsx (sonner wrapper)
      skeleton.tsx
      ...
    composite/             # component ghép, đặc thù domain
      IssueCard.tsx
      IssueTypeIcon.tsx
      PriorityIcon.tsx
      UserAvatarGroup.tsx
      StatusBadge.tsx
      PresenceBar.tsx
      EmptyState.tsx
    layout/
      AppShell.tsx
      Sidebar.tsx
      Topbar.tsx
      Breadcrumb.tsx
    command/
      CommandPalette.tsx
      command-actions.ts
  hooks/
    use-keyboard-shortcut.ts
    use-hotkeys.ts
    use-media-query.ts
  lib/
    cn.ts                  # clsx + tailwind-merge
    issue-meta.ts          # map type/priority → màu, icon, label
  styles/
    tokens.css
    globals.css
```

`cn.ts`:

```ts
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));
```

---

## 6. Thư viện Component nền tảng

Tất cả component xây trên Radix primitives (qua shadcn). Bảng dưới đặc tả **props chính, variants, trạng thái, a11y**. Mọi component **dùng `forwardRef`** và spread `...props` để compose tốt.

### 6.1. Button

```ts
// variants qua cva (class-variance-authority)
type ButtonVariant = "default" | "secondary" | "outline" | "ghost" | "destructive" | "link";
type ButtonSize = "sm" | "md" | "lg" | "icon";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;  // default: "default"
  size?: ButtonSize;        // default: "md"
  loading?: boolean;        // hiện spinner, disable, giữ width
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  asChild?: boolean;        // Radix Slot — render as <a>, <Link>...
}
```

| Đặc tính | Quy định |
|---|---|
| Sizes | sm: h-8 px-3 text-xs · md: h-9 px-4 text-sm · lg: h-10 px-5 · icon: h-9 w-9 |
| Focus | `focus-visible:ring-2 ring-ring ring-offset-2 ring-offset-background` |
| Loading | spinner `Loader2 animate-spin`, label vẫn render nhưng `aria-busy`, `disabled` |
| Disabled | `opacity-50 pointer-events-none` |
| a11y | nếu chỉ icon → bắt buộc `aria-label` |

### 6.2. Input / Textarea

```ts
interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;        // border destructive + aria-invalid
  leftIcon?: React.ReactNode;
  rightSlot?: React.ReactNode;  // ví dụ clear button
}
```

- States: default / focus (`ring-ring`) / invalid (`ring-destructive`, `aria-invalid="true"`) / disabled.
- Luôn dùng kèm `<Label htmlFor>` + `aria-describedby` cho error/helper text.
- Height đồng bộ button md (h-9) để align trong form/filter bar.

### 6.3. Select (Radix Select)

- Trigger giống Input. Popover dùng `--shadow-popover`, `animate-scale-in`.
- Hỗ trợ `searchable` (kết hợp `Command` bên trong cho danh sách dài như assignee picker).
- Keyboard: type-ahead, arrow nav, Enter chọn, Esc đóng (Radix lo sẵn).

### 6.4. Dialog / Modal

```ts
interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  size?: "sm" | "md" | "lg" | "xl" | "full";
}
```

| Quy định | Chi tiết |
|---|---|
| Overlay | `bg-background/80 backdrop-blur-sm`, `z-modal` |
| Content | center, `animate-scale-in`, `--shadow-lg`, max-w theo size |
| Focus trap | Radix tự động; focus về trigger khi đóng |
| Esc / click overlay | đóng (trừ `dismissible={false}` cho confirm nguy hiểm) |
| Structure | `<DialogHeader>` (title bắt buộc cho `aria-labelledby`), `<DialogBody>` scrollable, `<DialogFooter>` action phải |
| Mobile | size `full` → fullscreen sheet trên < 640px |

### 6.5. Dropdown Menu (Radix DropdownMenu)

- Dùng cho context menu issue (`...`), user menu, board column menu.
- Hỗ trợ item thường, checkbox item, radio group, separator, shortcut hint (`<DropdownMenuShortcut>⌘K</DropdownMenuShortcut>`).
- Item destructive: `text-destructive`.

### 6.6. Tooltip (Radix Tooltip)

- delay mặc định 300ms; `--duration-fast`.
- Chỉ cho thông tin bổ trợ — **không** đặt action duy nhất trong tooltip (a11y).
- Bọc app trong `<TooltipProvider delayDuration={300}>`.

### 6.7. Avatar

```ts
interface AvatarProps {
  src?: string;
  name: string;             // dùng để fallback initials + alt
  size?: "xs" | "sm" | "md" | "lg";  // 20 / 24 / 32 / 40 px
  status?: "online" | "away" | "offline"; // chấm presence (xem Realtime)
}
```

- Fallback: initials trên nền màu derive từ hash(name) → màu nhất quán per-user.
- `<UserAvatarGroup max={3}>` → stack + "+N" overflow.

### 6.8. Badge / Chip

```ts
type BadgeVariant = "default" | "secondary" | "outline" | "success" | "warning" | "destructive" | "info";
```

- Dùng cho label, status, count. `StatusBadge` (composite) lấy màu từ workflow status config (Workflows subsystem).

### 6.9. Tabs (Radix Tabs)

- Dùng cho Issue Detail (Comments / History / Worklog), Reports switcher.
- Keyboard arrow nav, `aria-selected`, underline indicator animate.

### 6.10. Toast (sonner)

```ts
// src/lib/toast.ts
import { toast } from "sonner";
export const notify = {
  success: (msg: string, desc?: string) => toast.success(msg, { description: desc }),
  error: (msg: string, desc?: string) => toast.error(msg, { description: desc }),
  info: (msg: string) => toast(msg),
  promise: toast.promise,  // dùng cho optimistic action: loading→success/error
};
```

- Vị trí: bottom-right (desktop), top-center (mobile). `z-toast`.
- Dùng cho: kết quả async action (tạo issue, move sprint), realtime notice ("X vừa cập nhật issue này").

### 6.11. Skeleton

- `<Skeleton className="h-4 w-32" />` — `animate-pulse bg-muted`.
- **Quy tắc:** mọi data list/detail có loading state phải dùng skeleton khớp layout thật (board cards, backlog rows, issue detail), **không dùng spinner toàn trang**. Tắt pulse khi reduced-motion.

### 6.12. Bảng tổng hợp component & ưu tiên build

| Component | Radix base | Ưu tiên | Ghi chú |
|---|---|---|---|
| Button | — | P0 | nền tảng |
| Input / Textarea | — | P0 | |
| Label | Label | P0 | |
| Select | Select | P0 | searchable variant |
| Dialog | Dialog | P0 | |
| DropdownMenu | DropdownMenu | P0 | |
| Tooltip | Tooltip | P0 | |
| Avatar | Avatar | P0 | |
| Badge | — | P0 | |
| Tabs | Tabs | P1 | |
| Toast | (sonner) | P0 | |
| Skeleton | — | P0 | |
| Command | (cmdk) | P0 | palette |
| Popover | Popover | P1 | date picker, filter |
| Checkbox / Switch / Radio | tương ứng | P1 | form/settings |
| ScrollArea | ScrollArea | P2 | board column scroll |
| Sheet (Drawer) | Dialog | P1 | issue detail mobile, mobile sidebar |
| Combobox | Popover+cmdk | P1 | label/assignee multi-select |
| Calendar / DatePicker | (react-day-picker) | P2 | due date, sprint dates |
| Progress | Progress | P2 | sprint progress, story points |
| ContextMenu | ContextMenu | P2 | right-click trên card |

---

## 7. Command Palette (Cmd+K)

### 7.1. Mục tiêu

Một điểm truy cập universal: điều hướng, tạo issue, đổi theme, thực thi action, tìm kiếm — tất cả qua keyboard. Tương đương "command bar" của Linear.

### 7.2. Kiến trúc

```
<CommandPalette>             (cmdk Dialog, z-command)
  ├─ <CommandInput>          (fuzzy search, debounce 120ms cho remote)
  ├─ <CommandList>
  │    ├─ Group "Đề xuất"   (recent + context-aware)
  │    ├─ Group "Điều hướng"
  │    ├─ Group "Hành động"
  │    ├─ Group "Issues"     (kết quả search remote — JQL-lite)
  │    └─ Group "AI"         (xem §13)
  └─ <CommandEmpty>          (empty state)
```

- Mở/đóng qua global hotkey **⌘K / Ctrl+K** (đăng ký ở `AppShell`).
- State: `useCommandStore` (Zustand) — `open`, `query`, `pages` (stack cho sub-command), `context` (project/issue hiện tại).
- **Nested pages:** ví dụ "Move to sprint…" mở sub-page list sprint; Backspace khi query rỗng → pop page.

### 7.3. Đăng ký action (extensible)

```ts
// src/components/command/command-actions.ts
export interface CommandAction {
  id: string;
  label: string;
  group: "navigate" | "action" | "ai" | "settings";
  icon?: React.ComponentType;
  keywords?: string[];           // hỗ trợ fuzzy match tiếng Việt + Anh
  shortcut?: string[];           // ví dụ ["g", "b"] hiện hint
  perform: (ctx: CommandContext) => void | Promise<void>;
  isAvailable?: (ctx: CommandContext) => boolean;  // ẩn theo permission/context
  // nếu mở sub-page:
  children?: () => Promise<CommandAction[]>;
}

interface CommandContext {
  navigate: (to: string) => void;
  currentProjectId?: string;
  currentIssueId?: string;
  permissions: string[];
  ai: { available: boolean };
}
```

### 7.4. Danh mục action mặc định

| Group | Action | Hiệu lực |
|---|---|---|
| **Navigate** | Đi tới Board / Backlog / Reports / Settings | điều hướng router |
| | Chuyển project… (sub-page) | list project user có quyền |
| | Mở issue theo key (gõ `PROJ-123`) | parse key → navigate |
| **Action** | Tạo issue mới (`C`) | mở `<CreateIssueDialog>` |
| | Gán issue cho tôi | cần `currentIssueId` |
| | Đổi status issue… (sub-page) | list transitions hợp lệ (Workflows) |
| | Bắt đầu / Hoàn tất sprint | cần permission `MANAGE_SPRINT` |
| **AI** | Tạo issue từ mô tả tự nhiên | chỉ hiện nếu `ai.available` |
| | Tóm tắt issue này | cần `currentIssueId` + AI |
| | Gợi ý assignee / priority | AI |
| **Settings** | Đổi theme (Light/Dark/System) | đổi store |
| | Mở phím tắt (`?`) | mở `<ShortcutsDialog>` |

### 7.5. Search trong palette (giao tiếp Search subsystem)

- Khi query không match local action, gọi `useQuickSearch(query)` (debounced) → backend trả issues/projects.
- Hiển thị issue key + summary + type icon. Chọn → navigate tới issue.
- Loading: skeleton rows trong group "Issues".

### 7.6. A11y palette

- `role="dialog" aria-label="Bảng lệnh"`; cmdk lo focus trap & aria-activedescendant.
- Mỗi item có label rõ; shortcut hint dùng `<kbd>`.
- Reduced-motion: tắt scale-in.

---

## 8. Keyboard Shortcuts toàn cục

### 8.1. Hệ thống đăng ký

```ts
// src/hooks/use-hotkeys.ts — wrapper quanh listener toàn cục
// Quy tắc: bỏ qua khi focus ở input/textarea/contenteditable (trừ Esc & ⌘K)
useHotkeys("g b", () => navigate(boardUrl), { scopes: ["global"] });
```

- Hỗ trợ **sequence** (`g` rồi `b`) kiểu Vim/Gmail và **chord** (`⌘K`).
- Scope-based: tắt shortcut board khi đang ở dialog.

### 8.2. Bảng phím tắt

| Phím | Hành động | Scope |
|---|---|---|
| `⌘K` / `Ctrl+K` | Mở Command Palette | global |
| `?` | Mở bảng phím tắt | global |
| `C` | Tạo issue mới | global |
| `/` | Focus thanh search/JQL | global |
| `G` → `B` | Đi tới Board | global |
| `G` → `L` | Đi tới Backlog | global |
| `G` → `R` | Đi tới Reports | global |
| `G` → `D` | Đi tới Dashboard | global |
| `Esc` | Đóng dialog/drawer/palette | overlay |
| `J` / `K` | Di chuyển xuống/lên card (board/backlog) | list |
| `Enter` | Mở issue đang focus | list |
| `A` | Gán issue cho tôi (issue focus/detail) | issue |
| `M` | Đổi assignee | issue |
| `S` | Đổi status (mở transition menu) | issue |
| `E` | Chỉnh sửa nội dung | issue detail |
| `⌘+Enter` | Lưu form / gửi comment | form |
| `[` / `]` | Issue trước / sau (issue detail) | issue detail |

> `<ShortcutsDialog>` render bảng này tự động từ một registry chung (`shortcuts-registry.ts`) — single source of truth, đồng bộ với hotkeys thật.

### 8.3. Hiển thị hint

- Mọi nút có shortcut → tooltip kèm `<kbd>` (ví dụ "Tạo issue · C").
- Dropdown menu item kèm `<DropdownMenuShortcut>`.

---

## 9. Layout chính (App Shell)

### 9.1. Cấu trúc

```
┌─────────────────────────────────────────────────────────┐
│  Topbar  (h-14, sticky, z-sticky)                         │
│  [☰] Logo  Project▾   ⟨Search / ⌘K⟩    Presence  🔔  ◐  👤 │
├──────────┬──────────────────────────────────────────────┤
│ Sidebar  │  Main content area                            │
│ (w-60,   │  ┌─ Breadcrumb ─────────────────────────────┐ │
│ collap-  │  │  Projects / Tirapro / Board               │ │
│ sible    │  ├──────────────────────────────────────────┤ │
│ → w-16)  │  │  <Outlet/> (Board / Backlog / ...)         │ │
│          │  │                                            │ │
└──────────┴──────────────────────────────────────────────┘
```

### 9.2. Topbar

| Vùng | Nội dung |
|---|---|
| Trái | Toggle sidebar (mobile/collapse), logo, **Project switcher** (Select searchable) |
| Giữa | Search bar / "Tìm kiếm hoặc ⌘K" (click → mở palette) |
| Phải | `<PresenceBar>` (avatar online — Realtime), Notifications bell (badge count), `<ThemeToggle>`, User menu (avatar → dropdown: Profile, Settings, Logout) |

### 9.3. Sidebar

- **Trạng thái:** expanded (`w-60`) ↔ collapsed (`w-16`, chỉ icon + tooltip). Lưu vào store, persist.
- **Nội dung (theo project):**
  - Project header (avatar + tên + key)
  - Nav items: Board, Backlog, Sprints, Reports, Dashboard, Issues (search), Settings
  - Active state: nền `accent`, indicator trái (`border-l-2 border-primary`)
- Mỗi item: icon (lucide) + label, focusable, `aria-current="page"` khi active.

### 9.4. Responsive layout

| Breakpoint | Hành vi |
|---|---|
| `≥ 1024px` (lg) | Sidebar expanded mặc định, có thể collapse |
| `640–1024px` (sm–lg) | Sidebar auto-collapsed (icon-only) |
| `< 640px` (mobile) | Sidebar ẩn → mở bằng `<Sheet>` (drawer trượt trái); topbar gọn, search → icon mở palette |

### 9.5. `AppShell` skeleton

```tsx
function AppShell() {
  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <Topbar />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <main className="flex-1 overflow-auto" role="main">
          <Breadcrumb />
          <Outlet />
        </main>
      </div>
      <CommandPalette />
      <Toaster />
    </div>
  );
}
```

---

## 10. Đặc tả màn hình cốt lõi

> Tất cả màn hình: loading → skeleton khớp layout; rỗng → `<EmptyState>` có CTA; lỗi → `<ErrorState>` có retry. Data đến từ TanStack Query (hooks do subsystem khác cung cấp).

### 10.1. Board (Kanban / Scrum)

#### Layout

```
┌── Board Header ──────────────────────────────────────────┐
│ Sprint 12 ▾   [Group by ▾] [Filter] [JQL]   Presence  ⚙   │
├───────────────────────────────────────────────────────────┤
│ ┌─ To Do (8) ─┐ ┌─ In Progress (3) ─┐ ┌─ Review (2) ─┐ ┌─ Done (12) ─┐
│ │ ▢ card      │ │ ▢ card             │ │ ▢ card        │ │ ▢ card     │ │
│ │ ▢ card      │ │ ▢ card             │ │               │ │ ▢ card     │ │
│ │ + Tạo issue │ │ ...                │ │               │ │            │ │
│ └─────────────┘ └────────────────────┘ └───────────────┘ └────────────┘
└───────────────────────────────────────────────────────────┘
   (cuộn ngang nếu nhiều cột; mỗi cột cuộn dọc độc lập)
```

#### Cột (Column)

- Header sticky: tên status + count + WIP limit (nếu cấu hình; vượt → cảnh báo `warning`). Menu `...`: đổi tên, set WIP, ẩn.
- Cột là **drop zone** (@dnd-kit). Mỗi cột map tới một workflow `status`.
- Footer: "+ Tạo issue" inline (tạo nhanh trong column).
- Virtualize khi > 50 card/cột.

#### Card (`<IssueCard>`)

```ts
interface IssueCardProps {
  issue: IssueSummary;   // key, summary, type, priority, assignee, points, labels, dueDate
  isDragging?: boolean;
  isFocused?: boolean;   // keyboard nav
}
```

Layout card:
```
┌────────────────────────────────┐
│ Summary text (2 dòng, truncate) │
│ [🏷 label] [🏷 label]            │
│ 🐞PROJ-123  ⬆High   ◷5   👤      │  ← type-icon+key · priority · points · assignee avatar
└────────────────────────────────┘
```
- type icon & priority lấy màu từ token (§2.2).
- Hover: `shadow-md`, highlight nhẹ; click → mở Issue Detail (drawer).
- Focus (J/K nav): ring rõ; Enter mở.

#### Drag & Drop

- @dnd-kit: `DndContext` bao board, `SortableContext` mỗi column.
- **Optimistic UI:** thả card → cập nhật cache TanStack Query ngay (move local), gọi API; nếu fail → rollback + toast error. (Phối hợp Realtime: broadcast move tới client khác.)
- **Keyboard DnD:** card focus → `Space` nhấc, arrow di chuyển, `Space` thả (a11y — @dnd-kit KeyboardSensor). `aria-live` thông báo "Đã chuyển PROJ-123 sang In Progress".
- Drag overlay: card bản sao theo con trỏ, cột đích highlight viền `primary`.

#### Realtime (giao tiếp Realtime subsystem)

- Khi client khác move card → patch cache, animate card vào vị trí mới (`slide-up`), badge "đã cập nhật" thoáng qua.
- Presence: avatar người đang xem board ở header.

#### Scrum vs Kanban

- Cùng component Board; khác ở **data source** (Scrum = sprint hiện tại, Kanban = toàn bộ). Header có sprint switcher cho Scrum, "Quản lý cột" cho Kanban.

### 10.2. Backlog

#### Layout

```
┌── Backlog Header ── [Filter] [JQL search /] ─────────────┐
├───────────────────────────────────────────────────────────┤
│ ▾ Sprint 13  (5 issues · 21 pts)   [Bắt đầu sprint]        │
│   ⋮⋮ ▢ PROJ-201  Summary…    Story  ⬆  3pt  👤   [status▾] │
│   ⋮⋮ ▢ PROJ-202  Summary…    Bug    ⬆⬆ 5pt  👤             │
│   + Tạo issue                                              │
│ ▾ Sprint 14  (0 issues)      [Planned]                     │
│   …                                                        │
│ ▾ Backlog  (42 issues · 88 pts)                            │
│   ⋮⋮ ▢ PROJ-260 …                                          │
└───────────────────────────────────────────────────────────┘
```

#### Đặc tả

- **Group collapsible:** mỗi sprint + nhóm "Backlog" là section thu/mở được, hiện count + tổng story points.
- **Row issue:** drag handle (`⋮⋮`), checkbox (multi-select), type icon, key, summary inline-editable, type/priority/points/assignee/status — tất cả chỉnh nhanh qua inline control (popover/select).
- **Drag-drop giữa nhóm:** kéo issue từ Backlog → Sprint (và ngược lại), reorder trong nhóm. @dnd-kit cross-container. Optimistic.
- **Multi-select + bulk action:** chọn nhiều → toolbar nổi ("Chuyển sprint", "Gán", "Đổi status", "Xóa"). Shift-click chọn dải.
- **Virtualization bắt buộc** (backlog có thể hàng trăm issue) — `@tanstack/react-virtual`.
- **Sprint actions:** "Bắt đầu sprint" (mở dialog set goal + dates), "Hoàn tất sprint" (dialog xử lý issue chưa done → chuyển backlog/sprint sau).
- Keyboard: J/K nav rows, `Enter` mở, `Space` select.

### 10.3. Issue Detail

#### Hình thức trình bày

- **Drawer (Sheet)** trượt phải (desktop, `w-[640px]`) khi mở từ board/backlog → giữ ngữ cảnh list phía sau.
- **Full page** (`/browse/PROJ-123`) khi truy cập trực tiếp/deep link.
- **Mobile:** full-screen sheet.

#### Layout (2 cột trên rộng, 1 cột trên hẹp)

```
┌── Drawer Header ──────────────────────────────────────────┐
│ 🐞 PROJ-123   [⧉ copy link] [⤢ full page] [⋯] [✕]          │
├──────────────────────────────────┬────────────────────────┤
│ MAIN (cuộn)                       │ SIDEBAR (meta)          │
│ ┌ Summary (H1, inline edit) ────┐ │ Status:    [In Progress▾]│
│ │ Implement OAuth login         │ │ Assignee:  [👤 Pick ▾]   │
│ ├ Description (rich editor) ─────┤ │ Reporter:  👤 Alice      │
│ │ …markdown / mentions…         │ │ Priority:  [⬆ High ▾]    │
│ ├ Sub-tasks ────────────────────┤ │ Story pts: [ 5 ]         │
│ │ ▢ PROJ-124 …  [+ add]          │ │ Labels:    [+ add]       │
│ ├ Attachments ──────────────────┤ │ Sprint:    Sprint 12     │
│ │ [drop files / 📎]              │ │ Due:       [📅 ]         │
│ ├ Tabs: [Comments][History][Work]│ │ Custom fields…           │
│ │  Comment composer (@mention)   │ │ ── Created 2d ago        │
│ │  comment list                  │ │    Updated 1h ago        │
│ └────────────────────────────────┘ │ 👀 2 người đang xem       │
└──────────────────────────────────┴────────────────────────┘
```

#### Đặc tả thành phần

| Vùng | Hành vi |
|---|---|
| **Summary** | Click để inline-edit (`E`); `⌘+Enter` lưu, `Esc` hủy. |
| **Description** | Rich text editor (Tiptap/Lexical — subsystem riêng cung cấp); design system cung cấp khung & toolbar styling. Hỗ trợ @mention popover (Combobox user). |
| **Status** | Select hiển thị **transitions hợp lệ** (Workflows subsystem trả về). Đổi → optimistic + toast. |
| **Assignee/Reporter** | Combobox searchable (avatar + tên). "Gán cho tôi" quick action (`A`). |
| **Sub-tasks** | List mini-card có checkbox done, progress bar. Inline add. |
| **Attachments** | Drop zone + grid thumbnail; upload progress; ảnh → lightbox. (Attachments subsystem.) |
| **Comments tab** | Composer trên cùng (sticky), `@mention`, `⌘+Enter` gửi (optimistic). List có avatar, time relative, edit/delete (theo permission). |
| **History tab** | Activity log dạng timeline (ai đổi gì, khi nào). |
| **Worklog tab** | Time tracking entries. |
| **Custom fields** | Render động theo schema field (text/number/select/date...) — type → component map. |
| **Presence** | "👀 N người đang xem" + avatar (Realtime). Khi người khác đang gõ comment → "X đang nhập…". |

#### Realtime & Optimistic

- Mọi field edit → optimistic update + gọi API; conflict (ai đó vừa đổi) → merge/notify.
- Khi field thay đổi từ client khác → highlight field flash `accent` + tooltip "X vừa cập nhật".

#### Navigation

- `[` / `]`: issue trước/sau trong list nguồn (giữ context filter).
- Breadcrumb: Project / Board / PROJ-123.

### 10.4. Reports

#### Layout

```
┌── Reports ── Tabs: [Burndown][Velocity][Cumulative Flow][...] ─┐
│ Controls: [Sprint ▾] [Date range] [Export ▾ PDF|Excel]          │
├─────────────────────────────────────────────────────────────────┤
│  ┌─ Chart area (responsive) ───────────────────────────────────┐ │
│  │                                                              │ │
│  │     (Recharts: line / bar / area)                            │ │
│  │                                                              │ │
│  └──────────────────────────────────────────────────────────────┘ │
│  ┌─ Summary stats cards ─┐ ┌─────────┐ ┌─────────┐               │
│  │ Completed: 21 pts      │ │ ...     │ │ ...     │               │
│  └────────────────────────┘ └─────────┘ └─────────┘               │
└─────────────────────────────────────────────────────────────────┘
```

#### Đặc tả

- **Charts:** thư viện **Recharts** (React-native, dễ theme qua CSS var). Mọi chart đọc màu từ token (`--primary`, `--success`...) để auto theme light/dark.
  - **Burndown:** line chart — ideal vs actual remaining (points/issues) theo ngày sprint.
  - **Velocity:** bar chart — committed vs completed points qua các sprint.
  - **Cumulative Flow:** stacked area — số issue mỗi status theo thời gian.
- **Controls:** sprint/date selector, group-by. Đổi → refetch (TanStack Query), chart animate transition (tắt khi reduced-motion).
- **Tooltip chart:** custom tooltip dùng token màu/typography, không dùng default Recharts để đồng bộ design.
- **Empty/insufficient data:** `<EmptyState>` ("Chưa đủ dữ liệu cho biểu đồ này").
- **Loading:** skeleton hình chart (rectangle + shimmer).
- **Export (Analytics subsystem):** dropdown "Xuất" → PDF (render chart sang canvas/SVG → PDF) / Excel. Design system cung cấp button + loading state; logic export thuộc Analytics.
- **Responsive:** chart `ResponsiveContainer` width 100%; trên mobile → stack stats cards dọc, chart cao tối thiểu 240px, cho cuộn ngang nếu trục X dày.

#### Dashboard tùy biến (Analytics)

- Grid widget (react-grid-layout) — design system cung cấp `<WidgetCard>` wrapper (header + drag handle + resize + menu), nội dung widget do Analytics render. Token & skeleton đồng bộ.

---

## 11. Trạng thái chung (Empty / Error / Loading)

### 11.1. EmptyState

```ts
interface EmptyStateProps {
  icon?: React.ComponentType;
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
}
```
- Căn giữa, icon mờ (`text-muted-foreground`), title `text-lg`, CTA primary. Ví dụ: "Backlog trống — Tạo issue đầu tiên".

### 11.2. ErrorState

- icon cảnh báo, message thân thiện (không show stack), nút "Thử lại" (gọi `refetch`). Lỗi mạng vs lỗi quyền (403 → "Bạn không có quyền xem mục này") phân biệt rõ.

### 11.3. Loading

- Skeleton-first (đã nêu). Spinner chỉ cho action nhỏ trong button (`loading`).

---

## 12. Accessibility (WCAG 2.1 AA)

| Hạng mục | Yêu cầu |
|---|---|
| **Contrast** | Text/nền ≥ 4.5:1 (text thường), ≥ 3:1 (text lớn & UI components). Token màu đã chọn để đạt cả light & dark. Kiểm bằng axe-core CI. |
| **Focus** | Focus ring rõ (`ring-2 ring-ring ring-offset-2`) trên **mọi** phần tử tương tác. Không bao giờ `outline: none` mà không thay thế. |
| **Keyboard** | Mọi action có đường keyboard (xem §8). Tab order logic. DnD có KeyboardSensor. |
| **ARIA** | Dùng Radix → roles/states đúng sẵn. Dialog có `aria-labelledby`; icon-only button có `aria-label`; live regions (`aria-live="polite"`) cho toast & realtime update & DnD announce. |
| **Semantics** | Landmark đúng (`<header>`, `<nav>`, `<main>`); heading hierarchy (1 `<h1>`/màn hình). |
| **Form** | `<label>` liên kết; error `aria-invalid` + `aria-describedby`; không chỉ dựa vào màu để báo lỗi (kèm icon + text). |
| **Motion** | `@media (prefers-reduced-motion: reduce)` → set `--duration-*: 0.01ms`, tắt `animate-pulse`. |
| **Color-independence** | Status/priority không chỉ phân biệt bằng màu — luôn kèm icon/text. |
| **Touch target** | ≥ 44×44px trên mobile (tăng padding control ở breakpoint nhỏ). |

```css
/* globals.css */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

---

## 13. Tích hợp AI vào UX & degrade gracefully

### 13.1. Nguyên tắc

AI là **augmentation**, không phải blocker. Khi thiếu API key Claude (`ANTHROPIC_API_KEY`) hoặc service lỗi → mọi tính năng AI **ẩn hoặc disable mềm**, app vẫn chạy đầy đủ.

### 13.2. Hợp đồng UI ↔ AI subsystem

```ts
// do AI subsystem cung cấp
interface AICapability {
  available: boolean;          // backend báo có key & service sống
  model: "claude-opus-4-8" | "claude-sonnet-4-6"; // model đang dùng (chỉ để hiển thị, vd badge)
}
const { available } = useAICapability();
```

- Backend (NestJS) expose `GET /ai/status` → `{ available: boolean }`. UI cache qua TanStack Query.
- Khi `available === false`: các entry AI trong Command Palette **không render**; nút AI (vd "✨ Tóm tắt", "✨ Gợi ý") render `disabled` + tooltip "Tính năng AI chưa được cấu hình".

### 13.3. Điểm chạm AI trong UX (do design system render khung, AI subsystem cấp logic)

| Vị trí | Tính năng | Trạng thái degrade |
|---|---|---|
| Create Issue Dialog | "✨ Tạo từ mô tả" (nhập NL → sinh fields) | ẩn nút, dùng form thủ công |
| Issue Detail (Comments tab) | "✨ Tóm tắt thảo luận" | ẩn |
| Assignee/Priority/Points field | "✨ Gợi ý" badge cạnh field | ẩn badge |
| Backlog / Sprint planning | "✨ Trợ lý lập sprint" panel | ẩn panel, planning thủ công |
| Command Palette | group "AI" | không render group |
| Search | "Tìm kiếm ngữ nghĩa" toggle | chỉ còn JQL/keyword search |

### 13.4. UX khi AI đang chạy

- Action AI: dùng streaming khi có (response dài) → hiển thị text dần (typewriter) trong `<AISuggestionPanel>`; spinner "✨ Đang suy nghĩ…" với shimmer.
- Kết quả là **đề xuất** — luôn có nút "Áp dụng" / "Bỏ qua" / "Tạo lại", không tự ghi đè. Đánh dấu rõ nội dung do AI sinh (icon ✨ + nhãn).
- Lỗi AI (timeout, rate limit) → toast nhẹ "Không lấy được gợi ý AI, thử lại sau" — **không** chặn thao tác thủ công.

> **Lưu ý model:** UI chỉ hiển thị tên model (vd badge "Opus 4.8" / "Sonnet 4.6"), không gọi Claude trực tiếp từ frontend — mọi request AI đi qua backend NestJS (giữ API key server-side). Frontend chỉ nhận `available` flag và kết quả/stream.

---

## 14. Responsive & Mobile / PWA

### 14.1. Breakpoints (Tailwind default)

| | width | Bố cục chính |
|---|---|---|
| `sm` | 640 | mobile→tablet ranh giới |
| `md` | 768 | |
| `lg` | 1024 | sidebar expand |
| `xl` | 1280 | |
| `2xl` | 1400 | container max |

### 14.2. Quy tắc mobile

- **Board:** cột full-width, vuốt ngang (snap-scroll) chuyển cột; card density cao hơn; DnD bằng long-press.
- **Backlog:** row gọn, action ẩn trong menu `...`.
- **Issue Detail:** full-screen sheet, sidebar meta → collapse thành section trên cùng (accordion).
- **Sidebar:** drawer `<Sheet>`.
- **Topbar:** search → icon (mở palette), nén action vào overflow menu.
- **Reports:** stats cards 1 cột, chart scroll ngang.

### 14.3. PWA

- `vite-plugin-pwa`: manifest (tên Tirapro, icons 192/512, theme-color đồng bộ `--background`), service worker (cache app shell + static assets, network-first cho API).
- Offline: hiển thị banner "Đang offline — một số tính năng bị giới hạn"; dùng cache TanStack Query (persist) cho dữ liệu đã tải.
- Installable; theme-color meta đổi theo light/dark.

---

## 15. Định nghĩa "Done" cho subsystem

Một component/màn hình được coi là hoàn thành khi:

1. Render đúng cả **light & dark** (chỉ qua semantic token, không hard-code màu).
2. Có **loading (skeleton)**, **empty**, **error** states.
3. **Keyboard-accessible** đầy đủ + focus ring; pass `axe-core` (0 critical violation).
4. **Responsive** ở mobile / tablet / desktop.
5. Tôn trọng `prefers-reduced-motion`.
6. Dùng đúng primitives từ `components/ui` (không tự dựng lại button/input...).
7. Có shortcut hint (nếu áp dụng) đồng bộ `shortcuts-registry`.
8. AI-augmented thì **degrade gracefully** khi `available === false`.

---

## 16. Phụ lục: thứ tự triển khai đề xuất

| Giai đoạn | Hạng mục |
|---|---|
| **P0 — Foundation** | tokens.css + Tailwind config + theme switching + `cn` + globals (reduced-motion) |
| **P0 — Primitives** | Button, Input, Label, Select, Dialog, DropdownMenu, Tooltip, Avatar, Badge, Toast, Skeleton |
| **P0 — Shell** | AppShell, Topbar, Sidebar, Breadcrumb, CommandPalette, hotkeys + shortcuts registry |
| **P1 — Composite** | IssueCard, IssueTypeIcon, PriorityIcon, StatusBadge, UserAvatarGroup, EmptyState/ErrorState, Tabs, Sheet, Popover, Combobox |
| **P1 — Screens** | Board (DnD + optimistic + realtime), Backlog (virtualized + cross-container DnD), Issue Detail (drawer) |
| **P2 — Advanced** | Reports (Recharts + export khung), Dashboard widget grid, Calendar/DatePicker, Progress, ContextMenu, PWA |