// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ApiModule from '@/lib/api';

const h = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('@/lib/api', async (orig) => {
  const real = await orig<typeof ApiModule>();
  return { ...real, api: { get: h.get, post: h.post } };
});
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

import { CreateProjectModal } from './CreateProjectModal';

const user = (id: string, displayName: string) => ({
  id,
  email: `${id}@x.vn`,
  displayName,
  avatarUrl: null,
  timezone: 'UTC',
  locale: 'vi',
  status: 'ACTIVE',
});

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn(); // jsdom không có
  vi.clearAllMocks();
  h.get.mockImplementation((url: string) =>
    Promise.resolve({
      data: url.startsWith('/roles')
        ? [
            { id: 'rt', name: 'Tester', color: null, scope: 'PROJECT', permissionKeys: [] },
            { id: 'rd', name: 'Developer', color: null, scope: 'PROJECT', permissionKeys: [] },
          ]
        : [user('u1', 'An'), user('u2', 'Bình')],
    }),
  );
  h.post.mockResolvedValue({ data: { id: 'p9', key: 'WM' } });
});
afterEach(cleanup);

const shown = Boolean(1); // luôn mở (hợp đồng Dialog cấm `open` trần)
function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <CreateProjectModal open={shown} onClose={() => undefined} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

describe('Hộp Tạo dự án', () => {
  it('mặc định RIÊNG TƯ và gửi isPrivate=true khi không đổi', async () => {
    const u = setup();
    const box = await screen.findByRole<HTMLInputElement>('checkbox', { name: /Dự án riêng tư/ });
    expect(box.checked).toBe(true);
    await u.type(screen.getByLabelText('Tên dự án'), 'Website Mới');
    await u.click(screen.getByRole('button', { name: 'Tạo dự án' }));
    await waitFor(() => expect(h.post).toHaveBeenCalled());
    const body = h.post.mock.calls[0]![1] as Record<string, unknown>;
    expect(body).toMatchObject({ name: 'Website Mới', isPrivate: true });
    expect(body).not.toHaveProperty('members');
  });

  it('bỏ chọn riêng tư → công khai (isPrivate=false) và đổi lời mô tả', async () => {
    const u = setup();
    await u.click(await screen.findByRole('checkbox', { name: /Dự án riêng tư/ }));
    expect(screen.getByText(/Mọi người trong tổ chức xem được/)).toBeTruthy();
    await u.type(screen.getByLabelText('Tên dự án'), 'Website Mới');
    await u.click(screen.getByRole('button', { name: 'Tạo dự án' }));
    await waitFor(() => expect(h.post).toHaveBeenCalled());
    expect(h.post.mock.calls[0]![1]).toMatchObject({ isPrivate: false });
  });

  it('chọn người: gửi members với vai trò ban đầu mặc định là mẫu Developer', async () => {
    const u = setup();
    await u.type(await screen.findByLabelText('Tên dự án'), 'Website Mới');
    await u.click(screen.getByRole('button', { name: 'Chọn người thêm vào dự án' }));
    await u.click(await screen.findByRole('option', { name: /An/ }));
    await u.keyboard('{Escape}');
    expect(screen.getByText('Vai trò ban đầu:')).toBeTruthy();
    await u.click(screen.getByRole('button', { name: 'Tạo dự án' }));
    await waitFor(() => expect(h.post).toHaveBeenCalled());
    expect(h.post.mock.calls[0]![1]).toMatchObject({ members: [{ userId: 'u1', roleId: 'rd' }] });
  });
});
