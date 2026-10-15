import { describe, expect, it, vi } from 'vitest';
import { ResourcesService } from './resources.service';

describe('ResourcesService.workload — bỏ issue/worklog của dự án xoá mềm', () => {
  it('issue.findMany và workLog.findMany có project.deletedAt:null (cả khi lọc theo projectId)', async () => {
    const empty = () => vi.fn(() => Promise.resolve([]));
    const prisma = {
      workspaceMembership: {
        findMany: vi.fn(() =>
          Promise.resolve([{ user: { id: 'u1', displayName: 'An', email: 'a@x.vn' } }]),
        ),
      },
      allocation: { findMany: empty() },
      timeOff: { findMany: empty() },
      issue: { findMany: empty() },
      workLog: { findMany: empty() },
    };
    const service = new ResourcesService(prisma as never);
    for (const projectId of [undefined, 'p1']) {
      prisma.issue.findMany.mockClear();
      prisma.workLog.findMany.mockClear();
      await service.workload('w1', { projectId });
      const issueWhere = (prisma.issue.findMany.mock.calls[0] as unknown as [{ where: unknown }])[0]
        .where;
      const logWhere = (
        prisma.workLog.findMany.mock.calls[0] as unknown as [{ where: { issue: unknown } }]
      )[0].where.issue;
      expect(issueWhere).toMatchObject({
        workspaceId: 'w1',
        deletedAt: null,
        project: { deletedAt: null },
      });
      expect(logWhere).toMatchObject({
        workspaceId: 'w1',
        deletedAt: null,
        project: { deletedAt: null },
      });
      if (projectId) {
        expect(issueWhere).toMatchObject({ projectId });
        expect(logWhere).toMatchObject({ projectId });
      }
    }
  });
});
