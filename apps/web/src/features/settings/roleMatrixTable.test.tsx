import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { roleLabel, type MemberDto, type RoleDto } from '@tirapro/types';
import { keys } from '@/lib/queryKeys';
import { RoleMatrixTable } from './RoleMatrixTable';
import { GroupCell, PermCell } from './RoleMatrixCells';

// renderToStaticMarkup đọc "trạng thái khởi tạo" của zustand → thay kho bằng bản chỉ-đọc-state (như sharePanel.test).
vi.mock('@/stores/auth', () => {
  let state: Record<string, unknown> = {};
  const useAuth = Object.assign(<T,>(sel: (s: Record<string, unknown>) => T) => sel(state), {
    setState: (p: Record<string, unknown>) => {
      state = { ...state, ...p };
    },
    getState: () => state,
  });
  return { useAuth };
});
import { useAuth } from '@/stores/auth';

const src = (f: string) => readFileSync(join(__dirname, f), 'utf8');

const role = (id: string, name: string, isSystem: boolean, permissionKeys: string[]) =>
  ({
    id,
    name,
    scope: 'PROJECT',
    isSystem,
    permissionKeys,
    memberCount: 2,
    updatedAt: '2026-10-20T03:00:00.000Z',
  }) as unknown as RoleDto;

const ROLES = [
  role('s1', 'Scrum Master', true, ['issue:create', 'sprint:manage']),
  role('c1', 'QA Lead', false, ['issue:create']),
];
const MEMBERS = [
  {
    membershipId: 'm1',
    user: { id: 'me', displayName: 'Tôi', email: 'me@x', status: 'ACTIVE' },
    roles: [{ id: 's1', name: 'Scrum Master' }],
  },
] as unknown as MemberDto[];

function render(opts: { canEdit: boolean; members?: MemberDto[]; roles?: RoleDto[] }) {
  const qc = new QueryClient();
  if (opts.members) qc.setQueryData(keys.members.workspace, opts.members);
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}>
      <RoleMatrixTable
        roles={opts.roles ?? ROLES}
        canEdit={opts.canEdit}
        onClone={() => undefined}
      />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  useAuth.setState({
    user: { id: 'me', isSystemAdmin: false } as never,
    workspaceId: 'w1',
    permissions: [],
    can: () => true, // mặc định người sửa là quản trị (P-C14: luật khoá chỉ áp khi KHÔNG phải quản trị)
  });
});

describe('RoleMatrixTable — chỉnh được', () => {
  it('ô của vai trò tuỳ chỉnh là nút bật/tắt: aria-pressed + tên "{quyền} — {vai trò}"', () => {
    const h = render({ canEdit: true, members: MEMBERS });
    expect(h).toMatch(/<button[^>]*aria-pressed="true"[^>]*aria-label="[^"]+ — QA Lead"/);
    expect(h).toMatch(/aria-pressed="false"[^>]*aria-label="[^"]+ — QA Lead"/);
  });

  it('ô của vai trò hệ thống bị khoá: aria-disabled, biểu tượng ổ khoá, lý do (hiện trên bảng + mô tả của ô)', () => {
    const h = render({ canEdit: true, members: MEMBERS });
    const m = h.match(
      new RegExp(`<button[^>]*aria-label="[^"]+ — ${roleLabel('Scrum Master')}"[^>]*>`),
    );
    expect(m?.[0]).toContain('aria-disabled="true"');
    // Lý do chỉ qua MỘT đường (aria-describedby) — không kèm title cùng nội dung (đọc hai lần).
    expect(m?.[0]).not.toContain('title=');
    const describedBy = m?.[0].match(/aria-describedby="([^"]+)"/)?.[1];
    expect(describedBy).toBeTruthy();
    expect(h).toContain(`id="${describedBy}"`);
    expect(h).toContain('Vai trò hệ thống không sửa được — nhân bản để tuỳ chỉnh');
    expect(h).toContain('lucide-lock');
  });

  it('roving tabindex: cả lưới chỉ MỘT điểm dừng Tab (ô đầu); mọi ô có toạ độ', () => {
    const h = render({ canEdit: true, members: MEMBERS });
    const cells = h.match(/<button[^>]*data-r="\d+"[^>]*>/g) ?? [];
    expect(cells.length).toBeGreaterThan(10);
    expect(cells.filter((c) => c.includes('tabindex="0"'))).toHaveLength(1);
    expect(cells[0]).toContain('tabindex="0"');
  });

  it('bảng giữ tiêu đề đúng: cột scope=col, dòng scope=row, có caption', () => {
    const h = render({ canEdit: true, members: MEMBERS });
    expect(h).toContain('<caption');
    expect(h).toMatch(/<th scope="col"/);
    expect(h).toMatch(/<th scope="row"/);
  });

  it('nút "Nhân bản vai trò" cho từng cột, tên truy cập chứa chữ nhìn thấy + tên vai trò', () => {
    const h = render({ canEdit: true, members: MEMBERS });
    expect(h).toContain(
      `Nhân bản<span class="sr-only"> vai trò ${roleLabel('Scrum Master')}</span>`,
    );
    expect(h).toContain('vai trò QA Lead</span>');
  });

  it('cột "Khoá" nhìn thấy cho vai trò hệ thống (không chỉ dựa vào ổ khoá nhỏ trong ô)', () => {
    expect(render({ canEdit: true, members: MEMBERS })).toContain('Khoá');
  });

  it('công tắc "Gộp theo nhóm" có mặt, mặc định tắt', () => {
    expect(render({ canEdit: true, members: MEMBERS })).toMatch(
      /role="switch"[^>]*aria-checked="false"[^>]*aria-label="Gộp theo nhóm"|aria-checked="false"[^>]*aria-label="Gộp theo nhóm"/,
    );
  });
});

describe('RoleMatrixTable — chỉ đọc / chưa đủ điều kiện sửa', () => {
  it('không có member:manage → ô chỉ đọc (role=img), không nút ô, không nút nhân bản', () => {
    const h = render({ canEdit: false, members: MEMBERS });
    expect(h).toContain('role="img"');
    expect(h).not.toMatch(/data-r="\d+"/);
    expect(h).not.toContain('Nhân bản');
    expect(h).not.toContain('Bấm một ô của vai trò tuỳ chỉnh');
  });

  it('có quyền nhưng danh sách thành viên chưa tải → nút VÔ HIỆU cùng kích thước (bảng không giãn khi tải xong), không điểm dừng Tab, nói rõ vì sao', () => {
    const h = render({ canEdit: true });
    const cells = h.match(/<button[^>]*data-r="\d+"[^>]*>/g) ?? [];
    expect(cells.length).toBeGreaterThan(10);
    expect(cells.every((c) => c.includes('disabled=""') && c.includes('tabindex="-1"'))).toBe(true);
    expect(cells.some((c) => c.includes('h-8'))).toBe(true);
    expect(h).toContain('Đang tải danh sách thành viên để kiểm tra quyền thiết yếu');
    // tiêu đề cột giữ nguyên chiều cao: nhãn "Khoá" + nút nhân bản có sẵn
    expect(h).toContain('Khoá');
    expect(h).toContain('Nhân bản');
    // chưa phải ô khoá: không ổ khoá trong ô
    expect(cells.some((c) => c.includes('aria-disabled'))).toBe(false);
  });
});

describe('ô nhóm 3 trạng thái', () => {
  const base = {
    label: 'Công việc — QA Lead',
    pos: { r: 0, c: 0 },
    tabIndex: 0 as const,
    locked: false,
    onToggle: () => undefined,
  };
  it('aria-pressed true / mixed / false và chữ n/N (không chỉ màu)', () => {
    const html = (state: 'full' | 'partial' | 'none', count: number) =>
      renderToStaticMarkup(<GroupCell {...base} g={{ state, count, total: 5 }} />);
    expect(html('full', 5)).toContain('aria-pressed="true"');
    expect(html('partial', 2)).toContain('aria-pressed="mixed"');
    expect(html('none', 0)).toContain('aria-pressed="false"');
    expect(html('partial', 2)).toContain('2/5');
    expect(html('full', 5)).toContain('5/5');
  });
  it('tên ô nhóm KHÔNG chứa số đếm; số đếm đọc qua aria-describedby (aria-pressed đã nói trạng thái)', () => {
    const h = renderToStaticMarkup(
      <GroupCell {...base} g={{ state: 'partial', count: 2, total: 5 }} />,
    );
    expect(h).toContain('aria-label="Công việc — QA Lead"');
    const id = h.match(/aria-describedby="([^"]+)"/)?.[1];
    expect(id).toBeTruthy();
    expect(h).toContain(`id="${id}"`);
    expect(h).toContain('2/5');
  });
  it('ô nhóm khoá: mô tả gồm cả số đếm và lý do khoá; không title', () => {
    const h = renderToStaticMarkup(
      <GroupCell
        {...base}
        locked
        describedBy="lock-note"
        g={{ state: 'partial', count: 2, total: 5 }}
      />,
    );
    expect(h).toMatch(/aria-describedby="[^"]+ lock-note"/);
    expect(h).not.toContain('title=');
  });
  it('ô khoá vẫn nêu trạng thái, không có onClick xử lý (aria-disabled)', () => {
    const h = renderToStaticMarkup(
      <GroupCell {...base} locked g={{ state: 'partial', count: 1, total: 3 }} />,
    );
    expect(h).toContain('aria-disabled="true"');
    expect(h).toContain('aria-pressed="mixed"');
  });
  it('PermCell: nút 44px trên cảm ứng', () => {
    const h = renderToStaticMarkup(<PermCell {...base} on />);
    expect(h).toContain('[@media(pointer:coarse)]:h-11');
    expect(h).toContain('[@media(pointer:coarse)]:min-w-11');
  });
});

describe('quy ước nguồn', () => {
  it('không dùng selector hàm ổn định useAuth(s=>s.can) (P-C12); dùng selector boolean', () => {
    for (const f of ['RoleMatrixTable.tsx', 'useRolePermEditor.ts', 'RolesPage.tsx']) {
      expect(src(f)).not.toMatch(/useAuth\(\s*\(?\s*s\s*\)?\s*=>\s*s\.can\s*\)/);
    }
    expect(src('RolesPage.tsx')).toContain("useAuth((s) => s.can('member:manage'))");
  });
  it('409: chữ toast đúng yêu cầu và gom bấm ~500ms', () => {
    const hook = src('useRolePermEditor.ts');
    expect(hook).toContain("'Vai trò vừa được người khác sửa — đã tải lại'");
    expect(hook).toContain('const FLUSH_DELAY_MS = 500');
  });
  it('lưới kẹp ô đang chọn theo kích thước hiện tại lúc vẽ (không còn lưới 0 điểm dừng Tab)', () => {
    const grid = src('RoleMatrixGrid.tsx');
    expect(grid).toContain('isTabStop(nav.active, size, r, c)');
    expect(grid).toContain('clampCell(active, size)');
  });
  it('toast nằm trong hook (try/catch quanh mutate), không ở callback từng lần gọi', () => {
    const hook = src('useRolePermEditor.ts');
    expect(hook).toContain('toastReplace');
    expect(hook).not.toMatch(/\.mutate\([^)]*onError/);
    expect(hook).toMatch(/await observerFor\(id\)\.mutate/);
  });
});

describe('RoleMatrixTable — người chỉ có member:manage (không phải quản trị), P-C14', () => {
  const ADMIN_ROLES = [
    ...ROLES,
    role('c2', 'Điều hành', false, ['issue:create', 'workspace:admin']),
  ];
  const asNonAdmin = () =>
    useAuth.setState({ can: (p: string) => p !== 'workspace:admin' } as never);

  it('khoá MỌI ô của vai trò đang giữ workspace:admin, có ghi chú lý do và mô tả trỏ vào ghi chú', () => {
    asNonAdmin();
    const h = render({ canEdit: true, members: MEMBERS, roles: ADMIN_ROLES });
    expect(h).toContain('Chỉ quản trị mới cấp/gỡ quyền này');
    const cellsOfAdminRole = h.match(/<button[^>]*aria-label="[^"]+ — Điều hành"[^>]*>/g) ?? [];
    expect(cellsOfAdminRole.length).toBeGreaterThan(0);
    for (const c of cellsOfAdminRole) expect(c).toContain('aria-disabled="true"');
    // vai trò tuỳ chỉnh KHÔNG dính quản trị vẫn sửa được
    const qaCells = h.match(/<button[^>]*aria-label="[^"]+ — QA Lead"[^>]*>/g) ?? [];
    expect(qaCells.length).toBeGreaterThan(0);
    for (const c of qaCells) expect(c).not.toContain('aria-disabled');
  });

  it('nút "Nhân bản" của vai trò đang giữ quản trị khoá kèm lý do; các cột khác nguyên vẹn', () => {
    asNonAdmin();
    const h = render({ canEdit: true, members: MEMBERS, roles: ADMIN_ROLES });
    const clones =
      h.match(/<button[^>]*>(?:(?!<\/button>).)*Nhân bản(?:(?!<\/button>).)*<\/button>/g) ?? [];
    expect(clones).toHaveLength(3);
    expect(clones.filter((c) => c.includes('aria-disabled="true"'))).toHaveLength(1);
  });

  it('quản trị: không khoá gì thêm, không có ghi chú lý do', () => {
    const h = render({ canEdit: true, members: MEMBERS, roles: ADMIN_ROLES });
    expect(h).not.toContain('Chỉ quản trị mới cấp/gỡ quyền này');
  });
});
