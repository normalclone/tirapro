import { describe, expect, it } from 'vitest';
import { summarizeReactions, type ReactionRow } from './comment-reactions';

const row = (
  commentId: string,
  emoji: string,
  userId: string,
  at: number,
  displayName = `Tên ${userId}`,
): ReactionRow => ({
  commentId,
  emoji,
  userId,
  createdAt: new Date(2026, 9, 19, 10, 0, at),
  user: { id: userId, displayName },
});

describe('summarizeReactions (thuần)', () => {
  it('nhóm theo bình luận rồi theo emoji, đếm đủ, `mine` theo người xem', () => {
    const out = summarizeReactions(
      [row('c1', '👍', 'u1', 1), row('c1', '👍', 'u2', 2), row('c1', '🎉', 'u2', 3)],
      'u2',
    );
    expect(out.get('c1')).toEqual([
      {
        emoji: '👍',
        count: 2,
        mine: true,
        users: [
          { id: 'u1', displayName: 'Tên u1' },
          { id: 'u2', displayName: 'Tên u2' },
        ],
      },
      { emoji: '🎉', count: 1, mine: true, users: [{ id: 'u2', displayName: 'Tên u2' }] },
    ]);
  });

  it('thứ tự chip theo bảng emoji cố định, KHÔNG theo thứ tự thả (chip không nhảy chỗ)', () => {
    const out = summarizeReactions([row('c1', '👀', 'u1', 1), row('c1', '👍', 'u1', 2)], 'x');
    expect(out.get('c1')!.map((r) => r.emoji)).toEqual(['👍', '👀']);
  });

  it('`users` tối đa 5 (người thả sớm nhất) nhưng `count` đếm đủ; `mine` đúng cả khi mình ngoài 5 người đầu', () => {
    const rows = Array.from({ length: 8 }, (_, i) => row('c1', '👍', `u${i}`, i));
    const out = summarizeReactions(rows, 'u7').get('c1')![0]!;
    expect(out.count).toBe(8);
    expect(out.users.map((u) => u.id)).toEqual(['u0', 'u1', 'u2', 'u3', 'u4']);
    expect(out.mine).toBe(true);
  });

  it('không xáo trộn theo thứ tự hàng vào: sắp theo createdAt rồi userId', () => {
    const rows = [row('c1', '👍', 'b', 5), row('c1', '👍', 'a', 5), row('c1', '👍', 'c', 1)];
    expect(
      summarizeReactions(rows, 'x')
        .get('c1')![0]!
        .users.map((u) => u.id),
    ).toEqual(['c', 'a', 'b']);
  });

  it('bỏ hàng có emoji ngoài bảng (dữ liệu lạ không vào giao diện); bình luận không có reaction không có khoá', () => {
    const out = summarizeReactions([row('c1', '👎', 'u1', 1), row('c2', '👍', 'u1', 1)], 'u1');
    expect(out.has('c1')).toBe(false);
    expect(out.get('c2')).toHaveLength(1);
  });

  it('người dùng đã bị xoá (user null) không làm hỏng: vẫn đếm, không hiện tên', () => {
    const r = { ...row('c1', '👍', 'u1', 1), user: null };
    const out = summarizeReactions([r], 'x').get('c1')![0]!;
    expect(out.count).toBe(1);
    expect(out.users).toEqual([]);
  });
});
