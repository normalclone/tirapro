import { describe, expect, it } from 'vitest';
import { MENU_LABELS, issueMenuModel, type IssueMenuInput, type MenuEntry } from './issueMenuModel';

const base: IssueMenuInput = {
  surface: 'board',
  hasPeek: true,
  canEdit: true,
  canTransition: true,
  canDelete: false,
  isMine: false,
  statusOptions: 2,
  priorityOptions: 5,
  sprintOptions: 3,
};
const ids = (m: MenuEntry[]) => m.map((e) => (e.kind === 'separator' ? '|' : e.id));

describe('issueMenuModel — mục nào hiện cho ai, ở bề mặt nào', () => {
  it('người ghi đầy đủ trên Bảng việc (không quyền xoá): đúng thứ tự, nhóm ngăn bằng đường kẻ', () => {
    expect(ids(issueMenuModel(base))).toEqual([
      'peek',
      'open',
      'openTab',
      '|',
      'copyKey',
      'copyLink',
      '|',
      'assignMe',
      'status',
      'priority',
    ]);
  });
  it('Việc chờ có thêm "Chuyển sprint"; các bề mặt khác thì không', () => {
    expect(ids(issueMenuModel({ ...base, surface: 'backlog' }))).toContain('sprint');
    for (const surface of ['board', 'filters', 'tree'] as const)
      expect(ids(issueMenuModel({ ...base, surface }))).not.toContain('sprint');
  });
  it('có quyền xoá → "Xoá" ở nhóm cuối, tách bằng đường kẻ', () => {
    const m = ids(issueMenuModel({ ...base, canDelete: true }));
    expect(m.slice(-2)).toEqual(['|', 'delete']);
  });
  it('người chỉ xem: chỉ mục điều hướng + sao chép (mục ghi bị ẨN, không hiện vô hiệu)', () => {
    const m = issueMenuModel({
      ...base,
      surface: 'backlog',
      canEdit: false,
      canTransition: false,
      canDelete: false,
    });
    expect(ids(m)).toEqual(['peek', 'open', 'openTab', '|', 'copyKey', 'copyLink']);
    expect(m.some((e) => e.kind === 'sub')).toBe(false);
  });
  it('việc của mình → không có "Gán cho tôi"', () => {
    expect(ids(issueMenuModel({ ...base, isMine: true }))).not.toContain('assignMe');
  });
  it('không có quyền sửa → ẩn Gán cho tôi, Ưu tiên, Chuyển sprint nhưng vẫn có Đổi trạng thái nếu có quyền chuyển', () => {
    const m = ids(issueMenuModel({ ...base, surface: 'backlog', canEdit: false }));
    expect(m).not.toContain('assignMe');
    expect(m).not.toContain('priority');
    expect(m).not.toContain('sprint');
    expect(m).toContain('status');
  });
  it('menu con RỖNG nhưng được phép → hiện nhưng vô hiệu; không được phép → ẩn hẳn', () => {
    const m = issueMenuModel({ ...base, statusOptions: 0, priorityOptions: 0 });
    const sub = (id: string) => m.find((e) => e.kind === 'sub' && e.id === id);
    expect(sub('status')).toMatchObject({ disabled: true });
    expect(sub('priority')).toMatchObject({ disabled: true });
    expect(sub('status')).toBeDefined();
    const none = issueMenuModel({ ...base, canTransition: false });
    expect(none.some((e) => e.kind === 'sub' && e.id === 'status')).toBe(false);
  });
  it('menu con có lựa chọn → không vô hiệu', () => {
    const m = issueMenuModel({ ...base, surface: 'backlog' });
    for (const e of m) if (e.kind === 'sub') expect(e.disabled).toBe(false);
  });
  it('bề mặt không có xem nhanh → không có "Xem nhanh"', () => {
    expect(ids(issueMenuModel({ ...base, hasPeek: false }))[0]).toBe('open');
  });
  it('không bao giờ có đường kẻ đầu/cuối/liền nhau', () => {
    const combos: Partial<IssueMenuInput>[] = [
      {},
      { canEdit: false, canTransition: false },
      { canDelete: true, canEdit: false, canTransition: false },
      { hasPeek: false },
      { surface: 'backlog', canDelete: true },
      { canEdit: false, canTransition: false, canDelete: true, hasPeek: false },
    ];
    for (const c of combos) {
      const m = ids(issueMenuModel({ ...base, ...c }));
      expect(m[0]).not.toBe('|');
      expect(m[m.length - 1]).not.toBe('|');
      expect(m.join(',')).not.toContain('|,|');
    }
  });
  it('nhãn đúng chuỗi của kiểm kê', () => {
    expect(MENU_LABELS).toEqual({
      peek: 'Xem nhanh',
      open: 'Mở trang',
      openTab: 'Mở ở tab mới',
      copyKey: 'Sao chép mã',
      copyLink: 'Sao chép liên kết',
      assignMe: 'Gán cho tôi',
      status: 'Đổi trạng thái',
      priority: 'Ưu tiên',
      sprint: 'Chuyển sprint',
      delete: 'Xoá',
    });
    const m = issueMenuModel({ ...base, surface: 'backlog', canDelete: true });
    for (const e of m) if (e.kind !== 'separator') expect(e.label).toBe(MENU_LABELS[e.id]);
  });
});
