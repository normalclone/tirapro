// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BoardDto } from '@tirapro/types';
import type * as ApiModule from '@/lib/api';
import { defaultWorkflow, statusIdOf } from '@/features/issues/workflowFixtures';

const h = vi.hoisted(() => ({
  put: vi.fn(),
  /** Việc của dự án (chỉ cần `status.id`). */
  issues: vi.fn((): unknown[] => []),
}));
vi.mock('@/lib/api', async (orig) => {
  const real = await orig<typeof ApiModule>();
  const fx = await import('@/features/issues/workflowFixtures');
  const std = fx.defaultWorkflow('STANDARD');
  return {
    ...real,
    api: {
      put: h.put,
      patch: vi.fn(),
      post: vi.fn(),
      get: vi.fn((url: string) => {
        if (url === '/projects/p1/workflow-overrides')
          return Promise.resolve({
            data: {
              projectId: 'p1',
              issueTypes: [],
              items: [
                {
                  issueTypeId: 't1',
                  workflowId: std.id,
                  isOverride: false,
                  workspaceWorkflowId: std.id,
                },
              ],
            },
          });
        if (url === '/workflows') return Promise.resolve({ data: [std] });
        if (url.startsWith('/issues?'))
          return Promise.resolve({ data: { data: h.issues(), pageInfo: { hasNextPage: false } } });
        return Promise.resolve({ data: [] });
      }),
    },
  };
});
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

import { BoardSettingsDialog } from './BoardSettingsDialog';

const OPEN = true as boolean;
const std = defaultWorkflow('STANDARD');
/** Bảng đã chuyển đổi: cột còn mang theo trạng thái của quy trình cũ (không còn trong quy trình nào đang dùng). */
const board = (): BoardDto => ({
  id: 'b1',
  projectId: 'p1',
  name: 'Bảng',
  type: 'KANBAN',
  filterJql: null,
  swimlaneBy: 'none',
  columns: std.statuses.map((s, order) => ({
    id: `c${order}`,
    boardId: 'b1',
    name: s.name,
    order,
    wipLimit: null,
    statusIds:
      order === 0
        ? [statusIdOf('STANDARD', s.name), 'legacy-status']
        : [statusIdOf('STANDARD', s.name)],
  })),
});

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  h.put.mockReset();
  h.issues.mockReset();
  h.issues.mockReturnValue([]);
});
afterEach(cleanup);

describe('Cài đặt bảng: trạng thái không còn thuộc quy trình nào đang dùng', () => {
  function setup() {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <BoardSettingsDialog open={OPEN} onClose={() => undefined} projectId="p1" board={board()} />
      </QueryClientProvider>,
    );
    return userEvent.setup();
  }

  it('hiện "Trạng thái không còn dùng" (không phải "đã xoá") kèm ghi chú và nút Bỏ khỏi bảng', async () => {
    setup();
    expect(await screen.findByText('Trạng thái không còn dùng')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain(
      '1 trạng thái trong cột không còn thuộc quy trình',
    );
    expect(screen.queryByText('Trạng thái đã xoá')).toBeNull();
  });

  it('còn việc ở trạng thái cũ: chip và ghi chú nêu số việc, nút Bỏ khỏi bảng bị tắt (việc sẽ biến mất khỏi bảng)', async () => {
    h.issues.mockReturnValue([
      { id: 'i1', status: { id: 'legacy-status' } },
      { id: 'i2', status: { id: 'legacy-status' } },
    ]);
    setup();
    expect(await screen.findByText('Trạng thái không còn dùng · 2 việc')).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toContain('Còn 2 việc đang ở đó'),
    );
    const btn = screen.getByRole('button', { name: /Bỏ khỏi bảng/ });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });

  it('"Bỏ khỏi bảng" gỡ chúng khỏi mọi cột, ghi chú biến mất', async () => {
    const user = setup();
    await screen.findByText('Trạng thái không còn dùng');
    await user.click(screen.getByRole('button', { name: 'Bỏ khỏi bảng' }));
    await waitFor(() => expect(screen.queryByText('Trạng thái không còn dùng')).toBeNull());
    expect(screen.queryByRole('button', { name: 'Bỏ khỏi bảng' })).toBeNull();
  });
});
