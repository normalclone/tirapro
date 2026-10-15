import { describe, expect, it, vi } from 'vitest';
import { CommentsService } from './comments.service';

function make(authorId: string, archivedAt: Date | null = null) {
  const row = {
    id: 'c1',
    issueId: 'i1',
    authorId,
    author: null,
    body: 'nội dung mới',
    bodyFormat: 'MARKDOWN',
    parentId: null,
    isEdited: true,
    version: 2,
    createdAt: new Date('2026-10-01T00:00:00Z'),
    updatedAt: new Date('2026-10-02T00:00:00Z'),
  };
  const update = vi.fn().mockResolvedValue(row);
  const create = vi.fn().mockResolvedValue({});
  const prisma = {
    comment: {
      findFirst: vi.fn().mockResolvedValue({
        id: 'c1',
        authorId,
        issueId: 'i1',
        version: 1,
        issue: { projectId: 'p1' },
      }),
      update,
    },
    issue: {
      findFirst: vi.fn().mockResolvedValue({ id: 'i1', projectId: 'p1' }),
      findUnique: vi.fn().mockResolvedValue({ project: { archivedAt } }),
    },
    $transaction: vi.fn((fn: (t: unknown) => unknown) =>
      fn({ comment: { create }, mention: { createMany: vi.fn() } }),
    ),
  };
  const events = { emit: vi.fn() };
  const service = new CommentsService(prisma as never, events as never);
  return { service, update, create, events };
}

describe('CommentsService — dự án đã lưu trữ là chỉ đọc', () => {
  const archived = new Date('2026-10-01T00:00:00Z');

  it('create(): dự án đã lưu trữ => BusinessRuleException, không ghi, không emit', async () => {
    const { service, create, events } = make('u1', archived);
    await expect(
      service.create('w1', 'u1', 'i1', { body: 'x', bodyFormat: 'MARKDOWN' }),
    ).rejects.toMatchObject({
      status: 422,
      message: 'Dự án đã lưu trữ — hãy khôi phục dự án trước khi thay đổi',
    });
    expect(create).not.toHaveBeenCalled();
    expect(events.emit).not.toHaveBeenCalled();
  });

  it('update()/softDelete(): cũng bị chặn', async () => {
    const { service, update } = make('u1', archived);
    await expect(service.update('w1', 'u1', 'c1', 'mới', 1)).rejects.toMatchObject({ status: 422 });
    await expect(service.softDelete('w1', 'u1', 'c1')).rejects.toMatchObject({ status: 422 });
    expect(update).not.toHaveBeenCalled();
  });
});

describe('CommentsService.softDelete', () => {
  it('tác giả xoá được bình luận của mình', async () => {
    const { service, update } = make('u1');
    await expect(service.softDelete('w1', 'u1', 'c1')).resolves.toEqual({ success: true });
    expect(update).toHaveBeenCalled();
  });

  it('người khác không có comment:delete bị từ chối', async () => {
    const { service, update } = make('u1');
    await expect(service.softDelete('w1', 'u2', 'c1')).rejects.toThrow();
    expect(update).not.toHaveBeenCalled();
  });

  it('người có comment:delete xoá được bình luận của người khác', async () => {
    const { service, update } = make('u1');
    await expect(service.softDelete('w1', 'u2', 'c1', true)).resolves.toEqual({ success: true });
    expect(update).toHaveBeenCalled();
  });
});

describe('CommentsService — domain event kèm projectId', () => {
  it('update() phát comment.updated kèm projectId', async () => {
    const { service, events } = make('u1');
    await service.update('w1', 'u1', 'c1', 'nội dung mới', 1);
    expect(events.emit).toHaveBeenCalledWith(
      'comment.updated',
      expect.objectContaining({ issueId: 'i1', projectId: 'p1', actorId: 'u1' }),
    );
  });

  it('softDelete() phát comment.deleted kèm projectId', async () => {
    const { service, events } = make('u1');
    await service.softDelete('w1', 'u1', 'c1');
    expect(events.emit).toHaveBeenCalledWith('comment.deleted', {
      commentId: 'c1',
      issueId: 'i1',
      projectId: 'p1',
      actorId: 'u1',
    });
  });

  it('FW4: update() ném lỗi khi ghi => không phát comment.updated', async () => {
    const { service, update, events } = make('u1');
    update.mockRejectedValueOnce(new Error('DB lỗi giả lập'));
    await expect(service.update('w1', 'u1', 'c1', 'nội dung mới', 1)).rejects.toThrow(
      'DB lỗi giả lập',
    );
    expect(events.emit).not.toHaveBeenCalled();
  });

  it('FW4: update() bị từ chối (không phải tác giả / lệch version) => không ghi, không phát event', async () => {
    const other = make('u2');
    await expect(other.service.update('w1', 'u1', 'c1', 'x', 1)).rejects.toMatchObject({
      status: 403,
    });
    const stale = make('u1');
    await expect(stale.service.update('w1', 'u1', 'c1', 'x', 99)).rejects.toMatchObject({
      status: 409,
    });
    expect(other.update).not.toHaveBeenCalled();
    expect(stale.update).not.toHaveBeenCalled();
    expect(other.events.emit).not.toHaveBeenCalled();
    expect(stale.events.emit).not.toHaveBeenCalled();
  });
});
