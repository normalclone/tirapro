import { describe, expect, it, vi } from 'vitest';
import { CommentsService } from './comments.service';

function make(authorId: string) {
  const update = vi.fn().mockResolvedValue({});
  const prisma = {
    comment: {
      findFirst: vi.fn().mockResolvedValue({ id: 'c1', authorId, issueId: 'i1' }),
      update,
    },
  };
  const events = { emit: vi.fn() };
  const service = new CommentsService(prisma as never, events as never);
  return { service, update };
}

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
