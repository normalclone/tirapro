import type { Config } from 'tailwindcss';
import animate from 'tailwindcss-animate';

/**
 * Token màu là biến CSS chứa giá trị OKLCH nguyên khối (không phải kênh rời), nên
 * cú pháp `rgb(var(--x) / <alpha-value>)` KHÔNG dùng được. Dạng hàm dưới đây cho
 * Tailwind sinh đúng CSS khi có opacity modifier (vd `bg-danger/10`) bằng color-mix;
 * nếu không có modifier thì trả về biến như cũ.
 * Thiếu hàm này, các class như `bg-success/10` sẽ bị BỎ QUA (không sinh CSS).
 */
const token =
  (name: string) =>
  ({ opacityValue }: { opacityValue?: string }) =>
    opacityValue === undefined
      ? `var(${name})`
      : `color-mix(in oklch, var(${name}) calc(${opacityValue} * 100%), transparent)`;

export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: token('--bg'),
        surface: token('--surface'),
        'surface-2': token('--surface-2'),
        'surface-3': token('--surface-3'),
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
        danger: token('--danger'),
        'status-todo': token('--status-todo'),
        'status-progress': token('--status-progress'),
        'status-done': token('--status-done'),
      },
      fontFamily: {
        sans: ['Geist Variable', 'Geist', 'system-ui', 'sans-serif'],
        mono: ['Geist Mono Variable', 'Geist Mono', 'ui-monospace', 'monospace'],
      },
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
        // Chrome điều hướng (drawer mobile) nằm DƯỚI mọi lớp nổi.
        'nav-backdrop': '800',
        'nav-drawer': '900',
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
