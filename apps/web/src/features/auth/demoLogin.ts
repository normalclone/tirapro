/**
 * Khối "Tài khoản demo" (mật khẩu chung) chỉ hiện khi chạy dev hoặc khi build staging/demo bật cờ
 * `VITE_SHOW_DEMO_ACCOUNTS=true`. Bản production mặc định KHÔNG chứa khối này (cũng không chứa mật khẩu demo).
 */
export function shouldShowDemoAccounts(env: {
  DEV?: boolean;
  VITE_SHOW_DEMO_ACCOUNTS?: string;
}): boolean {
  return env.DEV === true || env.VITE_SHOW_DEMO_ACCOUNTS === 'true';
}

/** Hằng số lúc build: khi `false`, `LoginPage` không nạp chunk `DemoAccounts` nên Rollup loại cả chunk. */
export const SHOW_DEMO_ACCOUNTS = shouldShowDemoAccounts({
  DEV: import.meta.env.DEV,
  VITE_SHOW_DEMO_ACCOUNTS: import.meta.env.VITE_SHOW_DEMO_ACCOUNTS,
});
