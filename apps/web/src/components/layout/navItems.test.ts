import { describe, expect, it } from 'vitest';
import { ADMIN_NAV, ADMIN_TAB_COUNT, NAV_ITEMS, sheetNavItems, USER_TAB_PATHS } from './navItems';

describe('navItems (nguồn chung sidebar / thanh tab đáy / sheet Tôi)', () => {
  it('người dùng thường: sheet = mọi mục nav trừ 2 mục đã có trên thanh (Tổng quan, Dự án)', () => {
    const rest = sheetNavItems(NAV_ITEMS, false).map((i) => i.to);
    expect(rest).toEqual([
      '/me',
      '/filters',
      '/members',
      '/wiki',
      '/connect',
      '/settings',
      '/admin',
    ]);
    for (const p of USER_TAB_PATHS) expect(rest).not.toContain(p);
    // Mục "Danh mục" đã bỏ: không còn lối vào /manage ở sidebar, thanh tab đáy hay sheet Tôi.
    expect(NAV_ITEMS.some((i) => i.to.startsWith('/manage'))).toBe(false);
  });
  it('sheet tôn trọng quyền: mục đã bị lọc khỏi danh sách đầu vào thì không xuất hiện', () => {
    const visible = NAV_ITEMS.filter((i) => !i.rule);
    expect(sheetNavItems(visible, false).map((i) => i.to)).toEqual([
      '/me',
      '/filters',
      '/wiki',
      '/settings',
    ]);
  });
  it('admin: thanh giữ 4 mục đầu, sheet chứa phần còn lại (Hệ thống, Cách tính điểm)', () => {
    expect(ADMIN_NAV.length).toBeGreaterThan(ADMIN_TAB_COUNT);
    expect(sheetNavItems(ADMIN_NAV, true).map((i) => i.to)).toEqual([
      '/admin/system',
      '/admin/points',
    ]);
  });
  it('Thành viên hiện với mọi người (người không quản lý chỉ xem người trong dự án mình tham gia)', async () => {
    const { canSeeNav } = await import('@/lib/navAccess');
    const members = NAV_ITEMS.find((i) => i.to === '/members')!;
    expect(
      canSeeNav(members.rule ?? 'all', { isSystemAdmin: false, permissions: ['project:view'] }),
    ).toBe(true);
  });
  it('"Của tôi" (/me) đứng ngay trên Tổng quan và chỉ khớp đúng /me', () => {
    const [me, home] = NAV_ITEMS;
    expect(me!.to).toBe('/me');
    expect(home!.to).toBe('/');
    expect(me!.match('/me')).toBe(true);
    expect(me!.match('/members')).toBe(false);
    expect(home!.match('/me')).toBe(false);
  });
  it('Tổng quan và Dự án khớp đúng route (Dự án active cả /p/*)', () => {
    const home = NAV_ITEMS.find((i) => i.to === '/')!;
    const projects = NAV_ITEMS.find((i) => i.to === '/projects')!;
    expect(home.match('/')).toBe(true);
    expect(home.match('/projects')).toBe(false);
    expect(projects.match('/p/PSL/board')).toBe(true);
    expect(projects.match('/projects')).toBe(true);
  });
  it('thanh tab admin: nhãn dài "Tổ chức" có nhãn ngắn, các ô khác không cần', () => {
    const tabs = ADMIN_NAV.slice(0, ADMIN_TAB_COUNT);
    const ws = tabs.find((i) => i.to === '/admin/organizations')!;
    expect(ws.label).toBe('Tổ chức');
    expect(ws.tabLabel).toBe('Tổ chức');
    for (const i of tabs) expect(i.tabLabel ?? i.label).not.toBe('');
    expect(tabs.filter((i) => i.tabLabel).map((i) => i.to)).toEqual(['/admin/organizations']);
  });
});
