import { describe, expect, it } from 'vitest';
import { shouldShowDemoAccounts } from './demoLogin';

describe('shouldShowDemoAccounts', () => {
  it('production mặc định: ẩn', () => expect(shouldShowDemoAccounts({ DEV: false })).toBe(false));
  it('production + VITE_SHOW_DEMO_ACCOUNTS khác "true": ẩn', () =>
    expect(shouldShowDemoAccounts({ DEV: false, VITE_SHOW_DEMO_ACCOUNTS: '1' })).toBe(false));
  it('dev: hiện', () => expect(shouldShowDemoAccounts({ DEV: true })).toBe(true));
  it('cờ demo: hiện', () =>
    expect(shouldShowDemoAccounts({ DEV: false, VITE_SHOW_DEMO_ACCOUNTS: 'true' })).toBe(true));
});
