import { describe, expect, it, vi } from 'vitest';
import { WatchersService } from './watchers.service';

const issue = { id: 'i1', workspaceId: 'w1', key: 'TP-1', summary: 'Sửa lỗi' };

function setup(watcherIds: string[]) {
  const prisma = {
    issueWatcher: {
      findMany: vi.fn(() => Promise.resolve(watcherIds.map((userId) => ({ userId })))),
    },
    issue: { findFirst: vi.fn(() => Promise.resolve({ ...issue })) },
  };
  const notifications = { publish: vi.fn((..._a: unknown[]) => Promise.resolve()) };
  const service = new WatchersService(prisma as never, notifications as never);
  return { service, prisma, notifications };
}

describe('WatchersService — thông báo theo dõi đi qua NotificationsService.publish', () => {
  it('onIssueUpdated: bỏ actor, mỗi watcher còn lại một lần publish (force)', async () => {
    const { service, notifications } = setup(['a1', 'w2']);
    await service.onIssueUpdated({ issue, actorId: 'a1' });
    expect(notifications.publish).toHaveBeenCalledTimes(1);
    expect(notifications.publish).toHaveBeenCalledWith(
      {
        recipientId: 'w2',
        workspaceId: 'w1',
        type: 'WATCHING_UPDATE',
        issueId: 'i1',
        actorId: 'a1',
        payload: { key: 'TP-1', summary: 'Sửa lỗi' },
      },
      { force: true },
    );
  });

  it('không có watcher (hoặc chỉ có actor) → không publish', async () => {
    const a = setup([]);
    await a.service.onIssueUpdated({ issue, actorId: 'a1' });
    const b = setup(['a1']);
    await b.service.onIssueTransitioned({ issue, actorId: 'a1' });
    expect(a.notifications.publish).not.toHaveBeenCalled();
    expect(b.notifications.publish).not.toHaveBeenCalled();
  });

  it('onCommentAdded: tra issue rồi báo watcher ≠ tác giả bình luận', async () => {
    const { service, notifications } = setup(['a1', 'w2', 'w3']);
    await service.onCommentAdded({
      comment: { id: 'c1', authorId: 'a1' },
      issueId: 'i1',
      actorId: 'a1',
    });
    expect(
      notifications.publish.mock.calls.map((c) => (c[0] as { recipientId: string }).recipientId),
    ).toEqual(['w2', 'w3']);
  });

  it('một lần publish lỗi không chặn người sau và không văng ra ngoài', async () => {
    const { service, notifications } = setup(['w2', 'w3']);
    notifications.publish.mockRejectedValueOnce(new Error('DB lỗi'));
    await expect(service.onIssueUpdated({ issue, actorId: 'a1' })).resolves.toBeUndefined();
    expect(notifications.publish).toHaveBeenCalledTimes(2);
  });
});
