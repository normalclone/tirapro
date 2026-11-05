// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ApiModule from '@/lib/api';

const h = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  patch: vi.fn(),
  del: vi.fn(),
}));
vi.mock('@/lib/api', async (orig) => {
  const real = await orig<typeof ApiModule>();
  return { ...real, api: { get: h.get, post: h.post, put: h.put, patch: h.patch, delete: h.del } };
});
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));
vi.mock('@/features/projects/permissions', () => ({ useCan: () => () => true }));
vi.mock('@/features/members/AddPeopleDialog', () => ({ AddPeopleDialog: () => null }));

import { toast } from 'sonner';
import { ConfirmHost, useConfirmStore } from '@/components/ui/useConfirm';
import { MembersSection, memberTabFromParam, type MemberTab } from './MembersSection';
import { unlinkConsequence } from './ProjectTeamsPanel';

const user = (id: string, displayName: string) => ({
  id,
  email: `${id}@x.vn`,
  displayName,
  avatarUrl: null,
  timezone: 'UTC',
  locale: 'vi',
  status: 'ACTIVE',
});
const QA = { id: 't1', name: 'QA' };
const MEMBERS = [
  {
    // chỉ nhờ team + vai trò mặc định theo tổ chức (dự án công khai)
    membershipId: 'm1',
    user: user('u1', 'An'),
    isOverride: true,
    roles: [
      { id: 'rRep', name: 'Reporter', color: null, direct: false, teams: [QA] },
      { id: 'rDev', name: 'Developer', color: null },
    ],
  },
  {
    membershipId: 'm2',
    user: user('u2', 'Bình'),
    isOverride: true,
    roles: [{ id: 'rDev', name: 'Developer', color: null, direct: true, teams: [QA] }],
  },
  {
    membershipId: 'm3',
    user: user('u3', 'Chi'),
    isOverride: false,
    roles: [{ id: 'rDev', name: 'Developer', color: null }],
  },
];
const ROLES = [
  { id: 'rRep', name: 'Reporter', color: null },
  { id: 'rDev', name: 'Developer', color: null },
];
const LINKS = [
  {
    id: 'l1',
    projectId: 'p1',
    teamId: 't1',
    team: { id: 't1', name: 'QA', key: 'qa', color: '#3b82f6', memberCount: 2 },
    roles: [{ id: 'rRep', name: 'Reporter', color: null }],
    createdAt: '2026-01-01',
  },
];
const SUBTEAMS = [
  {
    id: 's1',
    projectId: 'p1',
    name: 'Kiểm thử',
    color: '#22c55e',
    members: [{ id: 'u1', displayName: 'An', avatarUrl: null }],
    memberCount: 1,
    createdAt: '2026-01-01',
  },
];

function route(path: string, data: unknown) {
  h.get.mockImplementation((url: string) => {
    const map: Record<string, unknown> = {
      '/projects/p1/members': MEMBERS,
      '/roles?scope=PROJECT': ROLES,
      '/projects/p1/teams': LINKS,
      '/projects/p1/sub-teams': SUBTEAMS,
      '/teams': [
        { id: 't1', name: 'QA', key: 'qa', memberCount: 2, members: [] },
        { id: 't2', name: 'Dev', key: 'dev', memberCount: 3, members: [] },
      ],
      [path]: data,
    };
    return Promise.resolve({ data: map[url] ?? [] });
  });
}

function setup(tab?: MemberTab, isPrivate = false) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/p/DEMO/config/members${tab ? `?tab=${tab}` : ''}`]}>
        <MembersSection projectId="p1" isPrivate={isPrivate} />
      </MemoryRouter>
      <ConfirmHost />
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

beforeEach(() => {
  Object.defineProperty(Element.prototype, 'hasPointerCapture', {
    value: () => false,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(Element.prototype, 'scrollIntoView', {
    value: () => undefined,
    configurable: true,
    writable: true,
  });
  globalThis.ResizeObserver ??= class {
    observe = () => undefined;
    unobserve = () => undefined;
    disconnect = () => undefined;
  } as never;
  useConfirmStore.setState({ open: false, opts: null, resolve: null });
  for (const m of [h.get, h.post, h.put, h.patch, h.del]) m.mockReset();
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
  route('/', []);
  act(() => undefined);
});
afterEach(cleanup);

describe('memberTabFromParam', () => {
  it('chỉ nhận ba tab hợp lệ, còn lại về "Thành viên"', () => {
    expect(memberTabFromParam('teams')).toBe('teams');
    expect(memberTabFromParam('sub-teams')).toBe('sub-teams');
    expect(memberTabFromParam('x')).toBe('members');
    expect(memberTabFromParam(null)).toBe('members');
  });
});

describe('unlinkConsequence', () => {
  it('dự án riêng tư: người chỉ nhờ team sẽ rời dự án; người còn vai trò khác chỉ mất bớt', () => {
    const text = unlinkConsequence(MEMBERS as never, 't1', true);
    expect(text).toContain('An sẽ không còn ở dự án');
    expect(text).toContain('Bình chỉ mất phần vai trò nhờ team này');
  });
  it('dự án công khai: người chỉ nhờ team quay về vai trò mặc định theo tổ chức', () => {
    expect(unlinkConsequence(MEMBERS as never, 't1', false)).toContain(
      'An sẽ quay về vai trò mặc định theo tổ chức',
    );
    expect(unlinkConsequence(MEMBERS as never, 'khac', false)).toBe(
      'Không ai bị ảnh hưởng ngay lúc này.',
    );
  });
});

describe('Thành viên dự án: nguồn của từng vai trò', () => {
  it('hiện "qua Team QA", "mặc định theo tổ chức", "trực tiếp + qua Team QA"; thành viên chỉ mặc định giữ thẻ "mặc định"', async () => {
    route('/projects/p1/members', MEMBERS);
    setup();
    await screen.findByText('An');
    expect(screen.getByText('qua Team QA')).toBeTruthy();
    expect(screen.getByText('mặc định theo tổ chức')).toBeTruthy();
    expect(screen.getByText('trực tiếp + qua Team QA')).toBeTruthy();
    expect(screen.getByText('mặc định')).toBeTruthy(); // Chi: không có ghi đè
    // thẻ "riêng" của cả hàng không còn cho hai hàng có thông tin nguồn
    expect(screen.queryByText('riêng')).toBeNull();
  });

  it('người chỉ nhờ team không có nút "gỡ vai trò riêng" (không có gì để gỡ); người có vai trò riêng thì có', async () => {
    setup();
    await screen.findByText('An');
    expect(screen.queryByRole('button', { name: 'Gỡ vai trò riêng của An' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Gỡ vai trò riêng của Bình' })).toBeTruthy();
  });

  it('sửa vai trò của người chỉ nhờ team: cảnh báo lưu sẽ đặt vai trò riêng', async () => {
    const u = setup();
    await screen.findByText('An');
    await u.click(screen.getByRole('button', { name: 'Đặt vai trò riêng cho An' }));
    expect(await screen.findByRole('note')).toHaveProperty(
      'textContent',
      expect.stringContaining('Lưu sẽ đặt các vai trò đã chọn thành vai trò riêng'),
    );
  });

  it('gỡ vai trò riêng của người còn ở dự án nhờ team: hỏi và nói rõ họ vẫn ở dự án', async () => {
    h.del.mockResolvedValue({ data: { success: true } });
    const u = setup('members', true);
    await screen.findByText('Bình');
    await u.click(screen.getByRole('button', { name: 'Gỡ vai trò riêng của Bình' }));
    const dialog = await screen.findByRole('dialog', { name: /Gỡ vai trò riêng của Bình/ });
    expect(dialog.textContent).toContain('Bình vẫn ở dự án nhờ Team QA');
    await u.click(within(dialog).getByRole('button', { name: 'Gỡ vai trò riêng' }));
    await waitFor(() => expect(h.del).toHaveBeenCalledWith('/projects/p1/members/u2'));
  });
});

describe('Tab "Team" (team của tổ chức gắn vào dự án)', () => {
  it('liệt kê team đã gắn kèm số người + vai trò; gỡ có xác nhận nêu hệ quả', async () => {
    h.del.mockResolvedValue({ data: [] });
    const u = setup('teams', true);
    await screen.findByText('Team QA');
    expect(screen.getByText('2 người')).toBeTruthy();
    await u.click(screen.getByRole('button', { name: 'Gỡ Team QA khỏi dự án' }));
    const dialog = await screen.findByRole('dialog', { name: /Gỡ Team QA khỏi dự án/ });
    expect(dialog.textContent).toContain('An sẽ không còn ở dự án');
    await u.click(within(dialog).getByRole('button', { name: 'Gỡ team' }));
    await waitFor(() => expect(h.del).toHaveBeenCalledWith('/projects/p1/teams/t1'));
    expect(toast.success).toHaveBeenCalled();
  });

  it('gắn team: chọn team chưa gắn + vai trò rồi gửi PUT', async () => {
    h.put.mockResolvedValue({ data: LINKS });
    const u = setup('teams');
    await screen.findByText('Team QA');
    await u.click(screen.getByRole('button', { name: /Gắn team/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Gắn team vào dự án' });
    await u.click(within(dialog).getByRole('button', { name: 'Team của tổ chức' }));
    // QA đã gắn nên không có trong danh sách; chỉ còn Dev
    expect(screen.queryByRole('option', { name: /^QA/ })).toBeNull();
    await u.click(await screen.findByRole('option', { name: /Dev/ }));
    await u.click(within(dialog).getByRole('button', { name: 'Vai trò của team trong dự án' }));
    await u.click(await screen.findByRole('option', { name: /Developer|Lập trình/ }));
    await u.keyboard('{Escape}');
    await u.click(within(dialog).getByRole('button', { name: 'Gắn team' }));
    await waitFor(() =>
      expect(h.put).toHaveBeenCalledWith('/projects/p1/teams/t2', { roleIds: ['rDev'] }),
    );
  });
});

describe('Tab "Team trong dự án" (không cấp quyền)', () => {
  it('liệt kê team riêng; tạo team gửi tên + màu + thành viên', async () => {
    h.post.mockResolvedValue({ data: SUBTEAMS[0] });
    const u = setup('sub-teams');
    await screen.findByText('Kiểm thử');
    await u.click(screen.getByRole('button', { name: /Tạo team/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Tạo team trong dự án' });
    await u.type(within(dialog).getByLabelText('Tên team'), 'Backend');
    await u.click(within(dialog).getByRole('button', { name: 'Tạo team' }));
    await waitFor(() =>
      expect(h.post).toHaveBeenCalledWith(
        '/projects/p1/sub-teams',
        expect.objectContaining({ name: 'Backend', memberIds: [] }),
      ),
    );
  });

  it('xoá team có xác nhận và nói rõ mọi người vẫn ở lại dự án', async () => {
    h.del.mockResolvedValue({ data: { success: true } });
    const u = setup('sub-teams');
    await screen.findByText('Kiểm thử');
    await u.click(screen.getByRole('button', { name: 'Xoá team Kiểm thử' }));
    const dialog = await screen.findByRole('dialog', { name: /Xoá team/ });
    expect(dialog.textContent).toContain('mọi người vẫn ở lại dự án');
    await u.click(within(dialog).getByRole('button', { name: 'Xoá team' }));
    await waitFor(() => expect(h.del).toHaveBeenCalledWith('/projects/p1/sub-teams/s1'));
  });
});
