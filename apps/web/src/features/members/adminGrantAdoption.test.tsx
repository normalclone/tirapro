import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RoleChecklist } from '@/components/ui/RoleMultiSelect';
import { ADMIN_GRANT_REASON } from './adminGrant';

const SRC = join(__dirname, '../..');
const src = (rel: string) => readFileSync(join(SRC, rel), 'utf8');

describe('P-C14 trên giao diện: khoá điều khiển quản trị cho người không phải quản trị', () => {
  it('RoleChecklist: vai trò frozen hiện lý do, aria-disabled, kể cả khi CHƯA được chọn', () => {
    const html = renderToStaticMarkup(
      <RoleChecklist
        options={[
          { id: 'm', name: 'Workspace Member' },
          { id: 'a', name: 'Workspace Admin' },
        ]}
        value={['m']}
        onChange={() => undefined}
        frozen={{ a: ADMIN_GRANT_REASON }}
        autoFocusSearch={false}
      />,
    );
    expect(html).toContain(ADMIN_GRANT_REASON);
    expect((html.match(/aria-disabled="true"/g) ?? []).length).toBe(1);
  });

  it('danh sách vai trò thành viên (inline), thêm người, thêm hàng loạt đều truyền frozen từ frozenAdminRoles', () => {
    const cell = src('features/members/MemberRolesCell.tsx');
    expect(cell).toContain('frozen: frozenAdminRoles(canGrantAdmin, adminIds)');
    expect(src('features/members/EditRolesPopover.tsx')).toContain('frozen={instant.frozen}');
    const choice = src('features/members/useWorkspaceRoleChoice.ts');
    expect(choice).toContain('frozenAdminRoles(canGrantAdmin');
    const add = src('features/members/AddMemberPanel.tsx');
    expect((add.match(/frozen=\{frozen\}/g) ?? []).length).toBe(2);
    expect(src('features/members/AddPeopleDialog.tsx')).toContain('frozen={frozen}');
  });

  it('chọn bằng bộ chọn boolean (không đăng ký cả hàm can)', () => {
    for (const f of [
      'features/members/MemberRolesCell.tsx',
      'features/members/useWorkspaceRoleChoice.ts',
      'features/members/AddPeopleDialog.tsx',
      'features/settings/RoleMatrixTable.tsx',
      'features/settings/RolesPage.tsx',
      'features/settings/useRolePermEditor.ts',
    ]) {
      const s = src(f);
      expect(s).toContain("useAuth((s) => s.can('workspace:admin'))");
      expect(s).not.toMatch(/useAuth\(\(s\) => s\.can\)/);
    }
  });

  it('ma trận quyền: khoá ô quyền quản trị + ô của vai trò đang giữ nó, có ghi chú lý do; nhân bản khoá; bộ chốt nhận callerIsAdmin', () => {
    const grid = src('features/settings/RoleMatrixGrid.tsx');
    expect(grid).toContain('permLockedForAdminGrant(');
    expect(grid).toContain('groupLockedForAdminGrant(');
    expect(grid).toContain('roleLockedForAdminGrant(');
    expect(grid).toContain('describedBy={role.isSystem ? env.lockNoteId : env.adminNoteId}');
    expect(src('features/settings/RoleMatrixTable.tsx')).toContain('{ADMIN_GRANT_REASON}');
    const editor = src('features/settings/useRolePermEditor.ts');
    expect(editor).toContain('callerIsAdmin: l.callerIsAdmin');
    // hộp xác nhận cấp quản trị của người là quản trị vẫn còn
    expect(editor).toContain('grantAdminCopy(');
  });

  it('hộp thoại vai trò: ô workspace:admin bị vô hiệu kèm lý do; sửa vai trò đang giữ quản trị là chỉ xem; nhân bản không gửi được', () => {
    const page = src('features/settings/RolesPage.tsx');
    expect(page).toContain('roleLockedForAdminGrant(canGrantAdmin, role?.permissionKeys ?? [])');
    expect(page).toContain('disabled={readOnly || adminLocked}');
    expect(page).toContain('!readOnly && !needsAdminToSubmit');
    expect(page).toContain('{ADMIN_GRANT_REASON}');
  });

  it('thông báo lỗi 403 ADMIN_GRANT_REQUIRES_ADMIN có câu tiếng Việt riêng', () => {
    expect(src('lib/api.ts')).toContain(
      "ADMIN_GRANT_REQUIRES_ADMIN: 'Chỉ quản trị không gian làm việc mới cấp hoặc gỡ quyền quản trị.'",
    );
  });
});
