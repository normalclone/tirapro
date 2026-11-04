// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectDto, ProjectProgramRefDto } from '@tirapro/types';
import type * as ApiModule from '@/lib/api';

const h = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn(), post: vi.fn() }));
vi.mock('@/lib/api', async (orig) => {
  const real = await orig<typeof ApiModule>();
  return { ...real, api: { get: h.get, put: h.put, post: h.post } };
});
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

import { useAuth } from '@/stores/auth';
import { GroupsCell } from './GroupsPopover';

const A: ProjectProgramRefDto = { id: 'ga', name: 'Hạ tầng', color: '#111' };
const B: ProjectProgramRefDto = { id: 'gb', name: 'Khách hàng', color: null };
const C: ProjectProgramRefDto = { id: 'gc', name: 'Nội bộ', color: null };
const ALL = [A, B, C];

const project = (programs: ProjectProgramRefDto[], over: Partial<ProjectDto> = {}) =>
  ({ id: 'p1', key: 'HR', name: 'Nhân sự', programs, archivedAt: null, ...over }) as ProjectDto;

/** Quyền theo dự án: `perms[projectId]` trả cho GET /projects/:id/permissions/me. */
let perms: string[] = [];

beforeEach(() => {
  h.get.mockReset();
  h.put.mockReset();
  h.post.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
  perms = [];
  h.get.mockImplementation((url: string) => {
    const m = /^\/projects\/(\w+)\/permissions\/me$/.exec(url);
    if (m) return Promise.resolve({ data: { projectId: m[1], permissions: perms } });
    return Promise.reject(new Error(`offline ${url}`));
  });
  h.put.mockImplementation((_u: string, body: { programIds: string[] }) =>
    Promise.resolve({
      data: { projectId: 'p1', programs: ALL.filter((g) => body.programIds.includes(g.id)) },
    }),
  );
  h.post.mockImplementation((_u: string, body: { name: string }) =>
    Promise.resolve({ data: { id: 'gnew', name: body.name, color: '#abc' } }),
  );
  useAuth.setState({ user: { id: 'me', isSystemAdmin: false } as never, permissions: [] });
});
afterEach(cleanup);

function renderCell(p: ProjectDto) {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <GroupsCell project={p} programs={ALL} />
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

describe('ô "Nhóm"', () => {
  it('chữ ô: "N nhóm"; không nhóm nào → "—"; tên truy cập bắt đầu bằng chữ nhìn thấy', () => {
    renderCell(project([A, B]));
    const btn = screen.getByRole('button', { name: /^2 nhóm/ });
    expect(btn.textContent).toContain('2 nhóm');
    expect(btn.getAttribute('aria-label')).toBeNull();
    cleanup();
    renderCell(project([]));
    expect(screen.getByRole('button', { name: /^—/ })).toBeTruthy();
  });

  it('người KHÔNG phải quản trị dự án: popover chỉ liệt kê nhóm (màu + tên), không có ô chọn/Lưu', async () => {
    perms = ['project:view'];
    const user = renderCell(project([A, B]));
    await user.click(screen.getByRole('button', { name: /^2 nhóm/ }));
    const box = await screen.findByRole('group', { name: /Nhóm của Nhân sự/ });
    await waitFor(() =>
      expect(within(box).getByText('Chỉ quản trị dự án mới đổi được nhóm.')).toBeTruthy(),
    );
    expect(within(box).getByText('Hạ tầng')).toBeTruthy();
    expect(within(box).getByText('Khách hàng')).toBeTruthy();
    expect(within(box).queryByRole('checkbox')).toBeNull();
    expect(within(box).queryByRole('button', { name: 'Lưu' })).toBeNull();
    expect(h.put).not.toHaveBeenCalled();
  });

  it('dự án chưa có nhóm + chỉ đọc → "Dự án chưa thuộc nhóm nào."', async () => {
    perms = ['project:view'];
    const user = renderCell(project([]));
    await user.click(screen.getByRole('button', { name: /^—/ }));
    expect(await screen.findByText('Dự án chưa thuộc nhóm nào.')).toBeTruthy();
  });

  it('quản trị dự án: tích/bỏ nhiều nhóm rồi Lưu → PUT /projects/:id/programs với đủ tập mới; toast + đóng', async () => {
    perms = ['project:view', 'project:admin'];
    const user = renderCell(project([A]));
    await user.click(screen.getByRole('button', { name: /^1 nhóm/ }));
    const box = await screen.findByRole('group', { name: /Nhóm của Nhân sự/ });
    const save = await within(box).findByRole('button', { name: 'Lưu' });
    expect(save.hasAttribute('disabled')).toBe(true); // chưa đổi gì
    expect(within(box).getByRole<HTMLInputElement>('checkbox', { name: /Hạ tầng/ }).checked).toBe(
      true,
    );
    await user.click(within(box).getByRole('checkbox', { name: /Khách hàng/ }));
    await user.click(within(box).getByRole('checkbox', { name: /Nội bộ/ }));
    await user.click(within(box).getByRole('checkbox', { name: /Hạ tầng/ })); // bỏ
    expect(save.hasAttribute('disabled')).toBe(false);
    await user.click(save);
    await waitFor(() => expect(h.put).toHaveBeenCalledTimes(1));
    expect(h.put.mock.calls[0]![0]).toBe('/projects/p1/programs');
    expect((h.put.mock.calls[0]![1] as { programIds: string[] }).programIds.sort()).toEqual([
      'gb',
      'gc',
    ]);
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByRole('group', { name: /Nhóm của/ })).toBeNull());
  });

  it('tìm nhóm theo tên (không dấu); nhóm đã chọn luôn còn trong danh sách', async () => {
    perms = ['project:admin'];
    const user = renderCell(project([A]));
    await user.click(screen.getByRole('button', { name: /^1 nhóm/ }));
    const box = await screen.findByRole('group', { name: /Nhóm của Nhân sự/ });
    await user.type(await within(box).findByRole('textbox', { name: /Tìm trong: Nhóm/ }), 'khach');
    const labels = within(box)
      .getAllByRole('checkbox')
      .map((c) => c.closest('label')!.textContent);
    expect(labels).toEqual([
      expect.stringContaining('Hạ tầng'),
      expect.stringContaining('Khách hàng'),
    ]);
  });

  it('không có program:manage → không có ô "Tạo nhóm"; có program:manage → tạo tại chỗ, tự tích nhóm mới rồi Lưu gửi cả nhóm mới', async () => {
    perms = ['project:admin'];
    const user = renderCell(project([]));
    await user.click(screen.getByRole('button', { name: /^—/ }));
    let box = await screen.findByRole('group', { name: /Nhóm của Nhân sự/ });
    await within(box).findByRole('button', { name: 'Lưu' });
    expect(within(box).queryByRole('textbox', { name: 'Tên nhóm mới' })).toBeNull();
    cleanup();

    useAuth.setState({ permissions: ['program:manage'] });
    const user2 = renderCell(project([]));
    await user2.click(screen.getByRole('button', { name: /^—/ }));
    box = await screen.findByRole('group', { name: /Nhóm của Nhân sự/ });
    await user2.type(
      await within(box).findByRole('textbox', { name: 'Tên nhóm mới' }),
      'Dự án mới{Enter}',
    );
    await waitFor(() => expect(h.post).toHaveBeenCalledWith('/programs', { name: 'Dự án mới' }));
    const created = await within(box).findByRole<HTMLInputElement>('checkbox', {
      name: /Dự án mới/,
    });
    expect(created.checked).toBe(true);
    await user2.click(within(box).getByRole('button', { name: 'Lưu' }));
    await waitFor(() => expect(h.put).toHaveBeenCalled());
    expect((h.put.mock.calls[0]![1] as { programIds: string[] }).programIds).toEqual(['gnew']);
  });

  it('lỗi từ máy chủ: toast lỗi, popover vẫn mở để thử lại', async () => {
    perms = ['project:admin'];
    h.put.mockRejectedValue(new Error('boom'));
    const user = renderCell(project([]));
    await user.click(screen.getByRole('button', { name: /^—/ }));
    const box = await screen.findByRole('group', { name: /Nhóm của Nhân sự/ });
    await user.click(await within(box).findByRole('checkbox', { name: /Hạ tầng/ }));
    await user.click(within(box).getByRole('button', { name: 'Lưu' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(screen.getByRole('group', { name: /Nhóm của Nhân sự/ })).toBeTruthy();
  });

  it('quyền chỉ tra khi mở popover (trang nhiều dự án không bắn yêu cầu quyền cho từng hàng)', async () => {
    perms = ['project:admin'];
    const user = renderCell(project([A]));
    expect(h.get).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: /^1 nhóm/ }));
    await waitFor(() => expect(h.get).toHaveBeenCalledWith('/projects/p1/permissions/me'));
  });
});
