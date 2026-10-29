import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { CommentsController } from './comments.controller';

describe('CommentsController — route reaction', () => {
  it('PUT/DELETE chuyển đúng người dùng + cờ bật/tắt vào service', async () => {
    const setReaction = vi.fn().mockResolvedValue([]);
    const c = new CommentsController({ setReaction } as never);
    const user = { id: 'u1' } as never;
    await c.react('w1', user, 'c1', '👍');
    await c.unreact('w1', user, 'c1', '🎉');
    expect(setReaction).toHaveBeenNthCalledWith(1, 'w1', 'u1', 'c1', '👍', true);
    expect(setReaction).toHaveBeenNthCalledWith(2, 'w1', 'u1', 'c1', '🎉', false);
  });

  it('list truyền người xem để tính `mine`', async () => {
    const list = vi.fn().mockResolvedValue([]);
    const c = new CommentsController({ list } as never);
    await c.list('w1', { id: 'u9' } as never, 'i1');
    expect(list).toHaveBeenCalledWith('w1', 'i1', 'u9');
  });

  it('emoji ở đường dẫn được zod kiểm theo bảng 6 emoji cố định (400 nếu ngoài bảng) ở cả PUT và DELETE', () => {
    const src = readFileSync(join(__dirname, 'comments.controller.ts'), 'utf8');
    const uses =
      src.match(/@Param\('emoji', new ZodValidationPipe\(commentReactionEmojiSchema\)\)/g) ?? [];
    expect(uses).toHaveLength(2);
    expect(src).toMatch(/@Put\('comments\/:id\/reactions\/:emoji'\)/);
    expect(src).toMatch(/@Delete\('comments\/:id\/reactions\/:emoji'\)/);
  });
});
