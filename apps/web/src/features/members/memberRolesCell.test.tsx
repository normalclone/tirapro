import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { MemberDto, RoleDto } from '@tirapro/types';
import { RoleChecklist } from '@/components/ui/RoleMultiSelect';
import { MemberRolesCell } from './MemberRolesCell';

const read = (p: string) => readFileSync(join(__dirname, p), 'utf8');

const roles = [
  { id: 'r-admin', name: 'Workspace Admin', permissionKeys: ['workspace:admin'], color: null },
  { id: 'r-member', name: 'Workspace Member', permissionKeys: [], color: null },
] as unknown as RoleDto[];
const member = (roleIds: string[]): MemberDto =>
  ({
    membershipId: 'm1',
    user: { id: 'u1', displayName: 'Bình', email: 'b@x', status: 'ACTIVE' },
    roles: roleIds.map((id) => ({ id, name: roles.find((r) => r.id === id)!.name })),
  }) as unknown as MemberDto;

function html(o: { canManage: boolean; roleIds?: string[] }) {
  const m = member(o.roleIds ?? ['r-member']);
  return renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <MemberRolesCell
        member={m}
        members={[m]}
        roles={roles}
        canManage={o.canManage}
        isSelf={false}
      />
    </QueryClientProvider>,
  );
}

describe('MemberRolesCell — có quyền', () => {
  const out = html({ canManage: true });
  it('cụm badge là MỘT nút tên "Đổi vai trò của {tên}", báo popup', () => {
    expect(out).toMatch(/<button[^>]*aria-label="Đổi vai trò của Bình"/);
    expect(out).toMatch(/aria-haspopup="dialog"/);
  });
  it('tên nút KHÔNG lẫn chữ badge; badge vẫn hiện và được đọc như mô tả (aria-describedby)', () => {
    const label = /aria-label="([^"]*)"/.exec(out)![1]!;
    expect(label).not.toMatch(/Thành viên|Quản trị/);
    expect(out).toContain('Thành viên');
    const id = /aria-describedby="([^"]+)"/.exec(out)![1]!;
    expect(out).toContain(`id="${id}"`);
  });
  it('44px trên màn cảm ứng', () => {
    expect(out).toMatch(/\[@media\(pointer:coarse\)\]:min-h-11/);
  });
});

describe('MemberRolesCell — không có quyền', () => {
  it('có quyền nhưng danh mục vai trò chưa tải → chưa có nút (chưa biết ai là admin)', () => {
    const m = member(['r-member']);
    const out = renderToStaticMarkup(
      <QueryClientProvider client={new QueryClient()}>
        <MemberRolesCell member={m} members={[m]} roles={[]} canManage isSelf={false} />
      </QueryClientProvider>,
    );
    expect(out).not.toMatch(/<button/);
  });
  it('badge là chữ thường, không có nút', () => {
    const out = html({ canManage: false });
    expect(out).not.toMatch(/<button/);
    expect(out).toContain('Thành viên');
  });
  it('chưa có vai trò → "Chưa có vai trò"', () => {
    const m = member([]);
    const out = renderToStaticMarkup(
      <QueryClientProvider client={new QueryClient()}>
        <MemberRolesCell member={m} members={[m]} roles={roles} canManage={false} isSelf={false} />
      </QueryClientProvider>,
    );
    expect(out).toContain('Chưa có vai trò');
  });
});

describe('nối dây', () => {
  const cell = read('MemberRolesCell.tsx');
  it('hàng thành viên dùng MemberRolesCell, không còn nút bút chì riêng', () => {
    const page = read('MembersPage.tsx');
    expect(page).toMatch(/<MemberRolesCell/);
    expect(page).not.toMatch(/Pencil|Sửa vai trò của/);
  });
  it('mở EditRolesPopover chế độ lưu ngay; xác nhận tự bỏ quyền admin qua useConfirm (không requireText)', () => {
    expect(cell).toMatch(/<EditRolesPopover/);
    expect(cell).toMatch(/instant=/);
    expect(cell).toMatch(/useConfirm\(\)/);
    expect(cell).not.toMatch(/requireText/);
    expect(cell).toMatch(/planRoleChange\(/);
    expect(cell).toMatch(/lockedRoleReasons\(/);
  });
  it('hook lưu ngay: Hoàn tác trong toast, mutateAsync + try/catch (toast ở hook, không ở mutate())', () => {
    const hook = read('useInlineMemberRoles.ts');
    expect(hook).toMatch(/label: 'Hoàn tác'/);
    expect(hook).toMatch(/mutateAsync\(/);
    expect(hook).toMatch(/catch/);
    expect(hook).toMatch(/planUndo\(/);
  });
  it('trả focus về nút vai trò sau Hoàn tác và sau khi Huỷ xác nhận', () => {
    expect(cell).toMatch(/triggerRef/);
    expect(cell).toMatch(/triggerRef\.current\?\.focus\(\)/);
    expect(read('useInlineMemberRoles.ts')).toMatch(/focusTrigger/);
  });
  it('chế độ lưu ngay không tự focus ô tìm (không bật bàn phím cảm ứng)', () => {
    const pop = read('EditRolesPopover.tsx');
    expect(pop).toMatch(/autoFocusSearch=\{false\}/);
  });
  it('trang Thành viên chọn boolean quyền từ store (không chọn hàm can) để cập nhật khi quyền đổi', () => {
    const page = read('MembersPage.tsx');
    expect(page).toMatch(/useAuth\(\(s\) => s\.can\('member:manage'\)\)/);
    expect(page).not.toMatch(/useAuth\(\(s\) => s\.can\)/);
  });
  it('toast không hứa Hoàn tác (canUndo=false) ghi đè action cũ vì sonner gộp theo id; baseline theo chuỗi bấm', () => {
    const hook = read('useInlineMemberRoles.ts');
    expect(hook).toMatch(/canUndo === false/);
    expect(hook).toMatch(/action: undefined/);
    expect(hook).toMatch(/burstBaseline\(/);
    expect(hook).toMatch(/onAutoClose/);
  });
  it('lưu xong cho CHÍNH MÌNH thì làm mới quyền trong auth store', () => {
    expect(read('useInlineMemberRoles.ts')).toMatch(/refreshMe\(\)/);
  });
  it('EditRolesPopover: chế độ lưu ngay dùng RoleChecklist (không lồng dropdown thứ hai); chế độ cũ giữ nút Lưu', () => {
    const pop = read('EditRolesPopover.tsx');
    expect(pop).toMatch(/RoleChecklist/);
    expect(pop).toMatch(/>\s*Lưu\s*</);
  });
});

describe('RoleChecklist — vai trò bị khoá', () => {
  const out = renderToStaticMarkup(
    <RoleChecklist
      options={[
        { id: 'r-admin', name: 'Workspace Admin' },
        { id: 'r-member', name: 'Workspace Member' },
      ]}
      value={['r-admin']}
      onChange={() => undefined}
      locked={{ 'r-admin': 'Lý do khoá' }}
    />,
  );
  it('dòng bị khoá: aria-disabled, vẫn focus được, lý do hiện và được đọc (aria-describedby)', () => {
    expect(out).toMatch(/aria-disabled="true"/);
    const id = /aria-describedby="([^"]+)"/.exec(out)![1]!;
    expect(out).toMatch(new RegExp(`id="${id}"[^>]*>[^]*Lý do khoá`));
    expect(out).not.toMatch(/<button[^>]*aria-disabled[^>]*disabled=""/);
  });
  it('dòng không bị khoá không có aria-disabled', () => {
    expect(out.match(/aria-disabled/g)).toHaveLength(1);
  });
});
