import type { Config } from 'tailwindcss';
import animate from 'tailwindcss-animate';

type ColorFn = (utils: { opacityValue?: string }) => string;

/**
 * Token màu là biến CSS chứa giá trị OKLCH nguyên khối (không phải kênh rời), nên
 * cú pháp `rgb(var(--x) / <alpha-value>)` KHÔNG dùng được. Dạng hàm dưới đây cho
 * Tailwind sinh đúng CSS khi có opacity modifier (vd `bg-danger/10`) bằng color-mix;
 * nếu không có modifier thì trả về biến như cũ.
 * Thiếu hàm này, các class như `bg-success/10` sẽ bị BỎ QUA (không sinh CSS).
 */
const token =
  (name: string): ColorFn =>
  ({ opacityValue }) =>
    opacityValue === undefined
      ? `var(${name})`
      : `color-mix(in oklch, var(${name}) calc(${opacityValue} * 100%), transparent)`;

/**
 * Runtime của Tailwind chấp nhận hàm làm giá trị màu, nhưng kiểu `Config` chỉ khai báo chuỗi. Chỗ DUY NHẤT ép kiểu
 * nằm ở đây (không để `token` giả vờ trả chuỗi): cần để file qua `tsc` vì `motionTokens.test.ts` import cấu hình.
 */
const asThemeColors = (colors: Record<string, ColorFn>) =>
  colors as unknown as Record<string, string>;

export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: asThemeColors({
        bg: token('--bg'),
        surface: token('--surface'),
        'surface-2': token('--surface-2'),
        'surface-3': token('--surface-3'),
        'disabled-bg': token('--disabled-bg'),
        'disabled-fg': token('--disabled-fg'),
        border: token('--border'),
        'border-strong': token('--border-strong'),
        ink: token('--ink'),
        'ink-strong': token('--ink-strong'),
        muted: token('--muted'),
        faint: token('--faint'),
        primary: token('--primary'),
        'primary-hover': token('--primary-hover'),
        'primary-fg': token('--primary-fg'),
        'primary-subtle': token('--primary-subtle'),
        success: token('--success'),
        warning: token('--warning'),
        'warning-ink': token('--warning-ink'),
        danger: token('--danger'),
        'status-todo': token('--status-todo'),
        'status-progress': token('--status-progress'),
        'status-done': token('--status-done'),
      }),
      fontFamily: {
        sans: ['Geist Variable', 'Geist', 'system-ui', 'sans-serif'],
        mono: ['Geist Mono Variable', 'Geist Mono', 'ui-monospace', 'monospace'],
      },
      // Token motion theo DESIGN.md. Đặt tên (không dùng duration-[120ms]) vì tailwindcss-animate cũng đăng ký
      // `duration` (animation-duration) nên giá trị tuỳ ý bị coi là mơ hồ.
      transitionDuration: { fast: '120ms', base: '180ms', slow: '240ms' },
      borderRadius: {
        sm: '4px',
        DEFAULT: '6px',
        md: '6px',
        lg: '8px',
        xl: '12px',
      },
      boxShadow: {
        sm: '0 1px 2px oklch(0.4 0.03 256 / 0.06)',
        md: '0 2px 8px oklch(0.4 0.03 256 / 0.08), 0 1px 2px oklch(0.4 0.03 256 / 0.06)',
        lg: '0 8px 28px oklch(0.35 0.03 256 / 0.14)',
      },
      fontSize: {
        xs: ['0.75rem', { lineHeight: '1.4' }],
        sm: ['0.8125rem', { lineHeight: '1.45' }],
        base: ['0.875rem', { lineHeight: '1.5' }],
        lg: ['1.075rem', { lineHeight: '1.3' }],
        xl: ['1.25rem', { lineHeight: '1.25' }],
        '2xl': ['1.5rem', { lineHeight: '1.2' }],
        '3xl': ['2rem', { lineHeight: '1.15' }],
      },
      zIndex: {
        sticky: '1100',
        backdrop: '1200',
        modal: '1300',
        // Menu/popover/dropdown (Radix portal về <body>) phải nằm TRÊN modal:
        // chúng thường được mở TỪ TRONG modal (SearchSelect, RoleMultiSelect…),
        // nếu thấp hơn modal thì list bị modal che → không bấm chọn được.
        // Vẫn dưới toast/tooltip.
        dropdown: '1350',
        toast: '1400',
        tooltip: '1500',
      },
      transitionTimingFunction: {
        'out-quart': 'cubic-bezier(0.25, 1, 0.5, 1)',
        'out-expo': 'cubic-bezier(0.16, 1, 0.3, 1)',
      },
    },
  },
  plugins: [animate],
} satisfies Config;
