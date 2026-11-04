// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ApiModule from '@/lib/api';
import type { Workflow } from './api';

const h = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn() }));
vi.mock('@/lib/api', async (orig) => {
  const real = await orig<typeof ApiModule>();
  return {
    ...real,
    api: { get: h.get, post: vi.fn(), patch: vi.fn(), put: h.put, delete: vi.fn() },
  };
});
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

import { toast } from 'sonner';
import { useAuth } from '@/stores/auth';
import { ConfirmHost, useConfirmStore } from '@/components/ui/useConfirm';
import { WorkflowSettingsPage } from './WorkflowSettingsPage';

const st = (id: string, name: string, category: string, order: number) => ({
  id,
  name,
  category,
  color: null,
  order,
  isInitial: order === 0,
});
const wf = (id: string, name: string, statuses: ReturnType<typeof st>[], usedBy = {}) =>
  ({
    id,
    name,
    description: null,
    isTemplate: false,
    isDefault: false,
    projectId: null,
    statuses,
    transitions: [],
    usedBy: { scheme: [], overrides: [], projects: [], hiddenOverrideCount: 0, ...usedBy },
  }) as unknown as Workflow;

const STD = wf(
  'wfStd',
  'Standard Workflow',
  [st('s-todo', 'To Do', 'TODO', 0), st('s-doing', 'In Progress', 'IN_PROGRESS', 1)],
  { scheme: ['TASK', 'STORY'] },
);
const BUG = wf(
  'wfBug',
  'Bug Workflow',
  [st('b-new', 'New', 'TODO', 0), st('b-retest', 'Ready for Retest', 'IN_PROGRESS', 1)],
  { scheme: ['BUG'], overrides: [{ projectKey: 'GSDA', typeKey: 'BUG' }], hiddenOverrideCount: 2 },
);
const TYPES = [
  { id: 't-task', name: 'Task', key: 'TASK', color: null, isSubtask: false, hierarchyLevel: 0 },
  { id: 't-bug', name: 'Bug', key: 'BUG', color: null, isSubtask: false, hierarchyLevel: 0 },
];

function renderPage(admin: boolean) {
  act(() => {
    useAuth.setState({
      status: 'authed',
      user: { id: 'u', isSystemAdmin: admin } as never,
      permissions: [],
    });
  });
  h.get.mockImplementation((url: string) => {
    if (url === '/workflows') return Promise.resolve({ data: [STD, BUG] });
    if (url === '/workflow-schemes')
      return Promise.resolve({
        data: {
          issueTypes: TYPES,
          items: [
            { issueTypeId: 't-task', workflowId: 'wfStd' },
            { issueTypeId: 't-bug', workflowId: 'wfBug' },
          ],
        },
      });
    if (url === '/projects')
      return Promise.resolve({ data: [{ id: 'p-gsda', key: 'GSDA', name: 'GSDA' }] });
    return Promise.resolve({ data: [] });
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/settings/workflows']}>
        <WorkflowSettingsPage />
        <ConfirmHost />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

const change = (over = {}) => ({
  dryRun: true,
  totalIssues: 5,
  moves: [
    {
      projectId: 'p1',
      projectKey: 'KYHOP',
      issueTypeId: 't-task',
      issueTypeName: 'Task',
      fromStatusId: 'o-1',
      fromStatusName: 'Đang làm',
      toStatusId: 's-doing',
      toStatusName: 'In Progress',
      count: 5,
      suggested: true,
    },
  ],
  affectedRules: [],
  nameRefs: [],
  ...over,
});

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
});
afterEach(cleanup);

describe('Quy trình của tổ chức (bảng loại việc → quy trình)', () => {
  it('Quản trị chung thấy bảng một hàng mỗi loại việc; người khác không thấy mục này', async () => {
    renderPage(true);
    expect(await screen.findByRole('heading', { name: 'Quy trình của tổ chức' })).toBeTruthy();
    expect(
      await screen.findByRole('button', { name: 'Quy trình cho loại việc Task' }),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Quy trình cho loại việc Bug' })).toBeTruthy();
    cleanup();
    renderPage(false);
    await screen.findByText('Standard Workflow');
    expect(screen.queryByRole('heading', { name: 'Quy trình của tổ chức' })).toBeNull();
  });

  it('danh sách quy trình ghi "Dùng cho: loại việc … của tổ chức · ghi đè …" từ usedBy', async () => {
    renderPage(true);
    expect(await screen.findByText(/Dùng cho: loại việc TASK, STORY của tổ chức/)).toBeTruthy();
    expect(
      screen.getByText(/Dùng cho: loại việc BUG của tổ chức · ghi đè GSDA · BUG/),
    ).toBeTruthy();
  });

  it('chọn quy trình khác → Lưu thay đổi mở xem trước (dryRun) → xác nhận PUT kèm statusMapByType; đổi đích được', async () => {
    h.put.mockImplementation((_u: string, _b: unknown, cfg?: { params?: { dryRun?: number } }) =>
      Promise.resolve({ data: change({ dryRun: !!cfg?.params?.dryRun }) }),
    );
    const user = renderPage(true);
    const save = await screen.findByRole('button', { name: 'Lưu thay đổi' });
    expect((save as HTMLButtonElement).disabled).toBe(true);
    await user.click(await screen.findByRole('button', { name: 'Quy trình cho loại việc Task' }));
    await user.click(await screen.findByRole('option', { name: 'Bug Workflow' }));
    await user.click(save);
    const dialog = await screen.findByRole('dialog', { name: /Đổi quy trình của tổ chức/ });
    await waitFor(() => expect(h.put).toHaveBeenCalledTimes(1));
    expect(h.put.mock.calls[0]).toEqual([
      '/workflow-schemes',
      { items: [{ issueTypeId: 't-task', workflowId: 'wfBug' }] },
      { params: { dryRun: 1 } },
    ]);
    expect(await within(dialog).findByText(/5 Task/)).toBeTruthy();
    // Đích gợi ý "In Progress" thuộc quy trình Standard; chọn đích khác trong cùng quy trình đó.
    await user.click(
      within(dialog).getByRole('button', {
        name: 'Trạng thái mới cho Task đang ở Đang làm',
      }),
    );
    await user.click(await screen.findByRole('option', { name: 'To Do' }));
    await user.click(within(dialog).getByRole('button', { name: /Áp dụng và chuyển 5 việc/ }));
    await waitFor(() => expect(h.put).toHaveBeenCalledTimes(2));
    expect(h.put.mock.calls[1]![1]).toEqual({
      items: [{ issueTypeId: 't-task', workflowId: 'wfBug' }],
      statusMapByType: { 't-task': { 'o-1': 's-todo' } },
    });
    expect(h.put.mock.calls[1]![2]?.params).toBeUndefined();
  });

  it('áp dụng thật mà còn cột bảng "ma" (chỉ còn trạng thái cũ) → toast cảnh báo liệt kê MÃ / Bảng / Cột', async () => {
    h.put.mockImplementation((_u: string, _b: unknown, cfg?: { params?: { dryRun?: number } }) =>
      Promise.resolve({
        data: {
          ...change({ dryRun: !!cfg?.params?.dryRun }),
          ...(cfg?.params?.dryRun
            ? {}
            : {
                ghostColumns: ['GSDA / Bảng chính / Đang làm (cũ)'],
                deletedColumns: ['GSDA / Bảng chính / Review code'],
              }),
        },
      }),
    );
    const user = renderPage(true);
    await user.click(await screen.findByRole('button', { name: 'Quy trình cho loại việc Task' }));
    await user.click(await screen.findByRole('option', { name: 'Bug Workflow' }));
    await user.click(await screen.findByRole('button', { name: 'Lưu thay đổi' }));
    const dialog = await screen.findByRole('dialog', { name: /Đổi quy trình của tổ chức/ });
    await user.click(
      await within(dialog).findByRole('button', { name: /Áp dụng và chuyển 5 việc/ }),
    );
    await waitFor(() => expect(toast.warning).toHaveBeenCalledTimes(1));
    expect(toast.info).toHaveBeenCalledWith(
      'Đã xoá 1 cột bảng chỉ còn trạng thái cũ và không còn việc',
      expect.objectContaining({ description: 'GSDA / Bảng chính / Review code' }),
    );
    expect(vi.mocked(toast.warning).mock.calls[0]![0]).toBe(
      '1 cột bảng chỉ còn trạng thái của quy trình cũ',
    );
    expect(
      (vi.mocked(toast.warning).mock.calls[0]![1] as { description: string }).description,
    ).toContain('GSDA / Bảng chính / Đang làm (cũ)');
  });

  it('dự án dùng quy trình riêng: "Quay về dùng chung" xem trước rồi PUT workflowId:null cho đúng dự án/loại', async () => {
    h.put.mockImplementation((_u: string, _b: unknown, cfg?: { params?: { dryRun?: number } }) =>
      Promise.resolve({
        data: change({ dryRun: !!cfg?.params?.dryRun, moves: [], totalIssues: 0 }),
      }),
    );
    const user = renderPage(true);
    await user.click(await screen.findByRole('button', { name: 'Quay về dùng chung: GSDA · Bug' }));
    const dialog = await screen.findByRole('dialog', { name: /Quay về dùng chung — GSDA · Bug/ });
    await user.click(await within(dialog).findByRole('button', { name: 'Áp dụng' }));
    await waitFor(() => expect(h.put).toHaveBeenCalledTimes(2));
    expect(h.put.mock.calls[1]![0]).toBe('/projects/p-gsda/workflow-overrides');
    expect(h.put.mock.calls[1]![1]).toEqual({
      issueTypeId: 't-bug',
      workflowId: null,
      statusMap: {},
    });
    expect(screen.getByText('+2 ghi đè ở dự án bạn không xem được')).toBeTruthy();
  });

  it('một nhóm trải nhiều dự án ghi "Áp chung cho N dự án"; quy tắc toàn tổ chức chỉ được báo "cần quản trị chung xem lại"', async () => {
    const base = change();
    h.put.mockResolvedValue({
      data: change({
        moves: [base.moves[0], { ...base.moves[0], projectId: 'p2', projectKey: 'GSDA', count: 3 }],
        totalIssues: 8,
        affectedRules: [
          {
            ruleId: 'rw',
            name: 'Quy tắc toàn tổ chức',
            projectId: null,
            createdById: 'u',
            wasEnabled: true,
            outcome: 'needsReview',
            statusRefs: [],
          },
        ],
      }),
    });
    const user = renderPage(true);
    await user.click(await screen.findByRole('button', { name: 'Quy trình cho loại việc Task' }));
    await user.click(await screen.findByRole('option', { name: 'Bug Workflow' }));
    await user.click(await screen.findByRole('button', { name: 'Lưu thay đổi' }));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('Áp chung cho 2 dự án')).toBeTruthy();
    expect(within(dialog).getByText(/Áp toàn tổ chức — cần quản trị chung xem lại/)).toBeTruthy();
    expect(within(dialog).queryByText('Sẽ được sửa')).toBeNull();
  });
});
