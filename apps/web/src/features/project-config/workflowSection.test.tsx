// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ApiModule from '@/lib/api';

type PutArgs = [url: string, body: unknown, cfg?: { params?: { dryRun?: number } }];
const h = vi.hoisted(() => ({
  get: vi.fn(),
  put: vi.fn<(...a: PutArgs) => Promise<unknown>>(),
  del: vi.fn(),
}));
vi.mock('@/lib/api', async (orig) => {
  const real = await orig<typeof ApiModule>();
  return {
    ...real,
    api: { get: h.get, post: vi.fn(), patch: vi.fn(), put: h.put, delete: h.del },
  };
});
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

import { useAuth } from '@/stores/auth';
import { ConfirmHost, useConfirmStore } from '@/components/ui/useConfirm';
import { ConfigSection } from './ProjectConfigPage';

const st = (id: string, name: string, category: string, order: number) => ({
  id,
  name,
  category,
  color: null,
  order,
  isInitial: order === 0,
});
const wf = (id: string, name: string, statuses: ReturnType<typeof st>[]) => ({
  id,
  name,
  description: null,
  isTemplate: false,
  isDefault: false,
  projectId: null,
  statuses,
  transitions: [],
  usedBy: { scheme: [], overrides: [], projects: [], hiddenOverrideCount: 0 },
});
const STD = wf('wfStd', 'Standard Workflow', [
  st('s-todo', 'To Do', 'TODO', 0),
  st('s-doing', 'In Progress', 'IN_PROGRESS', 1),
  st('s-done', 'Done', 'DONE', 2),
]);
const BUG = wf('wfBug', 'Bug Workflow', [
  st('b-new', 'New', 'TODO', 0),
  st('b-doing', 'In Progress', 'IN_PROGRESS', 1),
  st('b-done', 'Done', 'DONE', 2),
]);
const COPY = { ...wf('wfCopy', 'Standard Workflow (THCHUNG)', STD.statuses), projectId: 'p1' };
const TYPES = [
  { id: 't-task', name: 'Task', key: 'TASK', color: null, isSubtask: false, hierarchyLevel: 0 },
  { id: 't-bug', name: 'Bug', key: 'BUG', color: null, isSubtask: false, hierarchyLevel: 0 },
];
const project = {
  id: 'p1',
  key: 'THCHUNG',
  name: 'Tổng hợp chung',
  archivedAt: null,
  isPrivate: false,
};

/** Task theo tổ chức (Standard); Bug đang dùng quy trình riêng (bản chép). */
const scheme = () => ({
  projectId: 'p1',
  issueTypes: TYPES,
  items: [
    { issueTypeId: 't-task', workflowId: 'wfStd', isOverride: false, workspaceWorkflowId: 'wfStd' },
    { issueTypeId: 't-bug', workflowId: 'wfCopy', isOverride: true, workspaceWorkflowId: 'wfBug' },
  ],
});

const preview = (over: Record<string, unknown> = {}) => ({
  dryRun: true,
  totalIssues: 12,
  moves: [
    {
      projectId: 'p1',
      projectKey: 'THCHUNG',
      issueTypeId: 't-task',
      issueTypeName: 'Task',
      fromStatusId: 'o-test',
      fromStatusName: 'Chờ test',
      toStatusId: 's-doing',
      toStatusName: 'In Progress',
      count: 12,
      suggested: true,
    },
  ],
  affectedRules: [],
  nameRefs: [],
  ...over,
});

function renderRoute(perms: string[], projectOver: Record<string, unknown> = {}) {
  act(() => {
    useAuth.setState({
      status: 'authed',
      user: { id: 'u', isSystemAdmin: false } as never,
      permissions: [],
    });
  });
  h.get.mockImplementation((url: string) => {
    if (url === '/projects/THCHUNG')
      return Promise.resolve({ data: { ...project, ...projectOver } });
    if (url === '/projects/p1/permissions/me')
      return Promise.resolve({ data: { projectId: 'p1', permissions: perms } });
    if (url === '/projects/p1/workflow-overrides') return Promise.resolve({ data: scheme() });
    if (url === '/workflows') return Promise.resolve({ data: [STD, BUG, COPY] });
    return Promise.resolve({ data: [] });
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/p/THCHUNG/config/workflow']}>
        <Routes>
          <Route path="/p/:key/config/:section" element={<ConfigSection />} />
        </Routes>
        <ConfirmHost />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return Object.assign(userEvent.setup(), { qc });
}

async function pick(user: ReturnType<typeof userEvent.setup>, label: string, option: RegExp) {
  await screen.findByText('Standard Workflow (THCHUNG)');
  await user.click(await screen.findByRole('button', { name: label }));
  await user.click(await screen.findByRole('option', { name: option }));
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
  h.get.mockReset();
  h.put.mockReset();
  h.del.mockReset();
});
afterEach(cleanup);

describe('Cấu hình dự án → Quy trình', () => {
  it('route /p/THCHUNG/config/workflow là mục thật: mỗi loại việc một hàng, huy hiệu Theo tổ chức / Riêng của dự án', async () => {
    renderRoute(['project:admin']);
    const task = await screen.findByText('Standard Workflow');
    expect(task).toBeTruthy();
    const rows = await screen.findAllByRole('listitem');
    const taskRow = rows.find((r) => r.getAttribute('data-type-row') === 't-task')!;
    const bugRow = rows.find((r) => r.getAttribute('data-type-row') === 't-bug')!;
    expect(within(taskRow).getByText('Theo tổ chức')).toBeTruthy();
    expect(within(bugRow).getByText('Riêng của dự án')).toBeTruthy();
    expect(within(bugRow).getByText('Standard Workflow (THCHUNG)')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Quy trình' })).toBeTruthy();
  });

  it('Developer (không phải quản trị dự án) chỉ xem: không có ô chọn, vẫn có "Xem sơ đồ"', async () => {
    renderRoute(['project:view', 'issue:create']);
    await screen.findByText('Standard Workflow');
    expect(screen.queryByLabelText(/Quy trình cho loại việc/)).toBeNull();
    expect(screen.getAllByRole('button', { name: /Xem sơ đồ quy trình/ }).length).toBe(2);
    expect(h.put).not.toHaveBeenCalled();
  });

  it('Quản trị dự án đổi ô chọn → xem trước (dryRun) → xác nhận mới PUT thật kèm trạng thái đích', async () => {
    h.put.mockImplementation((_u: string, _b: unknown, cfg?: { params?: { dryRun?: number } }) =>
      Promise.resolve({
        data: cfg?.params?.dryRun ? preview() : preview({ dryRun: false }),
      }),
    );
    const user = renderRoute(['project:admin']);
    await pick(user, 'Quy trình cho loại việc Task', /^Bug Workflow$/);
    const dialog = await screen.findByRole('dialog', { name: /Quy trình của dự án — Task/ });
    // Đã xem trước (dryRun) nhưng CHƯA ghi thật.
    await waitFor(() => expect(h.put).toHaveBeenCalledTimes(1));
    expect(h.put.mock.calls[0]![2]).toMatchObject({ params: { dryRun: 1 } });
    expect(await within(dialog).findByText(/12 Task/)).toBeTruthy();
    expect(within(dialog).getByText('Chờ test')).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: /Áp dụng và chuyển 12 việc/ }));
    await waitFor(() => expect(h.put).toHaveBeenCalledTimes(2));
    const [url, body, cfg] = h.put.mock.calls[1]!;
    expect(url).toBe('/projects/p1/workflow-overrides');
    expect(body).toEqual({
      issueTypeId: 't-task',
      workflowId: 'wfBug',
      statusMap: { 'o-test': 's-doing' },
    });
    expect(cfg?.params).toBeUndefined();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('"Theo tổ chức" quay về dùng chung bằng PUT workflowId:null (không DELETE)', async () => {
    h.put.mockImplementation((_u: string, _b: unknown, cfg?: { params?: { dryRun?: number } }) =>
      Promise.resolve({
        data: preview({ dryRun: !!cfg?.params?.dryRun, moves: [], totalIssues: 0 }),
      }),
    );
    const user = renderRoute(['project:admin']);
    await pick(user, 'Quy trình cho loại việc Bug', /^Theo tổ chức \(Bug Workflow\)$/);
    const dialog = await screen.findByRole('dialog', { name: /Quy trình của dự án — Bug/ });
    expect(await within(dialog).findByText(/Không có việc nào phải chuyển/)).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Áp dụng' }));
    await waitFor(() => expect(h.put).toHaveBeenCalledTimes(2));
    expect(h.put.mock.calls[1]![1]).toEqual({
      issueTypeId: 't-bug',
      workflowId: null,
      statusMap: {},
    });
    expect(h.del).not.toHaveBeenCalled();
  });
});

describe('Cấu hình dự án → Quy trình — xem trước, lỗi và làm mới', () => {
  it('xem trước hiện quy tắc bị ảnh hưởng (trước → sau, quy tắc bị tắt) và bộ lọc theo tên sẽ hết khớp', async () => {
    h.put.mockResolvedValue({
      data: preview({
        affectedRules: [
          {
            ruleId: 'r1',
            name: 'Báo khi xong',
            projectId: null,
            createdById: 'u',
            wasEnabled: true,
            outcome: 'rewritten',
            statusRefs: [
              {
                fromId: 'o-test',
                fromName: 'Chờ test',
                toIds: ['s-doing'],
                toNames: ['In Progress'],
              },
            ],
          },
          {
            ruleId: 'r2',
            name: 'Quy tắc mồ côi',
            projectId: null,
            createdById: 'u',
            wasEnabled: true,
            outcome: 'disabled',
            statusRefs: [{ fromId: 'x', fromName: 'Cũ', toIds: [], toNames: [] }],
          },
        ],
        nameRefs: [
          { kind: 'savedFilter', id: 'f1', label: 'Đang làm của tôi', names: ['Đang làm'] },
          { kind: 'boardFilter', id: 'b1', label: 'THCHUNG / Bảng', names: ['Chờ test'] },
        ],
      }),
    });
    const user = renderRoute(['project:admin']);
    await pick(user, 'Quy trình cho loại việc Task', /^Bug Workflow$/);
    const dialog = await screen.findByRole('dialog');
    const rule = await within(dialog).findByText('Báo khi xong');
    expect(rule.closest('[data-rule-row]')!.textContent).toContain('Chờ test');
    expect(rule.closest('[data-rule-row]')!.textContent).toContain('In Progress');
    expect(within(dialog).getByText('Sẽ bị tắt')).toBeTruthy();
    expect(within(dialog).getByText('Đang làm của tôi')).toBeTruthy();
    expect(within(dialog).getByText('Bộ lọc đã lưu', { exact: false })).toBeTruthy();
    expect(within(dialog).getByText(/Tên không còn: Đang làm/)).toBeTruthy();
  });

  it('BUSINESS_RULE_VIOLATION ở bước xem trước hiện thông báo trong hộp và không cho xác nhận', async () => {
    const err = Object.assign(new Error('x'), {
      isAxiosError: true,
      response: {
        status: 422,
        data: {
          error: {
            code: 'BUSINESS_RULE_VIOLATION',
            message: 'Dự án đã lưu trữ — hãy khôi phục trước.',
          },
        },
      },
    });
    h.put.mockRejectedValue(err);
    const user = renderRoute(['project:admin']);
    await pick(user, 'Quy trình cho loại việc Task', /^Bug Workflow$/);
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText(/Dự án đã lưu trữ — hãy khôi phục trước/)).toBeTruthy();
    expect(
      within(dialog).getByRole<HTMLButtonElement>('button', { name: /Áp dụng/ }).disabled,
    ).toBe(true);
  });

  it('STATUS_MAPPING_REQUIRED khi áp dụng: đánh dấu dòng còn thiếu, giữ hộp để chọn tiếp', async () => {
    const mapping = Object.assign(new Error('x'), {
      isAxiosError: true,
      response: {
        status: 422,
        data: {
          error: {
            code: 'STATUS_MAPPING_REQUIRED',
            message: 'Hãy chọn trạng thái mới cho việc loại "Task" đang ở "Chờ test"',
            details: [{ field: 'statusMap.o-test', code: 'STATUS_MAPPING_REQUIRED', message: 'm' }],
          },
        },
      },
    });
    h.put.mockImplementation((_u: string, _b: unknown, cfg?: { params?: { dryRun?: number } }) =>
      cfg?.params?.dryRun ? Promise.resolve({ data: preview() }) : Promise.reject(mapping),
    );
    const user = renderRoute(['project:admin']);
    await pick(user, 'Quy trình cho loại việc Task', /^Bug Workflow$/);
    const dialog = await screen.findByRole('dialog');
    await user.click(await within(dialog).findByRole('button', { name: /Áp dụng và chuyển/ }));
    expect(
      await within(dialog).findByText(/Hãy chọn trạng thái mới cho việc loại "Task"/),
    ).toBeTruthy();
    const row = dialog.querySelector('[data-move-row="t-task:o-test"]')!;
    expect(row.className).toContain('bg-danger');
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('hàng đang dùng quy trình RIÊNG của dự án không còn "Tạo bản riêng"; hàng theo tổ chức thì còn', async () => {
    const user = renderRoute(['project:admin']);
    await screen.findByText('Standard Workflow (THCHUNG)');
    await user.click(await screen.findByRole('button', { name: 'Quy trình cho loại việc Bug' }));
    expect(await screen.findByRole('option', { name: /^Theo tổ chức/ })).toBeTruthy();
    expect(screen.queryByRole('option', { name: /Tạo bản riêng/ })).toBeNull();
    await user.keyboard('{Escape}');
    await user.click(await screen.findByRole('button', { name: 'Quy trình cho loại việc Task' }));
    expect(
      await screen.findByRole('option', { name: /Tạo bản riêng từ Standard Workflow/ }),
    ).toBeTruthy();
  });

  it('dự án đã lưu trữ: chỉ xem và ghi chú nói rõ dự án đã lưu trữ (khôi phục để sửa), không bảo "nhờ quản trị chung"', async () => {
    renderRoute(['project:admin'], { archivedAt: '2026-10-01T00:00:00Z' });
    await screen.findByText('Standard Workflow');
    expect(screen.queryByLabelText(/Quy trình cho loại việc/)).toBeNull();
    expect(screen.getByRole('note').textContent).toMatch(
      /Dự án đã lưu trữ — hãy khôi phục dự án để sửa/,
    );
    expect(screen.queryByText(/nhờ quản trị chung/)).toBeNull();
  });

  it('áp dụng chỉ làm mới quy trình/việc/bảng/sprint/quy tắc — không làm mới toàn bộ cache', async () => {
    h.put.mockImplementation((_u: string, _b: unknown, cfg?: { params?: { dryRun?: number } }) =>
      Promise.resolve({ data: preview({ dryRun: !!cfg?.params?.dryRun }) }),
    );
    const user = renderRoute(['project:admin']);
    const spy = vi.spyOn(user.qc, 'invalidateQueries');
    await pick(user, 'Quy trình cho loại việc Task', /^Bug Workflow$/);
    const dialog = await screen.findByRole('dialog');
    await user.click(await within(dialog).findByRole('button', { name: /Áp dụng và chuyển/ }));
    await waitFor(() => expect(spy).toHaveBeenCalled());
    const roots = spy.mock.calls.map((c) => (c[0] as { queryKey: string[] }).queryKey[0]).sort();
    expect(roots).toEqual(['automation', 'boards', 'issues', 'sprints', 'workflows']);
  });
});
