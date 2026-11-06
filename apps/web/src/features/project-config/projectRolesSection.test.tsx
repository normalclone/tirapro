// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ApiModule from '@/lib/api';

const h = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn(), del: vi.fn() }));
vi.mock('@/lib/api', async (orig) => {
  const real = await orig<typeof ApiModule>();
  return { ...real, api: { get: h.get, post: h.post, patch: h.patch, delete: h.del } };
});
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));
const perm = vi.hoisted(() => ({ admin: true }));
vi.mock('@/features/projects/permissions', () => ({ useCan: () => () => perm.admin }));

import { ConfirmHost, useConfirmStore } from '@/components/ui/useConfirm';
import { ProjectRolesSection } from './ProjectRolesSection';

const role = (id: string, name: string, memberCount: number) => ({
  id,
  projectId: 'p1',
  name,
  description: null,
  color: null,
  permissionKeys: ['issue:view', 'issue:edit'],
  memberCount,
  updatedAt: '2026-01-01T00:00:00.000Z',
});
const TEMPLATES = [
  { id: 't1', name: 'Developer', color: null, scope: 'PROJECT', permissionKeys: ['issue:edit'] },
];

function setup(own: unknown[]) {
  h.get.mockImplementation((url: string) =>
    Promise.resolve({ data: url === '/projects/p1/roles' ? own : TEMPLATES }),
  );
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ConfirmHost />
        <ProjectRolesSection projectId="p1" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn(); // jsdom không có
  perm.admin = true;
  vi.clearAllMocks();
});
afterEach(() => {
  cleanup();
  useConfirmStore.setState({ pending: null } as never);
});

describe('Cấu hình dự án › Vai trò', () => {
  it('liệt kê vai trò của dự án kèm số quyền và số người dùng', async () => {
    setup([role('r1', 'QA Lead', 2), role('r2', 'Khách', 0)]);
    await screen.findByText('QA Lead');
    expect(screen.getByText('2 quyền · 2 người đang dùng')).toBeTruthy();
    expect(screen.getByText('2 quyền · Chưa ai dùng')).toBeTruthy();
  });

  it('chưa có vai trò: gợi ý tạo từ mẫu', async () => {
    setup([]);
    expect(await screen.findByText('Dự án chưa có vai trò nào')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Tạo vai trò từ mẫu/ })).toBeTruthy();
  });

  it('tạo từ mẫu: gửi fromTemplateId (tên để trống = tên mẫu)', async () => {
    h.post.mockResolvedValue({ data: role('r9', 'Developer', 0) });
    const u = setup([]);
    await u.click(await screen.findByRole('button', { name: /^Tạo vai trò$/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Tạo vai trò của dự án' });
    await u.click(within(dialog).getByRole('button', { name: 'Mẫu vai trò' }));
    await u.click(await screen.findByRole('option', { name: /Developer/ }));
    await u.click(within(dialog).getByRole('button', { name: 'Tạo vai trò' }));
    await waitFor(() =>
      expect(h.post).toHaveBeenCalledWith('/projects/p1/roles', {
        fromTemplateId: 't1',
        name: 'Developer',
      }),
    );
  });

  it('xoá vai trò có xác nhận và gọi DELETE; vai trò đang dùng nói rõ số người', async () => {
    h.del.mockResolvedValue({ data: { success: true } });
    const u = setup([role('r1', 'QA Lead', 2)]);
    await u.click(await screen.findByRole('button', { name: 'Xoá vai trò QA Lead' }));
    const dialog = await screen.findByRole('dialog', { name: /Xoá vai trò/ });
    expect(dialog.textContent).toContain('đang gán cho 2 người');
    await u.click(within(dialog).getByRole('button', { name: 'Xoá vai trò' }));
    await waitFor(() => expect(h.del).toHaveBeenCalledWith('/projects/p1/roles/r1'));
  });

  it('người không phải Project Admin: chỉ xem, không có nút tạo/sửa/xoá', async () => {
    perm.admin = false;
    setup([role('r1', 'QA Lead', 0)]);
    await screen.findByText('QA Lead');
    expect(screen.queryByRole('button', { name: /Tạo vai trò/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Sửa vai trò QA Lead' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Xoá vai trò QA Lead' })).toBeNull();
  });
});
