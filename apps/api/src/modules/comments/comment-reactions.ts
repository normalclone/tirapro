import { COMMENT_REACTION_EMOJIS } from '@tirapro/shared';
import type { CommentReactionDto } from '@tirapro/types';

/** Số tên hiện trong tooltip mỗi emoji (`count` vẫn đếm đủ). */
const REACTION_USERS_SHOWN = 5;

/** Hàng `CommentReaction` kèm tên người thả — đúng những gì `summarizeReactions` cần. */
export interface ReactionRow {
  commentId: string;
  emoji: string;
  userId: string;
  createdAt: Date;
  user: { id: string; displayName: string } | null;
}

/**
 * Gộp các hàng reaction của MỘT trang bình luận thành `reactions` cho từng bình luận (một truy vấn, gộp ở bộ nhớ):
 * - thứ tự chip theo bảng emoji cố định (không theo thứ tự thả → chip không nhảy chỗ khi có người thả thêm);
 * - `users`: tối đa 5 người thả SỚM NHẤT (createdAt rồi userId, ổn định), `count`: tổng thật;
 * - `mine`: theo `viewerId`, đúng cả khi người xem nằm ngoài 5 tên đầu;
 * - emoji ngoài bảng (dữ liệu lạ) bị bỏ; bình luận không có reaction không có khoá trong kết quả.
 */
export function summarizeReactions(
  rows: readonly ReactionRow[],
  viewerId: string,
): Map<string, CommentReactionDto[]> {
  const byComment = new Map<string, Map<string, ReactionRow[]>>();
  for (const r of rows) {
    if (!(COMMENT_REACTION_EMOJIS as readonly string[]).includes(r.emoji)) continue;
    let emojis = byComment.get(r.commentId);
    if (!emojis) byComment.set(r.commentId, (emojis = new Map<string, ReactionRow[]>()));
    const list = emojis.get(r.emoji);
    if (list) list.push(r);
    else emojis.set(r.emoji, [r]);
  }
  const out = new Map<string, CommentReactionDto[]>();
  for (const [commentId, emojis] of byComment) {
    const chips: CommentReactionDto[] = [];
    for (const emoji of COMMENT_REACTION_EMOJIS) {
      const list = emojis.get(emoji);
      if (!list) continue;
      const sorted = [...list].sort(
        (a, b) =>
          a.createdAt.getTime() - b.createdAt.getTime() ||
          (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0),
      );
      chips.push({
        emoji,
        count: list.length,
        mine: list.some((r) => r.userId === viewerId),
        users: sorted
          .filter((r) => r.user)
          .slice(0, REACTION_USERS_SHOWN)
          .map((r) => ({ id: r.user!.id, displayName: r.user!.displayName })),
      });
    }
    out.set(commentId, chips);
  }
  return out;
}
