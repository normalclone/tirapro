import type { SVGProps } from 'react';
import type { RepositoryProvider } from './api';

/**
 * Logo thương hiệu nền tảng — SVG nội tuyến, tự chứa (không URL ngoài → an toàn CSP).
 * Dùng ở rail submenu, tiêu đề section và từng hàng repository.
 */

export type Platform = 'TELEGRAM' | 'GITHUB' | 'GITLAB';

type LogoProps = SVGProps<SVGSVGElement> & {
  /** Kích thước cạnh (px). Mặc định 18 (~16–20px). */
  size?: number;
};

/** Telegram — máy bay giấy trên nền tròn xanh thương hiệu. */
export function TelegramLogo({ size = 18, ...props }: LogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role="img"
      aria-label="Telegram"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <circle cx="12" cy="12" r="12" fill="#2AABEE" />
      <path
        d="M5.4 11.83c3.55-1.55 5.92-2.57 7.1-3.06 3.38-1.41 4.08-1.65 4.54-1.66.1 0 .33.02.48.14.12.1.16.24.17.34.02.1.04.32.02.5-.2 2.05-1.03 7.02-1.46 9.31-.18.97-.54 1.29-.88 1.32-.75.07-1.32-.49-2.04-.96-1.13-.74-1.77-1.2-2.86-1.93-1.27-.83-.45-1.29.28-2.04.19-.2 3.5-3.2 3.56-3.47.01-.04.01-.16-.06-.23-.08-.06-.19-.04-.27-.02-.11.02-1.94 1.23-5.47 3.63-.52.35-.99.53-1.4.52-.46-.01-1.35-.26-2.01-.47-.8-.26-1.44-.4-1.39-.85.03-.24.35-.48.96-.74Z"
        fill="#fff"
      />
    </svg>
  );
}

/** GitHub — mèo mực (invertocat). Dùng currentColor để hợp light/dark. */
export function GitHubLogo({ size = 18, ...props }: LogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role="img"
      aria-label="GitHub"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <path d="M12 .5A11.5 11.5 0 0 0 .5 12a11.5 11.5 0 0 0 7.86 10.92c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.36-3.88-1.36-.53-1.34-1.28-1.7-1.28-1.7-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.68 0-1.26.45-2.29 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11 11 0 0 1 5.8 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.8 1.19 1.83 1.19 3.09 0 4.41-2.69 5.38-5.25 5.67.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 23.5 12 11.5 11.5 0 0 0 12 .5Z" />
    </svg>
  );
}

/** GitLab — logo cáo (tanuki) đa sắc cam. */
export function GitLabLogo({ size = 18, ...props }: LogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role="img"
      aria-label="GitLab"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <path d="M12 22.3 16.42 8.7H7.58L12 22.3Z" fill="#E24329" />
      <path d="M12 22.3 7.58 8.7H1.39L12 22.3Z" fill="#FC6D26" />
      <path
        d="M1.39 8.7.05 12.83a.91.91 0 0 0 .33 1.02L12 22.3 1.39 8.7Z"
        fill="#FCA326"
      />
      <path d="M1.39 8.7h6.19L4.92 1.53a.46.46 0 0 0-.87 0L1.39 8.7Z" fill="#E24329" />
      <path d="M12 22.3 16.42 8.7h6.19L12 22.3Z" fill="#FC6D26" />
      <path
        d="M22.61 8.7 23.95 12.83a.91.91 0 0 1-.33 1.02L12 22.3 22.61 8.7Z"
        fill="#FCA326"
      />
      <path d="M22.61 8.7h-6.19l2.66-7.17a.46.46 0 0 1 .87 0L22.61 8.7Z" fill="#E24329" />
    </svg>
  );
}

/** Chọn logo theo nền tảng chung. */
export function PlatformLogo({ platform, ...props }: LogoProps & { platform: Platform }) {
  switch (platform) {
    case 'TELEGRAM':
      return <TelegramLogo {...props} />;
    case 'GITHUB':
      return <GitHubLogo {...props} />;
    case 'GITLAB':
      return <GitLabLogo {...props} />;
  }
}

/** Logo theo provider của repository (GitHub vs GitLab). */
export function RepoProviderLogo({
  provider,
  ...props
}: LogoProps & { provider: RepositoryProvider }) {
  return <PlatformLogo platform={provider} {...props} />;
}
