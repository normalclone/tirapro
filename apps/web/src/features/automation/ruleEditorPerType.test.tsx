// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ApiModule from '@/lib/api';
import { defaultWorkflow, statusIdOf } from '@/features/issues/workflowFixtures';
import type { AutomationRule } from './rules-api';

const h = vi.hoisted(() => ({ patch: vi.fn() }));
vi.mock('@/lib/api', async (orig) => {
  const real = await orig<typeof ApiModule>();
  const fx = await import('@/features/issues/workflowFixtures');
  const flows = [fx.defaultWorkflow('STANDARD'), fx.defaultWorkflow('BUG')];
  return {
    ...real,
    api: {
      patch: h.patch,
      post: vi.fn(),
      get: vi.fn((url: string) => {
        if (url === '/workflows') return Promise.resolve({ data: flows });
        if (url === '/projects') return Promise.resolve({ data: [] });
        if (url.endsWith('/meta'))
          return Promise.resolve({ data: { priorities: [], issueTypes: [], resolutions: [] } });
        return Promise.resolve({ data: [] });
      }),
    },
  };
});
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

import { RuleEditor } from './RuleEditor';

const STD_DONE = statusIdOf('STANDARD', 'Done');
const BUG_DONE = statusIdOf('BUG', 'Done');

/** Quy tắc sau khi hệ thống đổi quy trình: "Done" của Task kèm "Done" của Bug (cùng ý nghĩa ở quy trình khác). */
const migrated = (): AutomationRule =>
  ({
    id: 'r1',
    workspaceId: 'w',
    projectId: null,
    name: 'Khi xong thì báo',
    enabled: true,
    trigger: 'ISSUE_TRANSITIONED',
    triggerConfig: { toStatusId: STD_DONE, toStatusIds: [BUG_DONE] },
    conditions: [],
    actions: [{ type: 'transition', toStatusId: STD_DONE, alsoStatusIds: [BUG_DONE] }],
  }) as unknown as AutomationRule;

function setup(rule: AutomationRule) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <RuleEditor open rule={rule} defaultProjectId="" onClose={() => undefined} />
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  h.patch.mockReset();
  h.patch.mockResolvedValue({ data: migrated() });
});
afterEach(cleanup);

describe('Sửa quy tắc đã được hệ thống mở rộng theo quy trình của từng loại việc', () => {
  it('nói rõ quy tắc còn áp dụng cho trạng thái cùng ý nghĩa ở quy trình khác', async () => {
    setup(migrated());
    const notes = await screen.findAllByRole('note');
    expect(notes.length).toBe(2); // một ở sự kiện kích hoạt, một ở hành động chuyển trạng thái
    for (const n of notes) {
      expect(n.textContent).toContain('Done (Bug Workflow)');
      expect(n.textContent).toContain('cùng ý nghĩa ở quy trình khác');
    }
  });

  it('lưu không đụng tới trạng thái đích → giữ nguyên toStatusIds và alsoStatusIds', async () => {
    const user = setup(migrated());
    await screen.findAllByRole('note');
    await user.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));
    await waitFor(() => expect(h.patch).toHaveBeenCalledTimes(1));
    const body = h.patch.mock.calls[0]![1];
    expect(body.triggerConfig).toEqual({ toStatusId: STD_DONE, toStatusIds: [BUG_DONE] });
    expect(body.actions).toEqual([
      { type: 'transition', toStatusId: STD_DONE, alsoStatusIds: [BUG_DONE] },
    ]);
  });

  it('chọn trạng thái đích khác → bỏ các đích thay thế cũ (không để lại đích mồ côi)', async () => {
    const user = setup(migrated());
    await screen.findAllByRole('note');
    const trigger = screen.getAllByRole('button', { name: 'Trạng thái đích' })[0]!;
    await user.click(trigger);
    // Danh sách gom theo quy trình: chọn "In Review" của Standard Workflow.
    const list = await screen.findByRole('listbox');
    await user.click(within(list).getByRole('option', { name: /In Review/ }));
    await waitFor(() => expect(screen.getAllByRole('note').length).toBe(1));
    await user.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));
    await waitFor(() => expect(h.patch).toHaveBeenCalledTimes(1));
    expect(h.patch.mock.calls[0]![1].triggerConfig).toEqual({
      toStatusId: statusIdOf('STANDARD', 'In Review'),
    });
    expect(h.patch.mock.calls[0]![1].actions[0].alsoStatusIds).toEqual([BUG_DONE]);
  });

  it('danh sách trạng thái gom theo quy trình (tiêu đề nhóm Standard / Bug)', async () => {
    const user = setup(migrated());
    await screen.findAllByRole('note');
    await user.click(screen.getAllByRole('button', { name: 'Trạng thái đích' })[0]!);
    const list = await screen.findByRole('listbox');
    expect(within(list).getByText('Standard Workflow')).toBeTruthy();
    expect(within(list).getByText('Bug Workflow')).toBeTruthy();
    expect(defaultWorkflow('BUG').name).toBe('Bug Workflow');
  });
});
