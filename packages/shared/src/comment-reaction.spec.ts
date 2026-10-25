import { describe, expect, it } from 'vitest';
import { COMMENT_REACTION_EMOJIS, commentReactionEmojiSchema } from './index';

describe('bộ emoji thả vào bình luận (RC24)', () => {
  it('đúng 6 emoji cố định, không có 👎, không trùng', () => {
    expect([...COMMENT_REACTION_EMOJIS]).toEqual(['👍', '❤️', '🎉', '😄', '🙏', '👀']);
    expect(new Set(COMMENT_REACTION_EMOJIS).size).toBe(6);
  });
  it('schema nhận đúng 6 emoji', () => {
    for (const e of COMMENT_REACTION_EMOJIS)
      expect(commentReactionEmojiSchema.safeParse(e).success).toBe(true);
  });
  it('từ chối emoji ngoài danh sách, chuỗi rỗng, chữ, biến thể thiếu FE0F và chuỗi dài (không nhận emoji tự do)', () => {
    for (const bad of ['👎', '', 'a', '❤', '👍👍', '<script>', '👍'.repeat(40), ' 👍'])
      expect(commentReactionEmojiSchema.safeParse(bad).success).toBe(false);
  });
});
