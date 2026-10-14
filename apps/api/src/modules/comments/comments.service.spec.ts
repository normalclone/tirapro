import { describe, expect, it, vi } from 'vitest';
import { CommentsService } from './comments.service';

function make(authorId: string, archivedAt: Date | null = null) {
  const update = vi.fn().mockResolvedValue({});
  const create = vi.fn().mockResolvedValue({});
  const prisma = {
    comment: {
      findFirst: vi.fn().mockResolvedValue({ id: 'c1', authorId, issueId: 'i1', version: 1 }),
      update,
    },
    issue: {
      findFirst: vi.fn().mockResolvedValue({ id: 'i1', projectId: 'p1' }),
      findUnique: vi.fn().mockResolvedValue({ project: { archivedAt } }),
    },
    $transaction: vi.fn((fn: (t: unknown) => unknown) => fn({ comment: { create }, mention: { createMany: vi.fn() } })),
  };
  const events = { emit: vi.fn() };
  const service = new CommentsService(prisma as never, events as never);
  return { service, update, create, events };
}

describe('CommentsService — dự án đã lưu trữ là chỉ đọc', () => {
  const archived = new Date('2026-10-01T00:00:00Z');

  it('create(): dự án đã lưu trữ => BusinessRuleException, không ghi, không emit', async () => {
    const { service, create, events } = make('u1', archived);
    await expect(service.create('w1', 'u1', 'i1', { body: 'x', bodyFormat: 'MARKDOWN' })).rejects.toMatchObject({
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
