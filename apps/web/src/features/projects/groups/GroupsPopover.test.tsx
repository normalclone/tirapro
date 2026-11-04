// @vitest-environment jsdom
/* eslint-disable max-lines-per-function -- spec: một describe lớn dùng chung dữ liệu dựng sẵn */
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
/** GET /programs: trả mảng, hoặc `'error'` / `'pending'` để thử trạng thái lỗi / đang tải. */
let catalog: 'error' | 'pending' | unknown[] = [];
/** GET /permissions/me: `'error'` / `'pending'` để thử các trạng thái đó. */
let permsMode: 'ok' | 'error' | 'pending' = 'ok';

beforeEach(() => {
  h.get.mockReset();
  h.put.mockReset();
  h.post.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
  perms = [];
  permsMode = 'ok';
  catalog = ALL.map((g) => ({ ...g, projects: [], projectCount: 0, owner: null }));
  h.get.mockImplementation((url: string) => {
    const m = /^\/projects\/(\w+)\/permissions\/me$/.exec(url);
    if (m) {
      if (permsMode === 'error') return Promise.reject(new Error('offline'));
      if (permsMode === 'pending') return new Promise(() => undefined);
      return Promise.resolve({ data: { projectId: m[1], permissions: perms } });
    }
    if (url === '/programs') {
      if (catalog === 'error') return Promise.reject(new Error('offline'));
      if (catalog === 'pending') return new Promise(() => undefined);
      return Promise.resolve({ data: catalog });
    }
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
      <GroupsCell project={p} />
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

  it('không có program:manage → không có ô tạo nhóm; có program:manage → nhóm mới chỉ được TẠO khi bấm Lưu (rồi gửi cùng tập nhóm)', async () => {
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
    // Chưa tạo gì trên máy chủ: chỉ là nhóm nháp đã tích sẵn
    const draft = await within(box).findByRole<HTMLInputElement>('checkbox', { name: /Dự án mới/ });
    expect(draft.checked).toBe(true);
    expect(within(box).getByText('Nhóm mới chỉ được tạo khi bạn bấm Lưu.')).toBeTruthy();
    expect(h.post).not.toHaveBeenCalled();
    await user2.click(within(box).getByRole('button', { name: 'Lưu' }));
    await waitFor(() => expect(h.put).toHaveBeenCalled());
    expect(h.post).toHaveBeenCalledTimes(1);
    expect(h.post).toHaveBeenCalledWith('/programs', { name: 'Dự án mới' });
    expect((h.put.mock.calls[0]![1] as { programIds: string[] }).programIds).toEqual(['gnew']);
  });

  it('Huỷ sau khi gõ nhóm mới → không tạo nhóm nào; bỏ tích nhóm nháp → nhóm nháp biến mất', async () => {
    perms = ['project:admin'];
    useAuth.setState({ permissions: ['program:manage'] });
    const user = renderCell(project([]));
    await user.click(screen.getByRole('button', { name: /^—/ }));
    const box = await screen.findByRole('group', { name: /Nhóm của Nhân sự/ });
    await user.type(
      await within(box).findByRole('textbox', { name: 'Tên nhóm mới' }),
      'Tạm{Enter}',
    );
    await user.click(await within(box).findByRole('checkbox', { name: /Tạm/ })); // bỏ tích → bỏ nháp
    expect(within(box).queryByRole('checkbox', { name: /Tạm/ })).toBeNull();
    await user.type(within(box).getByRole('textbox', { name: 'Tên nhóm mới' }), 'Khác{Enter}');
    await user.click(within(box).getByRole('button', { name: 'Huỷ' }));
    await waitFor(() => expect(screen.queryByRole('group', { name: /Nhóm của/ })).toBeNull());
    expect(h.post).not.toHaveBeenCalled();
    expect(h.put).not.toHaveBeenCalled();
  });

  it('tên nhóm mới trùng nhóm có sẵn → chỉ tích nhóm đó, không tạo trùng', async () => {
    perms = ['project:admin'];
    useAuth.setState({ permissions: ['program:manage'] });
    const user = renderCell(project([]));
    await user.click(screen.getByRole('button', { name: /^—/ }));
    const box = await screen.findByRole('group', { name: /Nhóm của Nhân sự/ });
    await user.type(
      await within(box).findByRole('textbox', { name: 'Tên nhóm mới' }),
      'hạ tầng{Enter}',
    );
    expect(within(box).getByRole<HTMLInputElement>('checkbox', { name: /Hạ tầng/ }).checked).toBe(
      true,
    );
    await user.click(within(box).getByRole('button', { name: 'Lưu' }));
    await waitFor(() => expect(h.put).toHaveBeenCalled());
    expect(h.post).not.toHaveBeenCalled();
    expect((h.put.mock.calls[0]![1] as { programIds: string[] }).programIds).toEqual(['ga']);
  });

  it('tạo nhóm nháp lỗi giữa chừng → toast, KHÔNG gửi PUT; nhóm đã tạo không bị tạo lại ở lần thử sau', async () => {
    perms = ['project:admin'];
    useAuth.setState({ permissions: ['program:manage'] });
    h.post
      .mockResolvedValueOnce({ data: { id: 'g1', name: 'Một', color: null } })
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ data: { id: 'g2', name: 'Hai', color: null } });
    const user = renderCell(project([]));
    await user.click(screen.getByRole('button', { name: /^—/ }));
    const box = await screen.findByRole('group', { name: /Nhóm của Nhân sự/ });
    const input = await within(box).findByRole('textbox', { name: 'Tên nhóm mới' });
    await user.type(input, 'Một{Enter}');
    await user.type(input, 'Hai{Enter}');
    await user.click(within(box).getByRole('button', { name: 'Lưu' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(h.put).not.toHaveBeenCalled();
    await user.click(within(box).getByRole('button', { name: 'Lưu' }));
    await waitFor(() => expect(h.put).toHaveBeenCalled());
    expect(h.post.mock.calls.map((c) => (c[1] as { name: string }).name)).toEqual([
      'Một',
      'Hai',
      'Hai',
    ]);
    expect((h.put.mock.calls[0]![1] as { programIds: string[] }).programIds.sort()).toEqual([
      'g1',
      'g2',
    ]);
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

  it('đang tải quyền → "Đang kiểm tra quyền…"; lỗi tải quyền → báo lỗi + Thử lại (không giả làm "chỉ quản trị mới đổi được")', async () => {
    permsMode = 'pending';
    let user = renderCell(project([A]));
    await user.click(screen.getByRole('button', { name: /^1 nhóm/ }));
    expect(await screen.findByText('Đang kiểm tra quyền…')).toBeTruthy();
    expect(screen.queryByText('Chỉ quản trị dự án mới đổi được nhóm.')).toBeNull();
    cleanup();

    permsMode = 'error';
    perms = ['project:admin'];
    user = renderCell(project([A]));
    await user.click(screen.getByRole('button', { name: /^1 nhóm/ }));
    // `projectPermissionsQuery` thử lại 1 lần sau ~1s mới báo lỗi → chờ lâu hơn 1s mặc định của findBy.
    expect(
      await screen.findByText('Không tải được quyền của bạn ở dự án này.', {}, { timeout: 4000 }),
    ).toBeTruthy();
    expect(screen.queryByText('Chỉ quản trị dự án mới đổi được nhóm.')).toBeNull();
    permsMode = 'ok';
    await user.click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(await screen.findByRole('button', { name: 'Lưu' })).toBeTruthy(); // thử lại ra trình sửa
  });

  it('danh mục nhóm đang tải / lỗi: báo rõ, không nói "Chưa có nhóm nào"; Thử lại tải lại', async () => {
    perms = ['project:admin'];
    catalog = 'pending';
    let user = renderCell(project([]));
    await user.click(screen.getByRole('button', { name: /^—/ }));
    expect(await screen.findByText('Đang tải danh sách nhóm…')).toBeTruthy();
    expect(screen.queryByText('Chưa có nhóm nào.')).toBeNull();
    cleanup();

    catalog = 'error';
    user = renderCell(project([]));
    await user.click(screen.getByRole('button', { name: /^—/ }));
    expect(await screen.findByText('Không tải được danh sách nhóm.')).toBeTruthy();
    expect(screen.queryByText('Chưa có nhóm nào.')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Lưu' })).toBeNull();
    catalog = ALL.map((g) => ({ ...g, projects: [], projectCount: 0, owner: null }));
    await user.click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(await screen.findByRole('checkbox', { name: /Hạ tầng/ })).toBeTruthy();
  });

  it('quyền chỉ tra khi mở popover (trang nhiều dự án không bắn yêu cầu quyền cho từng hàng)', async () => {
    perms = ['project:admin'];
    const user = renderCell(project([A]));
    expect(h.get).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: /^1 nhóm/ }));
    await waitFor(() => expect(h.get).toHaveBeenCalledWith('/projects/p1/permissions/me'));
  });
});
