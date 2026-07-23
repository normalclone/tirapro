import type { Config } from 'tailwindcss';
import animate from 'tailwindcss-animate';

export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg)',
        surface: 'var(--surface)',
        'surface-2': 'var(--surface-2)',
        'surface-3': 'var(--surface-3)',
        border: 'var(--border)',
        'border-strong': 'var(--border-strong)',
        ink: 'var(--ink)',
        'ink-strong': 'var(--ink-strong)',
        muted: 'var(--muted)',
        faint: 'var(--faint)',
        primary: 'var(--primary)',
        'primary-hover': 'var(--primary-hover)',
        'primary-fg': 'var(--primary-fg)',
        'primary-subtle': 'var(--primary-subtle)',
        success: 'var(--success)',
        warning: 'var(--warning)',
        danger: 'var(--danger)',
        'status-todo': 'var(--status-todo)',
        'status-progress': 'var(--status-progress)',
        'status-done': 'var(--status-done)',
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
