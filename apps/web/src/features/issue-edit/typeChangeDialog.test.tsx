// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AxiosError, type AxiosResponse } from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IssueDto } from '@tirapro/types';
import type * as ApiModule from '@/lib/api';
import { defaultWorkflow, statusIdOf } from '@/features/issues/workflowFixtures';
import { mk } from '@/lib/issueFixture';

const h = vi.hoisted(() => ({ patch: vi.fn() }));
vi.mock('@/lib/api', async (orig) => {
  const real = await orig<typeof ApiModule>();
  const bugWf = (await import('@/features/issues/workflowFixtures')).defaultWorkflow('BUG');
  const stdWf = (await import('@/features/issues/workflowFixtures')).defaultWorkflow('STANDARD');
  return {
    ...real,
    api: {
      patch: h.patch,
      get: vi.fn((url: string) => {
        if (url === '/workflows') return Promise.resolve({ data: [stdWf, bugWf] });
        if (url === '/projects/p1/workflow-overrides')
          return Promise.resolve({
            data: {
              projectId: 'p1',
              issueTypes: [],
              items: [
                {
                  issueTypeId: 'ty-task',
                  workflowId: stdWf.id,
                  isOverride: false,
                  workspaceWorkflowId: stdWf.id,
                },
                {
                  issueTypeId: 'ty-bug',
                  workflowId: bugWf.id,
                  isOverride: false,
                  workspaceWorkflowId: bugWf.id,
                },
              ],
            },
          });
        if (url === '/projects')
          return Promise.resolve({ data: [{ id: 'p1', key: 'KYHOP', name: 'KYHOP' }] });
        if (url === '/projects/KYHOP/meta')
          return Promise.resolve({
            data: {
              issueTypes: [
                { id: 'ty-task', name: 'Task', key: 'TASK', color: null },
                { id: 'ty-bug', name: 'Bug', key: 'BUG', color: null },
              ],
            },
          });
        return Promise.reject(new Error(`unexpected GET ${url}`));
      }),
    },
  };
});
vi.mock('@/features/projects/permissions', () => ({
  useCanEditIssue: () => () => true,
  useCanIn: () => () => true,
}));
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

import { toast } from 'sonner';
import { IssueTypeSelect } from './IssueProperties';

const stdStatus = (name: string) => ({
  id: statusIdOf('STANDARD', name),
  workflowId: 'wf-standard',
  name,
  category: 'IN_PROGRESS' as const,
  color: null,
  order: 2,
  isInitial: false,
});

/** Task đang In Review (quy trình Standard), cùng dự án với Bug. */
const taskInReview = (): IssueDto =>
  mk('t1', {
    projectId: 'p1',
    version: 7,
    type: {
      id: 'ty-task',
      name: 'Task',
      key: 'TASK',
      iconUrl: null,
      color: null,
      hierarchyLevel: 0,
      isSubtask: false,
    },
    status: stdStatus('In Review'),
  });

const mappingError = (suggested: string) =>
  new AxiosError('422', 'ERR_BAD_REQUEST', undefined, undefined, {
    status: 422,
    data: {
      success: false,
      error: {
        code: 'STATUS_MAPPING_REQUIRED',
        message: 'Hãy chọn trạng thái trong quy trình mới',
        details: [
          {
            field: 'targetStatusId',
            code: 'STATUS_MAPPING_REQUIRED',
            message: 'Hãy chọn trạng thái trong quy trình mới cho việc đang ở "In Review"',
            suggestedStatusId: suggested,
          },
        ],
      },
    },
  } as AxiosResponse);

function setup(issue: IssueDto) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <IssueTypeSelect issue={issue} />
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

beforeEach(() => {
  // jsdom không có scrollIntoView (SearchSelect gọi khi mở danh sách).
  Element.prototype.scrollIntoView = vi.fn();
  h.patch.mockReset();
  vi.mocked(toast.error).mockReset();
});
afterEach(cleanup);

async function pickBug(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'Loại việc' }));
  await user.click(await screen.findByRole('option', { name: /Bug/ }));
}

describe('Đổi loại Task → Bug (khác quy trình) hỏi trạng thái trong quy trình mới', () => {
  it('422 STATUS_MAPPING_REQUIRED → mở hộp, chọn sẵn gợi ý của máy chủ, gửi lại kèm targetStatusId', async () => {
    const suggested = statusIdOf('BUG', 'In Progress');
    h.patch.mockRejectedValueOnce(mappingError(suggested));
    h.patch.mockResolvedValueOnce({
      data: { ...taskInReview(), status: { ...stdStatus('In Progress'), id: suggested } },
    });
    const user = setup(taskInReview());
    await pickBug(user);

    const dialog = await screen.findByRole('dialog', {
      name: 'Chọn trạng thái trong quy trình mới',
    });
    // Chỉ liệt kê trạng thái của quy trình Bug (không có "Rework", "Ready" của Standard).
    expect(within(dialog).getByRole('radio', { name: 'Ready for Retest' })).toBeTruthy();
    expect(within(dialog).queryByRole('radio', { name: 'Rework' })).toBeNull();
    expect(
      within(dialog).getByRole('radio', { name: 'In Progress' }).getAttribute('aria-checked'),
    ).toBe('true');
    expect(h.patch).toHaveBeenCalledTimes(1);
    expect(h.patch.mock.calls[0]![1]).toEqual({ typeId: 'ty-bug', version: 7 });

    await user.click(within(dialog).getByRole('button', { name: 'Đổi loại và chuyển' }));
    await waitFor(() => expect(h.patch).toHaveBeenCalledTimes(2));
    expect(h.patch.mock.calls[1]![1]).toEqual({
      typeId: 'ty-bug',
      targetStatusId: suggested,
      version: 7,
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('đổi trạng thái đích trong hộp → gửi trạng thái đã chọn; Huỷ thì không gửi lần hai', async () => {
    h.patch.mockRejectedValueOnce(mappingError(statusIdOf('BUG', 'In Progress')));
    h.patch.mockResolvedValueOnce({ data: taskInReview() });
    const user = setup(taskInReview());
    await pickBug(user);
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('radio', { name: 'Ready for Retest' }));
    await user.click(within(dialog).getByRole('button', { name: 'Đổi loại và chuyển' }));
    await waitFor(() => expect(h.patch).toHaveBeenCalledTimes(2));
    expect(h.patch.mock.calls[1]![1]).toMatchObject({
      targetStatusId: statusIdOf('BUG', 'Ready for Retest'),
    });
  });

  it('Huỷ hộp → không đổi gì thêm', async () => {
    h.patch.mockRejectedValueOnce(mappingError(statusIdOf('BUG', 'In Progress')));
    const user = setup(taskInReview());
    await pickBug(user);
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Huỷ' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(h.patch).toHaveBeenCalledTimes(1);
  });

  it('lỗi khác (vd luật nghiệp vụ) → toast, KHÔNG mở hộp', async () => {
    h.patch.mockRejectedValueOnce(
      new AxiosError('422', 'ERR_BAD_REQUEST', undefined, undefined, {
        status: 422,
        data: {
          success: false,
          error: { code: 'BUSINESS_RULE_VIOLATION', message: 'Không đổi loại được' },
        },
      } as AxiosResponse),
    );
    const user = setup(taskInReview());
    await pickBug(user);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Không đổi loại được'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('422 không kèm gợi ý trạng thái', () => {
  const noSuggestion = () =>
    new AxiosError('422', 'ERR_BAD_REQUEST', undefined, undefined, {
      status: 422,
      data: {
        success: false,
        error: {
          code: 'STATUS_MAPPING_REQUIRED',
          message: 'Hãy chọn trạng thái trong quy trình mới',
        },
      },
    } as AxiosResponse);

  it('vẫn mở hộp: liệt kê trạng thái quy trình của loại mới (tra từ cấu hình dự án), KHÔNG chọn sẵn, phải chọn rồi mới gửi', async () => {
    h.patch.mockRejectedValueOnce(noSuggestion());
    h.patch.mockResolvedValueOnce({ data: taskInReview() });
    const user = setup(taskInReview());
    await pickBug(user);
    const dialog = await screen.findByRole('dialog', {
      name: 'Chọn trạng thái trong quy trình mới',
    });
    const retest = await within(dialog).findByRole('radio', { name: 'Ready for Retest' });
    expect(within(dialog).queryByRole('radio', { name: 'Rework' })).toBeNull();
    for (const r of within(dialog).getAllByRole('radio'))
      expect(r.getAttribute('aria-checked')).toBe('false');
    const send = within(dialog).getByRole('button', { name: 'Đổi loại và chuyển' });
    expect((send as HTMLButtonElement).disabled).toBe(true);
    await user.click(retest);
    await user.click(send);
    await waitFor(() => expect(h.patch).toHaveBeenCalledTimes(2));
    expect(h.patch.mock.calls[1]![1]).toEqual({
      typeId: 'ty-bug',
      targetStatusId: statusIdOf('BUG', 'Ready for Retest'),
      version: 7,
    });
  });
});

describe('quy trình mặc định dùng trong test', () => {
  it('Bug và Task cùng dự án nhưng trạng thái khác id', () => {
    expect(defaultWorkflow('BUG').statuses.find((s) => s.name === 'To Do')!.id).not.toBe(
      defaultWorkflow('STANDARD').statuses.find((s) => s.name === 'To Do')!.id,
    );
  });
});
