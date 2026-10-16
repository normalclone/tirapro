import { describe, expect, it } from 'vitest';
import { canSeeNav, filterNavItems, NAV_RULES } from './navAccess';

const member = { isSystemAdmin: false, permissions: ['workspace:view', 'project:create'] };
const admin = { isSystemAdmin: false, permissions: ['workspace:admin', 'integration:manage'] };
const sysAdmin = { isSystemAdmin: true, permissions: [] };

describe('canSeeNav', () => {
  it('thành viên thường không thấy Kết nối / Nhập dữ liệu / Quản trị hệ thống', () => {
    expect(canSeeNav(NAV_RULES.connect, member)).toBe(false);
    expect(canSeeNav(NAV_RULES.settingsImport, member)).toBe(false);
    expect(canSeeNav(NAV_RULES.admin, member)).toBe(false);
  });
  it('quản trị workspace thấy Kết nối, Nhập dữ liệu; vẫn không thấy Quản trị hệ thống', () => {
    expect(canSeeNav(NAV_RULES.connect, admin)).toBe(true);
    expect(canSeeNav(NAV_RULES.settingsImport, admin)).toBe(true);
    expect(canSeeNav(NAV_RULES.admin, admin)).toBe(false);
  });
  it('admin hệ thống thấy tất cả', () => {
    for (const rule of Object.values(NAV_RULES)) expect(canSeeNav(rule, sysAdmin)).toBe(true);
  });
  it('quy tắc "all" luôn thấy', () => expect(canSeeNav('all', member)).toBe(true));
  it('nhập csv/json (import:run) thấy Nhập dữ liệu nhưng không thấy Thương hiệu/API', () => {
    const importer = { isSystemAdmin: false, permissions: ['import:run'] };
    expect(canSeeNav(NAV_RULES.settingsImport, importer)).toBe(true);
    expect(canSeeNav(NAV_RULES.settingsGeneral, importer)).toBe(false);
    expect(canSeeNav(NAV_RULES.settingsApi, importer)).toBe(false);
  });
  it('automation:manage (cấp workspace) đủ để thấy Kết nối', () => {
    expect(
      canSeeNav(NAV_RULES.connect, { isSystemAdmin: false, permissions: ['automation:manage'] }),
    ).toBe(true);
  });
});

describe('filterNavItems', () => {
  const items = [
    { to: '/', match: (p: string) => p === '/' },
    { to: '/connect', rule: NAV_RULES.connect, match: (p: string) => p.startsWith('/connect') },
    { to: '/admin', rule: NAV_RULES.admin, match: (p: string) => p.startsWith('/admin') },
  ];
  it('ẩn mục thiếu quyền', () =>
    expect(filterNavItems(items, member).map((i) => i.to)).toEqual(['/']));
  it('đang đứng trên mục thiếu quyền thì mục vẫn hiện để sáng lên (Tự động hoá từ tab dự án)', () =>
    expect(filterNavItems(items, member, '/connect/automation').map((i) => i.to)).toEqual([
      '/',
      '/connect',
    ]));
  it('mục chỉ dành admin hệ thống không bao giờ hiện cho người khác, kể cả khi đứng trên /admin', () =>
    expect(filterNavItems(items, member, '/admin').map((i) => i.to)).toEqual(['/']));
});
