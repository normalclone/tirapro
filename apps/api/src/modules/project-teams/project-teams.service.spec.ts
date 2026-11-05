import { describe, expect, it, vi } from 'vitest';
import { ProjectTeamsService, type LinkSyncEffect } from './project-teams.service';

/** Sau commit, quyền hiệu lực của MỌI người bị ảnh hưởng phải bị xoá cache (khoá `rbac:org:<tổ chức>:<người>:*`) và báo realtime. */
describe('ProjectTeamsService.publish', () => {
  const effect = (over: Partial<LinkSyncEffect>): LinkSyncEffect => ({
    projectId: 'p1',
    projectName: 'P',
    teamId: 't1',
    teamName: 'T',
    added: [],
    removed: [],
    changed: [],
    kept: [],
    ...over,
  });

  it('xoá cache RBAC của người vào / ra / đổi vai trò (một lần mỗi người), phát access.changed và sự kiện dự án', async () => {
    const rbac = { invalidate: vi.fn(() => Promise.resolve()) };
    const events = { emit: vi.fn() };
    const svc = new ProjectTeamsService({} as never, rbac as never, events as never, {} as never);
    await svc.publish(
      'o1',
      [effect({ added: ['a'], removed: ['b'] }), effect({ projectId: 'p2', changed: ['a', 'c'] })],
      'actor',
    );
    expect(rbac.invalidate.mock.calls.map((c) => (c as unknown as string[])[0]).sort()).toEqual([
      'a',
      'b',
      'c',
    ]);
    expect(events.emit).toHaveBeenCalledWith('access.changed', {
      organizationId: 'o1',
      userIds: ['a', 'b', 'c'],
    });
    expect(events.emit).toHaveBeenCalledWith(
      'project.access_changed',
      expect.objectContaining({ projectId: 'p1', userIds: ['a'] }),
    );
    expect(events.emit).toHaveBeenCalledWith('project.member_removed', {
      organizationId: 'o1',
      projectId: 'p1',
      userId: 'b',
    });
  });

  it('không ai bị ảnh hưởng → không đụng cache, không phát', async () => {
    const rbac = { invalidate: vi.fn() };
    const events = { emit: vi.fn() };
    const svc = new ProjectTeamsService({} as never, rbac as never, events as never, {} as never);
    await svc.publish('o1', [effect({ kept: ['x'] })]);
    expect(rbac.invalidate).not.toHaveBeenCalled();
    expect(events.emit).not.toHaveBeenCalled();
  });
});
