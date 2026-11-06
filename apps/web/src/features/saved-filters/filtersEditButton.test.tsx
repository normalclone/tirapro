// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ApiModule from '@/lib/api';
import type { SavedFilter } from './api';

const OWN: SavedFilter = {
  id: 'f1',
  name: 'Lọc bug todo',
  jql: 'type = Bug AND statusCategory = TODO',
  visibility: 'PRIVATE',
  ownerId: 'u',
  isOwner: true,
  access: 'owner',
  owner: { id: 'u', displayName: 'Tôi', avatarUrl: null },
  sharedProjects: [],
  sharedUsers: [],
  createdAt: '2026-11-01T00:00:00.000Z',
};
const SHARED: SavedFilter = {
  ...OWN,
  id: 'f2',
  name: 'Của đồng nghiệp',
  visibility: 'SHARED',
  ownerId: 'x',
  isOwner: false,
  access: 'shared',
  owner: { id: 'x', displayName: 'Đồng nghiệp', avatarUrl: null },
};

const h = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn(), del: vi.fn() }));
vi.mock('@/lib/api', async (orig) => {
  const real = await orig<typeof ApiModule>();
  return { ...real, api: { get: h.get, post: h.post, patch: h.patch, delete: h.del } };
});
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

import { useAuth } from '@/stores/auth';
import { FiltersPage, saveAction } from './FiltersPage';

beforeEach(() => {
  for (const [name, value] of [
    ['scrollIntoView', () => undefined],
    ['hasPointerCapture', () => false],
  ] as const)
    Object.defineProperty(Element.prototype, name, { value, configurable: true, writable: true });
  globalThis.ResizeObserver ??= class {
    observe = () => undefined;
    unobserve = () => undefined;
    disconnect = () => undefined;
  } as never;
  h.get.mockReset();
  h.post.mockReset();
  h.patch.mockReset();
  h.get.mockImplementation((url: string) => {
    if (url === '/filters') return Promise.resolve({ data: [OWN, SHARED] });
    if (url.startsWith('/filters/') || url.startsWith('/search?'))
      return Promise.resolve({ data: { data: [], pageInfo: {} } });
    return Promise.reject(new Error(`offline ${url}`));
  });
  h.post.mockImplementation((url: string, body: unknown) => {
    if (url === '/search/validate') return Promise.resolve({ data: { valid: true } });
    if (url === '/search/relax-counts')
      return Promise.resolve({ data: { clauses: [], remaining: 0 } });
    return Promise.resolve({ data: { ...OWN, id: 'new', ...(body as object) } });
  });
  h.patch.mockImplementation((_u: string, body: unknown) =>
    Promise.resolve({ data: { ...OWN, ...(body as object) } }),
  );
  act(() => {
    useAuth.setState({
      user: { id: 'u', isSystemAdmin: false } as never,
      permissions: ['filter:manage'],
    });
  });
});
afterEach(cleanup);

function renderAt(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/filters" element={<FiltersPage />} />
          <Route path="/filters/:id" element={<FiltersPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

describe('nút lưu cạnh "Chạy JQL" theo bộ lọc đang chọn', () => {
  it('đang chọn bộ lọc của mình: nút "Sửa"; mở hộp sửa đổ sẵn tên + JQL đang gõ, lưu = PATCH đúng id (không tạo mới)', async () => {
    const user = renderAt('/filters/f1');
    const edit = await screen.findByRole('button', { name: 'Sửa' });
    expect(screen.queryByRole('button', { name: 'Lưu truy vấn' })).toBeNull();
    // sửa JQL ngay trong ô rồi bấm Sửa → hộp sửa nhận JQL đang gõ
    const editor = await screen.findByLabelText<HTMLTextAreaElement>('Chạy nhanh truy vấn JQL');
    await waitFor(() => expect(editor.value).toBe(OWN.jql));
    await user.type(editor, ' ORDER BY created DESC');
    await user.click(edit);

    const dialog = await screen.findByRole('dialog', { name: /Sửa bộ lọc/ });
    expect(within(dialog).getByLabelText<HTMLInputElement>('Tên bộ lọc').value).toBe(OWN.name);
    expect(within(dialog).getByLabelText<HTMLTextAreaElement>('Truy vấn JQL').value).toBe(
      `${OWN.jql} ORDER BY created DESC`,
    );
    await user.click(within(dialog).getByRole('button', { name: 'Lưu thay đổi' }));

    await waitFor(() => expect(h.patch).toHaveBeenCalledTimes(1));
    expect(h.patch.mock.calls[0]![0]).toBe('/filters/f1');
    expect(h.patch.mock.calls[0]![1]).toMatchObject({
      name: OWN.name,
      jql: `${OWN.jql} ORDER BY created DESC`,
    });
    expect(h.post.mock.calls.filter((c) => c[0] === '/filters')).toHaveLength(0);
  });

  it('chưa chọn bộ lọc (truy vấn ad-hoc): nút "Lưu truy vấn" tạo bộ lọc mới (POST /filters)', async () => {
    const user = renderAt('/filters');
    const editor = await screen.findByLabelText('Chạy nhanh truy vấn JQL');
    await user.type(editor, 'project = DEMO');
    expect(screen.queryByRole('button', { name: 'Sửa' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Lưu truy vấn' }));
    const dialog = await screen.findByRole('dialog', { name: /Tạo bộ lọc/ });
    await user.type(within(dialog).getByLabelText('Tên bộ lọc'), 'Mới');
    await user.click(within(dialog).getByRole('button', { name: 'Lưu bộ lọc' }));
    await waitFor(() => expect(h.post.mock.calls.some((c) => c[0] === '/filters')).toBe(true));
    const call = h.post.mock.calls.find((c) => c[0] === '/filters')!;
    expect(call[1]).toMatchObject({ name: 'Mới', jql: 'project = DEMO' });
    expect(h.patch).not.toHaveBeenCalled();
  });

  it('đang chọn bộ lọc người khác chia sẻ (không sửa được): "Lưu thành bộ lọc mới"', async () => {
    renderAt('/filters/f2');
    expect(await screen.findByRole('button', { name: 'Lưu thành bộ lọc mới' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Sửa' })).toBeNull();
  });

  it('saveAction thuần: chọn chế độ đúng theo bộ lọc', () => {
    const on = { create: vi.fn(), edit: vi.fn() };
    expect(saveAction(null, on)).toMatchObject({ mode: 'create', label: 'Lưu truy vấn' });
    expect(saveAction({ isOwner: false }, on)).toMatchObject({
      mode: 'copy',
      label: 'Lưu thành bộ lọc mới',
    });
    expect(saveAction(OWN, on)).toMatchObject({ mode: 'edit', label: 'Sửa' });
  });
});

describe('danh sách bộ lọc đã lưu: nút Chia sẻ sát mép phải', () => {
  it('nút Chia sẻ là phần tử cuối của dòng và có ml-auto; cột chữ giữ flex-1 (cả bộ lọc của mình và của người khác)', async () => {
    renderAt('/filters');
    for (const f of [OWN, SHARED]) {
      const share = await screen.findByRole('button', { name: `Chia sẻ bộ lọc ${f.name}` });
      const row = share.parentElement!;
      expect(row.lastElementChild).toBe(share);
      expect(share.className).toContain('ml-auto');
      const text = row.firstElementChild as HTMLElement;
      expect(text.className).toContain('flex-1');
      expect(text.className).toContain('min-w-0');
    }
  });
});

describe('rail: nhóm "Của tôi" / "Được chia sẻ với tôi"', () => {
  it('bộ lọc của mình và bộ lọc người khác chia sẻ nằm hai nhóm riêng; hàng của người khác ghi chủ sở hữu', async () => {
    renderAt('/filters');
    const mine = await screen.findByRole('region', { name: /Của tôi/ });
    const shared = await screen.findByRole('region', { name: /Được chia sẻ với tôi/ });
    expect(within(mine).getByText(OWN.name)).toBeTruthy();
    expect(within(mine).queryByText(SHARED.name)).toBeNull();
    expect(within(shared).getByText(SHARED.name)).toBeTruthy();
    // Nhóm đã nói là được chia sẻ: chỉ ghi tên người tạo, không nhãn "Được chia sẻ", không tiền tố "Chủ:".
    expect(within(shared).getByText('Đồng nghiệp')).toBeTruthy();
    expect(within(shared).queryByText(/Chủ:/)).toBeNull();
    expect(within(mine).getByText('Riêng tư')).toBeTruthy();
    expect(within(shared).queryByText('Được chia sẻ')).toBeNull();
  });
});
