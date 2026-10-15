import { describe, expect, it, vi } from 'vitest';
import { ProgramsService } from './programs.service';

describe('ProgramsService.rollup — bỏ issue của dự án xoá mềm', () => {
  it('cả ba groupBy issue có project.deletedAt:null', async () => {
    const groupBy = vi.fn(() => Promise.resolve([]));
    const prisma = {
      program: { findMany: vi.fn(() => Promise.resolve([])) },
      project: { findMany: vi.fn(() => Promise.resolve([])) },
      status: { findMany: vi.fn(() => Promise.resolve([])) },
      issue: { groupBy },
    };
    await new ProgramsService(prisma as never).rollup('w1');
    expect(groupBy).toHaveBeenCalledTimes(3);
    for (const c of groupBy.mock.calls as unknown as [{ where: unknown }][])
      expect(c[0].where).toMatchObject({ workspaceId: 'w1', project: { deletedAt: null } });
  });
});
