// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DASHBOARD_TEMPLATES } from '@tirapro/shared';
import type * as ApiModule from '@/lib/api';

const h = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('@/lib/api', async (orig) => {
  const real = await orig<typeof ApiModule>();
  return { ...real, api: { get: h.get, post: h.post } };
});
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

import { useAuth } from '@/stores/auth';
import { TemplateGalleryPage } from './TemplateGalleryPage';

// jsdom không có ResizeObserver (khung trang / thanh cuộn dùng).
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

let canOrg = false;
let projects: unknown[] = [];
let programs: Array<{ id: string; name: string; projectCount: number }> = [];

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  h.get.mockReset();
  h.post.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
  canOrg = false;
  projects = [{ id: 'p1', key: 'AAA', name: 'Alpha', isArchived: false }];
  programs = [{ id: 'g1', name: 'Đối tác', projectCount: 2 }];
  h.get.mockImplementation((url: string) => {
    if (url === '/dashboard-templates')
      return Promise.resolve({ data: { templates: DASHBOARD_TEMPLATES, canUseOrgScope: canOrg } });
    if (url === '/projects') return Promise.resolve({ data: projects });
    if (url === '/programs') return Promise.resolve({ data: programs });
    return Promise.reject(new Error(`offline ${url}`));
  });
  h.post.mockResolvedValue({ data: { id: 'd-new', name: 'Mới' } });
  useAuth.setState({ user: { id: 'me' } as never, permissions: ['dashboard:manage'] as never });
});
afterEach(cleanup);

function Landed() {
  const { pathname, search } = useLocation();
  return <p>{`Đã sang ${pathname}${search}`}</p>;
}

function renderPage(entries = ['/dashboards/new']) {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={entries} initialIndex={entries.length - 1}>
        <Routes>
          <Route path="/dashboards/new" element={<TemplateGalleryPage />} />
          <Route path="/dashboards/:id" element={<Landed />} />
          <Route path="*" element={<Landed />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

const createBtn = () => screen.getByRole('button', { name: 'Tạo bảng tổng quan' });

describe('thư viện mẫu dashboard', () => {
  it('liệt kê 5 mẫu kèm mô tả một dòng và xem trước sơ đồ khối của mẫu đang chọn', async () => {
    renderPage();
    for (const t of DASHBOARD_TEMPLATES) {
      expect(await screen.findByRole('radio', { name: t.name })).toBeTruthy();
      expect(screen.getAllByText(t.description).length).toBeGreaterThan(0);
    }
    expect(screen.getByRole('heading', { name: /Xem trước: Tổng quan dự án/ })).toBeTruthy();
  });

  it('người không phải admin tổ chức: phạm vi "Toàn tổ chức" bị khoá kèm lý do', async () => {
    renderPage();
    const org = await screen.findByRole('radio', { name: 'Toàn tổ chức' });
    expect(org.getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByText(/Chỉ quản trị viên tổ chức chọn được/)).toBeTruthy();
  });

  it('chọn mẫu chỉ hỗ trợ nhóm/tổ chức → phạm vi tự chuyển, "Một dự án" bị khoá', async () => {
    const user = renderPage();
    await user.click(await screen.findByRole('radio', { name: 'Quản lý tổ chức' }));
    expect(
      screen.getByRole('radio', { name: 'Một nhóm dự án của tôi' }).getAttribute('aria-checked'),
    ).toBe('true');
    expect(screen.getByRole('radio', { name: 'Một dự án' }).getAttribute('aria-disabled')).toBe(
      'true',
    );
  });

  it('chưa chọn dự án thì chưa tạo được; chọn xong → POST đúng mẫu + phạm vi, rồi sang bảng mới', async () => {
    const user = renderPage();
    await screen.findByRole('radio', { name: 'Một dự án' });
    expect((createBtn() as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Dự án' }));
    await user.click(await screen.findByRole('option', { name: /Alpha/ }));
    await waitFor(() => expect((createBtn() as HTMLButtonElement).disabled).toBe(false));
    await user.click(createBtn());
    await waitFor(() => expect(h.post).toHaveBeenCalled());
    expect(h.post).toHaveBeenCalledWith('/dashboards/from-template', {
      templateKey: 'project-overview',
      dataScope: 'PROJECT',
      scopeProjectId: 'p1',
    });
    expect(await screen.findByText('Đã sang /dashboards/d-new')).toBeTruthy();
  });

  it('admin tổ chức chọn "Toàn tổ chức": gửi ORG không kèm id; tên tự đặt được gửi khi có nhập', async () => {
    canOrg = true;
    const user = renderPage();
    await user.click(await screen.findByRole('radio', { name: 'Toàn tổ chức' }));
    await user.type(screen.getByRole('textbox', { name: 'Tên bảng' }), 'Tuần này');
    await user.click(createBtn());
    await waitFor(() => expect(h.post).toHaveBeenCalled());
    expect(h.post).toHaveBeenCalledWith('/dashboards/from-template', {
      templateKey: 'project-overview',
      dataScope: 'ORG',
      name: 'Tuần này',
    });
  });

  it('chưa có nhóm dự án nào: nói rõ cách tạo thay vì ô chọn trống', async () => {
    programs = [];
    const user = renderPage();
    await user.click(await screen.findByRole('radio', { name: 'Một nhóm dự án của tôi' }));
    expect(
      await within(screen.getByRole('radiogroup', { name: 'Phạm vi dữ liệu của bảng' })).findByText(
        /chưa có nhóm dự án nào/i,
      ),
    ).toBeTruthy();
  });

  it('lỗi máy chủ khi tạo → báo lỗi, ở lại trang', async () => {
    canOrg = true;
    h.post.mockRejectedValue(new Error('boom'));
    const user = renderPage();
    await user.click(await screen.findByRole('radio', { name: 'Toàn tổ chức' }));
    await user.click(createBtn());
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(screen.queryByText(/Đã sang \/dashboards\/d-new/)).toBeNull();
  });

  it('mẫu Trống: tạo xong mở thẳng trình soạn (?edit=1); mẫu khác về màn xem', async () => {
    const user = renderPage();
    await user.click(await screen.findByRole('radio', { name: 'Trống' }));
    await user.click(screen.getByRole('button', { name: 'Dự án' }));
    await user.click(await screen.findByRole('option', { name: /Alpha/ }));
    await user.click(createBtn());
    expect(await screen.findByText('Đã sang /dashboards/d-new?edit=1')).toBeTruthy();
    expect(h.post).toHaveBeenCalledWith('/dashboards/from-template', {
      templateKey: 'blank',
      dataScope: 'PROJECT',
      scopeProjectId: 'p1',
    });
  });

  it('mẫu Trống không bắt buộc chọn phạm vi: người không có dự án/nhóm nào vẫn tạo được (kiểu cũ, không gửi dataScope)', async () => {
    projects = [];
    programs = [];
    const user = renderPage();
    await user.click(await screen.findByRole('radio', { name: 'Trống' }));
    expect(screen.getByText(/bảng trống dùng dữ liệu toàn tổ chức/i)).toBeTruthy();
    await waitFor(() => expect((createBtn() as HTMLButtonElement).disabled).toBe(false));
    await user.click(createBtn());
    await waitFor(() => expect(h.post).toHaveBeenCalled());
    expect(h.post).toHaveBeenCalledWith('/dashboards', {
      name: 'Trống',
      scope: 'PRIVATE',
      widgets: [],
    });
    expect(await screen.findByText('Đã sang /dashboards/d-new?edit=1')).toBeTruthy();
  });

  it('mẫu khác vẫn cần chọn phạm vi (không gửi kiểu cũ)', async () => {
    projects = [];
    renderPage();
    await screen.findByRole('radio', { name: 'Kiểm thử' });
    expect((createBtn() as HTMLButtonElement).disabled).toBe(true);
    expect(h.post).not.toHaveBeenCalled();
  });

  it('Huỷ về danh sách bảng tổng quan (/), không lùi lịch sử', async () => {
    const user = renderPage(['/', '/trang-truoc', '/dashboards/new']);
    await user.click(await screen.findByRole('button', { name: 'Huỷ' }));
    expect(await screen.findByText('Đã sang /')).toBeTruthy();
  });
});
