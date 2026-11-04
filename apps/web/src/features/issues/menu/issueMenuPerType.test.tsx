// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IssueDto } from '@tirapro/types';
import type * as ApiModule from '@/lib/api';
import { defaultWorkflow, statusIdOf } from '../workflowFixtures';
import { TYPES, mk } from '@/lib/issueFixture';

const h = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/lib/api', async (orig) => {
  const real = await orig<typeof ApiModule>();
  return { ...real, api: { get: h.get, post: vi.fn(), patch: vi.fn() } };
});
vi.mock('@/features/projects/permissions', () => ({
  useCanIn: () => () => true,
  useCanEditIssue: () => () => true,
}));

import { IssueMenuItems, type MenuKit } from './IssueMenuItems';

/** Bộ thành phần menu tối giản (DOM thường) — nội dung mục đổi trạng thái nằm thẳng trong cây để kiểm. */
const Plain = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
const kit: MenuKit = {
  Item: ({ children }) => <div role="menuitem">{children}</div>,
  Separator: () => <hr />,
  Sub: Plain,
  SubTrigger: ({ children }) => <div role="menuitem">{children}</div>,
  SubContent: ({ children }) => <div role="menu">{children}</div>,
  Portal: Plain,
  RadioGroup: Plain,
  RadioItem: ({ children }) => <div role="menuitemradio">{children}</div>,
  ItemIndicator: Plain,
};

const std = defaultWorkflow('STANDARD');
const bug = defaultWorkflow('BUG');
const issueIn = (key: 'STANDARD' | 'BUG', statusName: string): IssueDto => {
  const wf = key === 'BUG' ? bug : std;
  const s = wf.statuses.find((x) => x.name === statusName)!;
  return mk(`${key}-${statusName}`, {
    projectId: 'p1',
    type: { ...TYPES.story, id: key === 'BUG' ? 'ty-bug' : 'ty-task' },
    status: { ...s, workflowId: wf.id },
  });
};

function renderMenu(issue: IssueDto) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <IssueMenuItems kit={kit} issue={issue} surface="board" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  h.get.mockReset();
  h.get.mockImplementation((url: string) => {
    if (url === '/workflows') return Promise.resolve({ data: [std, bug] });
    if (url === '/projects/p1/workflow-overrides')
      return Promise.resolve({
        data: {
          projectId: 'p1',
          issueTypes: [],
          items: [
            {
              issueTypeId: 'ty-task',
              workflowId: std.id,
              isOverride: false,
              organizationWorkflowId: std.id,
            },
            {
              issueTypeId: 'ty-bug',
              workflowId: bug.id,
              isOverride: false,
              organizationWorkflowId: bug.id,
            },
          ],
        },
      });
    if (url.endsWith('/transitions'))
      return Promise.resolve({
        data: {
          workflowId: bug.id,
          currentStatusId: statusIdOf('BUG', 'Pending'),
          transitions: [],
          suggestedResumeStatusId: statusIdOf('BUG', 'In Progress'),
        },
      });
    return Promise.resolve({ data: [] });
  });
});
afterEach(cleanup);

const statusItems = () => {
  const sub = screen.queryAllByRole('menu').find((m) => m.textContent?.length);
  return (sub?.textContent ?? '').trim();
};

describe('Menu chuột phải/nút "…": mục Trạng thái theo quy trình của loại việc', () => {
  it('Task In Review: có "Hoàn thành" / "Làm lại" (Standard), không có bước của Bug', async () => {
    renderMenu(issueIn('STANDARD', 'In Review'));
    await waitFor(() => expect(statusItems()).toContain('Làm lại'));
    expect(statusItems()).toContain('Hoàn thành');
    expect(statusItems()).not.toContain('Mở lại');
    expect(statusItems()).not.toContain('Đạt');
  });
  it('Bug Ready for Retest: có "Đạt" / "Mở lại" (Bug), không có bước của Standard', async () => {
    renderMenu(issueIn('BUG', 'Ready for Retest'));
    await waitFor(() => expect(statusItems()).toContain('Mở lại'));
    expect(statusItems()).toContain('Đạt');
    expect(statusItems()).not.toContain('Làm lại');
    expect(statusItems()).not.toContain('Hoàn thành');
  });
  it('Bug đang Pending: bước gợi ý đứng đầu và ghi "Gợi ý"', async () => {
    renderMenu(issueIn('BUG', 'Pending'));
    await waitFor(() => expect(statusItems()).toContain('Gợi ý'));
    expect(statusItems().startsWith('Tiếp tục: In Progress')).toBe(true);
  });
});

describe('Menu: việc đang ở trạng thái của quy trình khác loại', () => {
  it('Task mà ở trạng thái của Bug Workflow: mục Trạng thái liệt kê trạng thái của Standard (chuyển về quy trình đúng)', async () => {
    renderMenu({ ...issueIn('BUG', 'Reopened'), type: { ...TYPES.story, id: 'ty-task' } });
    await waitFor(() => expect(statusItems()).toContain('Rework'));
    expect(statusItems()).toContain('In Review');
    expect(statusItems()).not.toContain('Reopened');
  });
});
