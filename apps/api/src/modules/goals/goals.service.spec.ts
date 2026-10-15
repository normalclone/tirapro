import { describe, expect, it, vi } from 'vitest';
import { GoalsService } from './goals.service';

type IssueWhere = { where: Record<string, unknown> };
const LIVE = { deletedAt: null };

describe('GoalsService — không đếm/gắn issue của dự án xoá mềm', () => {
  it('validateIssues: where có project.deletedAt:null (không gắn được issue của dự án đã xoá)', async () => {
    const findMany = vi.fn(() => Promise.resolve([{ id: 'i1' }]));
    const service = new GoalsService({ issue: { findMany } } as never);
    const validate = (
      service as unknown as {
        validateIssues(w: string, ids: string[], p: string | null): Promise<string[]>;
      }
    ).validateIssues.bind(service);
    await expect(validate('w1', ['i1'], null)).resolves.toEqual(['i1']);
    const { where } = (findMany.mock.calls[0] as unknown as [IssueWhere])[0];
    expect(where).toMatchObject({ workspaceId: 'w1', deletedAt: null, project: LIVE });
    // Có projectId của mục tiêu: điều kiện dự án sống vẫn còn, projectId được thêm vào.
    await validate('w1', ['i1'], 'p1');
    const w2 = (findMany.mock.calls[1] as unknown as [IssueWhere])[0].where;
    expect(w2).toMatchObject({ projectId: 'p1', project: LIVE });
  });

  it('list: issue gắn kèm lọc cả issue xoá mềm lẫn dự án xoá mềm', async () => {
    const findMany = vi.fn(() => Promise.resolve([]));
    const service = new GoalsService({ objective: { findMany } } as never);
    await service.list('w1', {});
    const { select } = (
      findMany.mock.calls[0] as unknown as [{ select: { issues: { where: unknown } } }]
    )[0];
    expect(select.issues.where).toEqual({ issue: { deletedAt: null, project: LIVE } });
  });
});
