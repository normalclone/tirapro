// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { Command } from 'cmdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IssueDto } from '@tirapro/types';
import type * as ApiModule from '@/lib/api';
import type * as IssuesApi from '@/features/issues/api';
import { defaultWorkflow, statusIdOf } from '@/features/issues/workflowFixtures';
import { mk } from '@/lib/issueFixture';

const h = vi.hoisted(() => ({ issue: null as unknown as IssueDto, get: vi.fn() }));
vi.mock('@/lib/api', async (orig) => {
  const real = await orig<typeof ApiModule>();
  return { ...real, api: { get: h.get, post: vi.fn(), patch: vi.fn() } };
});
vi.mock('@/features/projects/permissions', () => ({
  useCanIn: () => () => true,
  useCanEditIssue: () => () => true,
}));
vi.mock('@/features/issues/api', async (orig) => {
  const real = await orig<typeof IssuesApi>();
  return { ...real, useIssue: () => ({ data: h.issue }) };
});
vi.mock('@/features/issue-widgets/api', () => ({
  useWatchState: () => ({ data: undefined }),
  useToggleWatch: () => ({ mutate: vi.fn() }),
}));

import { IssueContextGroup } from './IssueContextGroup';

const std = defaultWorkflow('STANDARD');
const bug = defaultWorkflow('BUG');
const issueIn = (key: 'STANDARD' | 'BUG', statusName: string): IssueDto => {
  const wf = key === 'BUG' ? bug : std;
  const s = wf.statuses.find((x) => x.name === statusName)!;
  return mk(`${key}-${statusName}`, { projectId: 'p1', status: { ...s, workflowId: wf.id } });
};

function renderGroup(issue: IssueDto) {
  h.issue = issue;
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <Command>
        <Command.List>
          <IssueContextGroup issueKey={issue.key} runAction={(fn) => fn()} />
        </Command.List>
      </Command>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  h.get.mockReset();
  h.get.mockImplementation((url: string) => {
    if (url === '/workflows') return Promise.resolve({ data: [std, bug] });
    if (url.endsWith('/transitions'))
      return Promise.resolve({
        data: {
          workflowId: bug.id,
          currentStatusId: statusIdOf('BUG', 'Pending'),
          transitions: [],
          suggestedResumeStatusId: statusIdOf('BUG', 'Reopened'),
        },
      });
    return Promise.resolve({ data: [] });
  });
});
afterEach(cleanup);

const labels = () => screen.queryAllByRole('option').map((o) => o.textContent ?? '');

describe('Cmd+K "Công việc này": lệnh đổi trạng thái theo quy trình của loại việc', () => {
  it('Task In Review → Done/Rework; không có bước của Bug', async () => {
    renderGroup(issueIn('STANDARD', 'In Review'));
    await waitFor(() => expect(labels().some((l) => l.includes('Rework'))).toBe(true));
    const text = labels().join('|');
    expect(text).toContain('Done');
    expect(text).not.toContain('Reopened');
    expect(text).not.toContain('Ready for Retest');
  });
  it('Bug Ready for Retest → Reopened/Done; không có Rework', async () => {
    renderGroup(issueIn('BUG', 'Ready for Retest'));
    await waitFor(() => expect(labels().some((l) => l.includes('Reopened'))).toBe(true));
    const text = labels().join('|');
    expect(text).toContain('Done');
    expect(text).not.toContain('Rework');
  });
  it('Bug đang Pending: trạng thái trước khi tạm dừng đứng đầu, kèm chú thích gợi ý', async () => {
    renderGroup(issueIn('BUG', 'Pending'));
    await waitFor(() => expect(labels().some((l) => l.includes('gợi ý'))).toBe(true));
    const first = labels()[0]!;
    expect(first).toContain('Reopened');
    expect(first).toContain('gợi ý: trước khi tạm dừng');
  });
});
