// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectDto, ProjectProgramRefDto } from '@tirapro/types';
import type * as ApiModule from '@/lib/api';

const h = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn(), post: vi.fn(), delete: vi.fn() }));
vi.mock('@/lib/api', async (orig) => {
  const real = await orig<typeof ApiModule>();
  return { ...real, api: { get: h.get, put: h.put, post: h.post, delete: h.delete } };
});
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { ConfirmHost } from '@/components/ui/useConfirm';
import { useAuth } from '@/stores/auth';
import { ProjectsPage } from './ProjectsPage';

const A: ProjectProgramRefDto = { id: 'ga', name: 'Hạ tầng', color: '#111' };
const B: ProjectProgramRefDto = { id: 'gb', name: 'Khách hàng', color: null };
const EMPTY: ProjectProgramRefDto = { id: 'ge', name: 'Nhóm rỗng', color: null };

const proj = (key: string, programs: ProjectProgramRefDto[], archived = false): ProjectDto => {
  const p: Partial<ProjectDto> = {
    id: `id-${key}`,
    organizationId: 'w',
    key,
    name: `Dự án ${key}`,
    description: null,
    type: 'SCRUM',
    leadId: null,
    lead: null,
    avatarUrl: null,
    defaultAssigneeMode: 'UNASSIGNED',
    isArchived: archived,
    archivedAt: archived ? '2026-10-01T00:00:00.000Z' : null,
    isPrivate: false,
    programs,
    issueCount: 0,
    createdAt: '2026-10-01T00:00:00.000Z',
  };
  return p as ProjectDto;
};

const LIVE = [proj('AAA', [A, B]), proj('BBB', [A]), proj('CCC', [])];
const ARCHIVED = proj('ZZZ', [A], true);

beforeEach(() => {
  localStorage.clear();
  for (const m of Object.values(h)) m.mockReset();
  h.get.mockImplementation((url: string, cfg?: { params?: { includeArchived?: boolean } }) => {
    if (url === '/projects')
      return Promise.resolve({ data: cfg?.params?.includeArchived ? [...LIVE, ARCHIVED] : LIVE });
    if (url === '/programs')
      return Promise.resolve({
        data: [A, B, EMPTY].map((g) => ({ ...g, projects: [], projectCount: 0 })),
      });
    return Promise.reject(new Error(`offline ${url}`));
  });
  useAuth.setState({
    user: { id: 'me', isSystemAdmin: false } as never,
    permissions: ['project:create'],
  });
});
afterEach(cleanup);

function renderPage(initial = '/projects') {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={[initial]}>
        <ProjectsPage />
        <ConfirmHost />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

const section = (name: RegExp | string) => screen.getByRole('region', { name });

describe('trang Dự án — cột "Nhóm dự án"', () => {
  it('chế độ Danh sách: cột "Nhóm dự án" hiện "N nhóm" / "—" cho từng dự án', async () => {
    renderPage();
    await screen.findByText('Dự án AAA');
    expect(screen.getByRole('button', { name: /^2 nhóm.*Dự án AAA/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^1 nhóm.*Dự án BBB/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^—.*Dự án CCC/ })).toBeTruthy();
  });
});

describe('trang Dự án — chế độ "Danh sách / Theo nhóm"', () => {
  it('đổi sang "Theo nhóm": dự án nhiều nhóm hiện dưới TỪNG nhóm; cuối cùng "Chưa thuộc nhóm"; số dự án mỗi nhóm', async () => {
    const user = renderPage();
    await screen.findByText('Dự án AAA');
    await user.click(screen.getByRole('radio', { name: /Theo nhóm/ }));
    const infra = await screen.findByRole('region', { name: 'Nhóm Hạ tầng' });
    expect(within(infra).getByText('2 dự án')).toBeTruthy();
    expect(within(infra).getByText('Dự án AAA')).toBeTruthy();
    expect(within(infra).getByText('Dự án BBB')).toBeTruthy();
    const kh = section('Nhóm Khách hàng');
    expect(within(kh).getByText('1 dự án')).toBeTruthy();
    expect(within(kh).getByText('Dự án AAA')).toBeTruthy(); // AAA cũng nằm dưới Khách hàng
    expect(within(section('Nhóm Nhóm rỗng')).getByText('0 dự án')).toBeTruthy();
    const none = section('Chưa thuộc nhóm');
    expect(within(none).getByText('Dự án CCC')).toBeTruthy();
    // thứ tự: nhóm theo tên, "Chưa thuộc nhóm" cuối
    const names = screen.getAllByRole('region').map((r) => r.getAttribute('aria-label'));
    expect(names).toEqual(['Nhóm Hạ tầng', 'Nhóm Khách hàng', 'Nhóm Nhóm rỗng', 'Chưa thuộc nhóm']);
  });

  it('lựa chọn được NHỚ: vào lại trang mở thẳng "Theo nhóm"; ?view=groups thắng lựa chọn đã nhớ', async () => {
    const user = renderPage();
    await screen.findByText('Dự án AAA');
    await user.click(screen.getByRole('radio', { name: /Theo nhóm/ }));
    expect(localStorage.getItem('tirapro:projectsView')).toBe('groups');
    cleanup();
    renderPage();
    expect(await screen.findByRole('region', { name: 'Nhóm Hạ tầng' })).toBeTruthy();
    cleanup();
    localStorage.setItem('tirapro:projectsView', 'list');
    renderPage('/projects?view=groups');
    expect(await screen.findByRole('region', { name: 'Nhóm Hạ tầng' })).toBeTruthy();
  });

  it('nhóm thu gọn / mở được (nút aria-expanded)', async () => {
    const user = renderPage('/projects?view=groups');
    const infra = await screen.findByRole('region', { name: 'Nhóm Hạ tầng' });
    const toggle = within(infra).getByRole('button', { name: /Hạ tầng/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    await user.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    // Nội dung thu gọn được ẩn (`hidden`), không còn hiển thị
    expect(within(infra).getByText('Dự án BBB').closest('[hidden]')).not.toBeNull();
    await user.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(within(infra).getByText('Dự án BBB').closest('[hidden]')).toBeNull();
  });

  it('tìm kiếm áp cho cả hai chế độ: cây chỉ còn nhóm có dự án khớp, tự mở; số dự án theo kết quả', async () => {
    const user = renderPage('/projects?view=groups');
    await screen.findByRole('region', { name: 'Nhóm Hạ tầng' });
    await user.click(within(section('Nhóm Hạ tầng')).getByRole('button', { name: /Hạ tầng/ })); // thu gọn
    await user.type(screen.getByRole('searchbox', { name: 'Tìm dự án' }), 'bbb');
    const infra = await screen.findByRole('region', { name: 'Nhóm Hạ tầng' });
    expect(within(infra).getByText('1 dự án')).toBeTruthy();
    // tìm kiếm mở nhóm đang thu gọn (nội dung không còn bị `hidden`)
    expect(within(infra).getByText('Dự án BBB').closest('[hidden]')).toBeNull();
    // đang tìm kiếm: nút thu/mở tắt (không giả vờ bấm được)
    expect(within(infra).getByRole<HTMLButtonElement>('button', { name: /Hạ tầng/ }).disabled).toBe(
      true,
    );
    expect(screen.queryByRole('region', { name: 'Nhóm Khách hàng' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Nhóm Nhóm rỗng' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Chưa thuộc nhóm' })).toBeNull();
  });

  it('"Hiện đã lưu trữ" lọc dự án lưu trữ ở CẢ HAI chế độ và trong số dự án của từng nhóm', async () => {
    const user = renderPage('/projects?view=groups');
    const infra0 = await screen.findByRole('region', { name: 'Nhóm Hạ tầng' });
    expect(within(infra0).getByText('2 dự án')).toBeTruthy();
    expect(screen.queryByText('Dự án ZZZ')).toBeNull();

    await user.click(screen.getByRole('checkbox', { name: 'Hiện đã lưu trữ' }));
    const infra1 = await screen.findByText('3 dự án');
    expect(infra1).toBeTruthy();
    expect(within(section('Nhóm Hạ tầng')).getByText('Dự án ZZZ')).toBeTruthy();

    await user.click(screen.getByRole('radio', { name: /Danh sách/ }));
    expect(await screen.findByText('Dự án ZZZ')).toBeTruthy();
    await user.click(screen.getByRole('checkbox', { name: 'Hiện đã lưu trữ' }));
    await waitFor(() => expect(screen.queryByText('Dự án ZZZ')).toBeNull());
    await user.click(screen.getByRole('radio', { name: /Theo nhóm/ }));
    expect(
      within(await screen.findByRole('region', { name: 'Nhóm Hạ tầng' })).getByText('2 dự án'),
    ).toBeTruthy();
  });
});

describe('trang Dự án — "Nhóm dự án"', () => {
  it('ai cũng có nút (nhóm là của riêng mình, không cần quyền nào); mở hộp liệt kê nhóm kèm số dự án ĐANG HIỆN (theo công tắc lưu trữ)', async () => {
    const user = renderPage();
    await screen.findByText('Dự án AAA');
    await user.click(screen.getByRole('button', { name: /Nhóm dự án/ }));
    const dlg = await screen.findByRole('dialog', { name: 'Nhóm dự án' });
    await within(dlg).findByText('Hạ tầng');
    const row = (name: string) => within(dlg).getByText(name).closest('li')!;
    expect(within(row('Hạ tầng')).getByText('2 dự án')).toBeTruthy(); // không đếm dự án lưu trữ đang ẩn
    expect(within(row('Nhóm rỗng')).getByText('0 dự án')).toBeTruthy();
  });

  it('người không có quyền nào (chỉ xem) vẫn có nút và tự quản lý nhóm của mình; cột đầu bảng tên "Nhóm dự án"', async () => {
    useAuth.setState({ permissions: [] });
    renderPage();
    await screen.findByText('Dự án AAA');
    expect(screen.getByRole('button', { name: /Nhóm dự án/ })).toBeTruthy();
    expect(screen.getByText('Nhóm dự án', { selector: 'span' })).toBeTruthy();
    // Tạo dự án vẫn theo quyền project:create (không liên quan tới nhóm)
    expect(screen.queryByRole('button', { name: /Tạo dự án/ })).toBeNull();
  });

  it('xoá nhóm: xác nhận rồi DELETE /programs/:id', async () => {
    h.delete.mockResolvedValue({ data: { success: true } });
    const user = renderPage();
    await screen.findByText('Dự án AAA');
    await user.click(screen.getByRole('button', { name: /Nhóm dự án/ }));
    const dlg = await screen.findByRole('dialog', { name: 'Nhóm dự án' });
    await user.click(await within(dlg).findByRole('button', { name: 'Xoá nhóm Nhóm rỗng' }));
    await user.click(await screen.findByRole('button', { name: 'Xoá' }));
    await waitFor(() => expect(h.delete).toHaveBeenCalledWith('/programs/ge'));
  });
});
