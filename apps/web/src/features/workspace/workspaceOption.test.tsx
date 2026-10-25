import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { WorkspaceOption } from './WorkspaceOption';
import { workspaceSubline } from './workspaceSubline';
import { countActiveMembers } from '../members/memberCount';

const read = (p: string) => readFileSync(join(__dirname, p), 'utf8');
const ws = (o: Partial<Parameters<typeof workspaceSubline>[0]> = {}) => ({
  id: 'w1',
  name: 'Tirapro Demo',
  slug: 'demo',
  avatarUrl: null,
  roleName: 'Workspace Admin',
  memberCount: 12,
  ...o,
});

describe('workspaceSubline', () => {
  it('đếm trước, vai trò sau; title đầy đủ', () => {
    expect(workspaceSubline(ws())).toEqual({
      count: 12,
      text: 'thành viên · Quản trị chung',
      title: '12 thành viên đang hoạt động · Vai trò của bạn: Quản trị chung',
    });
  });
  it('1 thành viên và 0 vẫn đúng', () => {
    expect(workspaceSubline(ws({ memberCount: 1 })).count).toBe(1);
    expect(workspaceSubline(ws({ memberCount: 0 })).count).toBe(0);
  });
  it('thiếu memberCount (API cũ chưa triển khai) → chỉ vai trò, không "undefined"/NaN', () => {
    for (const memberCount of [undefined, null, Number.NaN, -1] as unknown as number[]) {
      const s = workspaceSubline(ws({ memberCount }));
      expect(s.count).toBeNull();
      expect(s.text).toBe('Quản trị chung');
      expect(s.title).toBe('Vai trò của bạn: Quản trị chung');
    }
  });
});

describe('WorkspaceOption', () => {
  const html = (o: { memberCount?: number | null; active?: boolean } = {}) =>
    renderToStaticMarkup(
      <WorkspaceOption
        ws={ws('memberCount' in o ? ({ memberCount: o.memberCount } as never) : {})}
        active={o.active ?? false}
        disabled={false}
        onPick={() => undefined}
      />,
    );
  it('tên truy cập = tên không gian (aria-labelledby); dòng 2 chỉ là mô tả (aria-describedby)', () => {
    const out = html();
    const labelled = /aria-labelledby="([^"]+)"/.exec(out)![1]!;
    const described = /aria-describedby="([^"]+)"/.exec(out)![1]!;
    expect(labelled).not.toBe(described);
    expect(out).toMatch(new RegExp(`id="${labelled}"[^>]*>Tirapro Demo<`));
    expect(out).toMatch(new RegExp(`id="${described}"`));
    expect(out).not.toMatch(/aria-label="/);
  });
  it('số thành viên là tabular-nums, đứng trước vai trò, có tooltip đầy đủ', () => {
    const out = html();
    expect(out).toMatch(/<span class="tabular-nums">12<\/span> thành viên · Quản trị chung/);
    expect(out).toContain('title="12 thành viên đang hoạt động · Vai trò của bạn: Quản trị chung"');
  });
  it('API cũ không có memberCount → chỉ vai trò', () => {
    const out = html();
    const old = html({ memberCount: undefined });
    expect(out).toContain('tabular-nums');
    expect(old).not.toContain('tabular-nums');
    expect(old).toContain('Quản trị chung');
    expect(old).not.toMatch(/undefined|NaN/);
  });
  it('✓ chỉ ở không gian đang chọn, aria-selected phản ánh', () => {
    expect(html({ active: true })).toMatch(/aria-selected="true"/);
    expect(html({ active: true })).toContain('lucide-check');
    expect(html({ active: false })).not.toContain('lucide-check');
    expect(html({ active: false })).toMatch(/aria-selected="false"/);
  });
});

describe('nối dây', () => {
  it('switcher dùng WorkspaceOption; không thêm Cài đặt/Đăng xuất (đã có UserMenu)', () => {
    const sw = read('WorkspaceSwitcher.tsx');
    expect(sw).toMatch(/<WorkspaceOption/);
    expect(sw).not.toMatch(/Đăng xuất|Cài đặt/);
  });
  it('kiểu MyWorkspace có memberCount tuỳ chọn (API cũ)', () => {
    expect(read('api.ts')).toMatch(/memberCount\?: number/);
  });
});

describe('trang Thành viên', () => {
  it('đầu danh sách đếm bằng countActiveMembers (cùng số với bộ chọn)', () => {
    const page = readFileSync(join(__dirname, '../members/MembersPage.tsx'), 'utf8');
    expect(page).toMatch(/memberCountParts\(members\)/);
    expect(page).not.toMatch(/\{members\.length\} người/);
  });
});

describe('countActiveMembers — số trên trang Thành viên bằng số ở bộ chọn', () => {
  const m = (status: string) => ({ user: { status } }) as never;
  it('không đếm tài khoản bị vô hiệu hoá', () => {
    expect(countActiveMembers([m('ACTIVE'), m('INVITED'), m('DEACTIVATED')])).toBe(2);
  });
  it('rỗng → 0', () => expect(countActiveMembers([])).toBe(0));
});
