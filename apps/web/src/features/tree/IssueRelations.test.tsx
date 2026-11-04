// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IssueDto } from '@tirapro/types';
import { mk } from '@/lib/issueFixture';

const parent = mk('t1', { summary: 'Task cha' });
const kids: IssueDto[] = [
  mk('s1', {
    t: 'sub',
    parentId: 't1',
    summary: 'Kiểm thử A',
    storyPoints: 3,
    status: { id: 'x', name: 'Đang làm', category: 'IN_PROGRESS' } as IssueDto['status'],
    assignee: { id: 'u1', displayName: 'Vũ Thị Hương', avatarUrl: null } as IssueDto['assignee'],
  }),
  mk('s2', {
    t: 'sub',
    parentId: 't1',
    summary: 'Kiểm thử B',
    status: { id: 'y', name: 'Chờ test', category: 'IN_PROGRESS' } as IssueDto['status'],
  }),
];
vi.mock('@/features/issues/api', () => ({ useProjectIssues: () => ({ data: [parent, ...kids] }) }));

import { IssueRelations } from './IssueRelations';

afterEach(cleanup);

describe('IssueRelations — dòng việc con', () => {
  it('hiện tên trạng thái thật, người phụ trách và điểm của từng việc con', () => {
    render(
      <MemoryRouter>
        <IssueRelations issue={parent} />
      </MemoryRouter>,
    );
    const rowA = screen.getByText('Kiểm thử A').closest('button')!;
    expect(within(rowA).getByText('Đang làm')).toBeTruthy();
    expect(within(rowA).getByText('3')).toBeTruthy();
    expect(within(rowA).getByTitle(/Vũ Thị Hương/)).toBeTruthy();
    const rowB = screen.getByText('Kiểm thử B').closest('button')!;
    expect(within(rowB).getByText('Chờ test')).toBeTruthy();
    expect(within(rowB).getByTitle('Chưa giao')).toBeTruthy();
  });
});
