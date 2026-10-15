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
    await new ProgramsService(
      prisma as never,
      { forProjects: vi.fn(() => Promise.resolve(new Map())) } as never,
    ).rollup('w1');
    expect(groupBy).toHaveBeenCalledTimes(3);
    for (const c of groupBy.mock.calls as unknown as [{ where: unknown }][])
      expect(c[0].where).toMatchObject({ workspaceId: 'w1', project: { deletedAt: null } });
  });
});

describe('ProgramsService.rollup — sức khoẻ dự án', () => {
  const HEALTH = {
    level: 'RED',
    auto: { level: 'RED', reasons: ['3/9 việc chưa xong đang quá hạn'] },
    override: null,
  };

  function make() {
    const prisma = {
      program: { findMany: vi.fn(() => Promise.resolve([])) },
      project: {
        findMany: vi.fn(() =>
          Promise.resolve([
            { id: 'p1', key: 'AAA', name: 'Alpha', isArchived: false, programId: null, lead: null },
            { id: 'p2', key: 'BBB', name: 'Beta', isArchived: true, programId: null, lead: null },
          ]),
        ),
      },
      status: { findMany: vi.fn(() => Promise.resolve([])) },
      issue: { groupBy: vi.fn(() => Promise.resolve([])) },
    };
    const health = {
      forProjects: vi.fn((_w: string, ids: string[]) =>
        Promise.resolve(new Map(ids.map((id) => [id, HEALTH]))),
      ),
    };
    return { service: new ProgramsService(prisma as never, health as never), health };
  }

  it('mỗi dự án đang hoạt động có `health`; dự án lưu trữ có health = null và không bị tính', async () => {
    const { service, health } = make();
    const r = await service.rollup('w1');
    const [p1, p2] = r.groups[0]!.projects;
    expect(p1).toMatchObject({ key: 'AAA', health: HEALTH });
    expect(p2).toMatchObject({ key: 'BBB', health: null });
    expect(health.forProjects).toHaveBeenCalledTimes(1);
    expect(health.forProjects).toHaveBeenCalledWith('w1', ['p1']);
  });
});
