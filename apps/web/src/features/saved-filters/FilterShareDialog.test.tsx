// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ApiModule from '@/lib/api';
import type { SavedFilter } from './api';
import { filterChecklist } from './ShareChecklist';

const h = vi.hoisted(() => ({ get: vi.fn(), patch: vi.fn() }));
vi.mock('@/lib/api', async (orig) => {
  const real = await orig<typeof ApiModule>();
  return { ...real, api: { get: h.get, patch: h.patch } };
});
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { useAuth } from '@/stores/auth';
import { FilterShareDialog } from './FilterShareDialog';

const user = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  id,
  email: `${id}@x.vn`,
  displayName: name,
  avatarUrl: null,
  status: 'ACTIVE',
  ...extra,
});
const member = (u: ReturnType<typeof user>) => ({ membershipId: `m-${u.id}`, user: u, roles: [] });
const U = {
  me: user('me', 'Tôi'),
  an: user('an', 'Nguyễn An'),
  binh: user('binh', 'Trần Bình'),
  chi: user('chi', 'Lê Chi'),
  off: user('off', 'Đã nghỉ', { status: 'DEACTIVATED' }),
};
const projects = [
  { id: 'p1', key: 'HR', name: 'Nhân sự', isArchived: false },
  { id: 'p2', key: 'QA', name: 'Kiểm thử', isArchived: false },
  { id: 'p3', key: 'OLD', name: 'Dự án cũ', isArchived: true },
];
const projectMembers: Record<string, ReturnType<typeof member>[]> = {
  p1: [member(U.me), member(U.an), member(U.binh)],
  p2: [member(U.an), member(U.chi), member(U.off)], // An trùng với p1
};

const OWN: SavedFilter = {
  id: 'f1',
  name: 'Bug tuần này',
  jql: 'type = Bug',
  visibility: 'PRIVATE',
  ownerId: 'me',
  isOwner: true,
  access: 'owner',
  owner: { id: 'me', displayName: 'Tôi', avatarUrl: null },
  sharedProjects: [],
  sharedUsers: [],
  createdAt: '2026-11-01T00:00:00.000Z',
};

beforeEach(() => {
  h.get.mockReset();
  h.patch.mockReset();
  h.get.mockImplementation((url: string) => {
    if (url === '/projects') return Promise.resolve({ data: projects });
    if (url === '/members')
      return Promise.resolve({ data: [U.me, U.an, U.binh, U.chi, U.off].map(member) });
    const m = /^\/projects\/(\w+)\/members$/.exec(url);
    if (m) return Promise.resolve({ data: projectMembers[m[1]!] ?? [] });
    return Promise.reject(new Error(`offline ${url}`));
  });
  h.patch.mockImplementation((_u: string, body: unknown) =>
    Promise.resolve({ data: { ...OWN, ...(body as object) } }),
  );
  useAuth.setState({ user: { id: 'me', isSystemAdmin: false } as never });
});
afterEach(cleanup);

function renderDialog(filter: SavedFilter, canManage = true) {
  const onClose = vi.fn();
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <FilterShareDialog filter={filter} canManage={canManage} onClose={onClose} />
    </QueryClientProvider>,
  );
  return { user: userEvent.setup(), onClose };
}

describe('hộp "Chia sẻ bộ lọc" — chọn nhiều dự án + nhiều người', () => {
  it('mặc định "Chỉ mình tôi": không có danh sách chọn, nút Lưu tắt; chọn "Chia sẻ" hiện hai danh sách (không có dự án lưu trữ, không có chính mình/người đã nghỉ)', async () => {
    const { user } = renderDialog(OWN);
    const dialog = await screen.findByRole('dialog', { name: /Chia sẻ bộ lọc/ });
    expect(
      within(dialog).getByRole('radio', { name: 'Chỉ mình tôi' }).getAttribute('aria-checked'),
    ).toBe('true');
    expect(within(dialog).queryByRole('group', { name: /Dự án/ })).toBeNull();
    expect(within(dialog).getByRole('button', { name: 'Lưu' }).hasAttribute('disabled')).toBe(true);

    await user.click(within(dialog).getByRole('radio', { name: 'Chia sẻ' }));
    const proj = await within(dialog).findByRole('group', { name: /Dự án/ });
    expect(
      within(proj)
        .getAllByRole('checkbox')
        .map((c) => c.closest('label')!.textContent),
    ).toEqual([expect.stringContaining('Nhân sự'), expect.stringContaining('Kiểm thử')]);
    const people = within(dialog).getByRole('group', { name: /Người cụ thể/ });
    await waitFor(() => expect(within(people).getAllByRole('checkbox')).toHaveLength(3));
    const text = people.textContent;
    expect(text).toContain('Nguyễn An');
    expect(text).not.toContain('Tôi');
    expect(text).not.toContain('Đã nghỉ');
    // Chia sẻ mà chưa chọn gì: báo lỗi rõ + Lưu tắt
    expect(within(dialog).getByRole('alert').textContent).toBe(
      'Chọn ít nhất một dự án hoặc một người để chia sẻ',
    );
    expect(within(dialog).getByRole('button', { name: 'Lưu' }).hasAttribute('disabled')).toBe(true);
  });

  it('chọn 2 dự án + 2 người: "Ai có quyền xem" là HỢP không trùng, không tính mình/người đã nghỉ; Lưu gửi đủ ba trường', async () => {
    const { user, onClose } = renderDialog(OWN);
    const dialog = await screen.findByRole('dialog', { name: /Chia sẻ bộ lọc/ });
    await user.click(within(dialog).getByRole('radio', { name: 'Chia sẻ' }));
    const proj = await within(dialog).findByRole('group', { name: /Dự án/ });
    await user.click(within(proj).getByRole('checkbox', { name: /Nhân sự/ }));
    await user.click(within(proj).getByRole('checkbox', { name: /Kiểm thử/ }));
    const people = within(dialog).getByRole('group', { name: /Người cụ thể/ });
    await waitFor(() => expect(within(people).getAllByRole('checkbox').length).toBeGreaterThan(0));
    await user.click(within(people).getByRole('checkbox', { name: /Nguyễn An/ })); // trùng thành viên 2 dự án
    await user.click(within(people).getByRole('checkbox', { name: /Lê Chi/ })); // trùng thành viên p2

    // Hợp = An, Bình (p1) + An, Chi (p2) + An, Chi (chọn riêng), bỏ chính mình và người đã nghỉ → {An, Bình, Chi} = 3
    await waitFor(() =>
      expect(within(dialog).getByRole('region', { name: 'Ai có quyền xem' }).textContent).toContain(
        '3 người xem được',
      ),
    );
    expect(within(dialog).queryByRole('alert')).toBeNull();

    await user.click(within(dialog).getByRole('button', { name: 'Lưu' }));
    await waitFor(() => expect(h.patch).toHaveBeenCalledTimes(1));
    expect(h.patch.mock.calls[0]![0]).toBe('/filters/f1');
    expect(h.patch.mock.calls[0]![1]).toEqual({
      visibility: 'SHARED',
      sharedProjectIds: ['p1', 'p2'],
      sharedUserIds: ['an', 'chi'],
    });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('bộ lọc đang chia sẻ: mở ra đã tích sẵn; bỏ hết về "Chỉ mình tôi" → PATCH PRIVATE với hai danh sách rỗng', async () => {
    const shared: SavedFilter = {
      ...OWN,
      visibility: 'SHARED',
      sharedProjects: [{ id: 'p1', key: 'HR', name: 'Nhân sự' }],
      sharedUsers: [{ id: 'binh', displayName: 'Trần Bình', avatarUrl: null }],
    };
    const { user } = renderDialog(shared);
    const dialog = await screen.findByRole('dialog', { name: /Chia sẻ bộ lọc/ });
    const proj = await within(dialog).findByRole('group', { name: /Dự án/ });
    expect(within(proj).getByRole<HTMLInputElement>('checkbox', { name: /Nhân sự/ }).checked).toBe(
      true,
    );
    expect(within(dialog).getByRole('button', { name: 'Lưu' }).hasAttribute('disabled')).toBe(true); // chưa đổi gì
    await user.click(within(dialog).getByRole('radio', { name: 'Chỉ mình tôi' }));
    await user.click(within(dialog).getByRole('button', { name: 'Lưu' }));
    await waitFor(() => expect(h.patch).toHaveBeenCalled());
    expect(h.patch.mock.calls[0]![1]).toEqual({
      visibility: 'PRIVATE',
      sharedProjectIds: [],
      sharedUserIds: [],
    });
  });

  it('người không phải chủ: chỉ xem (không radio, không Lưu), thấy tên chủ + dự án họ có quyền, vẫn sao chép được liên kết', async () => {
    const theirs: SavedFilter = {
      ...OWN,
      isOwner: false,
      access: 'shared',
      visibility: 'SHARED',
      ownerId: 'an',
      owner: { id: 'an', displayName: 'Nguyễn An', avatarUrl: null },
      sharedProjects: [{ id: 'p1', key: 'HR', name: 'Nhân sự' }],
      sharedUsers: [],
    };
    renderDialog(theirs);
    const dialog = await screen.findByRole('dialog', { name: /Chia sẻ bộ lọc/ });
    expect(within(dialog).queryByRole('radio')).toBeNull();
    expect(within(dialog).queryByRole('button', { name: 'Lưu' })).toBeNull();
    expect(dialog.textContent).toContain('Nguyễn An chia sẻ cho bạn');
    expect(dialog.textContent).toContain('Nhân sự');
    expect(within(dialog).getByRole('button', { name: /Sao chép liên kết/ })).toBeTruthy();
    expect(dialog.textContent?.toLowerCase()).not.toContain('workspace');
    expect(dialog.textContent).not.toContain('không gian làm việc');
  });
});

describe('filterChecklist', () => {
  const items = [
    { id: 'a', label: 'Nguyễn An', hint: 'an@x.vn' },
    { id: 'b', label: 'Trần Bình', hint: 'binh@x.vn' },
  ];
  it('tìm không phân biệt dấu/hoa thường theo tên hoặc dòng phụ; mục đã chọn luôn còn dù không khớp', () => {
    expect(filterChecklist(items, 'nguyen', new Set()).map((i) => i.id)).toEqual(['a']);
    expect(filterChecklist(items, 'BINH@x', new Set()).map((i) => i.id)).toEqual(['b']);
    expect(filterChecklist(items, 'zzz', new Set(['a'])).map((i) => i.id)).toEqual(['a']);
    expect(filterChecklist(items, '', new Set()).map((i) => i.id)).toEqual(['a', 'b']);
  });
});
