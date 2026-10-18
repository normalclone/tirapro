import { describe, expect, it } from 'vitest';
import { ADMIN_NAV, ADMIN_TAB_COUNT, NAV_ITEMS, sheetNavItems, USER_TAB_PATHS } from './navItems';

describe('navItems (nguồn chung sidebar / thanh tab đáy / sheet Tôi)', () => {
  it('người dùng thường: sheet = mọi mục nav trừ 2 mục đã có trên thanh (Tổng quan, Dự án)', () => {
    const rest = sheetNavItems(NAV_ITEMS, false).map((i) => i.to);
    expect(rest).toEqual([
      '/filters',
      '/members',
      '/manage',
      '/wiki',
      '/connect',
      '/settings',
      '/admin',
    ]);
    for (const p of USER_TAB_PATHS) expect(rest).not.toContain(p);
  });
  it('sheet tôn trọng quyền: mục đã bị lọc khỏi danh sách đầu vào thì không xuất hiện', () => {
    const visible = NAV_ITEMS.filter((i) => !i.rule);
    expect(sheetNavItems(visible, false).map((i) => i.to)).toEqual([
      '/filters',
      '/members',
      '/manage',
      '/wiki',
      '/settings',
    ]);
  });
  it('admin: thanh giữ 4 mục đầu, sheet chứa phần còn lại (Hệ thống)', () => {
    expect(ADMIN_NAV.length).toBeGreaterThan(ADMIN_TAB_COUNT);
    expect(sheetNavItems(ADMIN_NAV, true).map((i) => i.to)).toEqual(['/admin/system']);
  });
  it('Tổng quan và Dự án khớp đúng route (Dự án active cả /p/*)', () => {
    const [home, projects] = NAV_ITEMS;
    expect(home!.match('/')).toBe(true);
    expect(home!.match('/projects')).toBe(false);
    expect(projects!.match('/p/PSL/board')).toBe(true);
    expect(projects!.match('/projects')).toBe(true);
  });
});
