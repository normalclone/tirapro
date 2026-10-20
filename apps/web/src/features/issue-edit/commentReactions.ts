import { COMMENT_REACTION_EMOJIS, type CommentReactionEmoji } from '@tirapro/shared';
import type { CommentReactionDto } from '@tirapro/types';

/** Tên tiếng Việt của từng emoji — tên truy cập của nút trong ô chọn (chip dùng "emoji số — ai"). */
export const REACTION_LABELS: Record<CommentReactionEmoji, string> = {
  '👍': 'Đồng ý',
  '❤️': 'Yêu thích',
  '🎉': 'Chúc mừng',
  '😄': 'Vui',
  '🙏': 'Cảm ơn',
  '👀': 'Đang xem',
};

/** Số tên tối đa API trả cho mỗi emoji (khớp `REACTION_USERS_SHOWN` của máy chủ). */
const USERS_SHOWN = 5;

const orderOf = (emoji: string): number => {
  const i = (COMMENT_REACTION_EMOJIS as readonly string[]).indexOf(emoji);
  return i < 0 ? COMMENT_REACTION_EMOJIS.length : i;
};

/** "bạn", "bạn và 2 người khác", "An", "An và 2 người khác" — không đoán tên khi chỉ biết số. */
function whoText(r: CommentReactionDto): string {
  const others = r.count - (r.mine ? 1 : 0);
  if (r.mine) return others <= 0 ? 'bạn' : `bạn và ${others} người khác`;
  const first = r.users[0]?.displayName;
  if (r.count === 1) return first ?? '1 người';
  return first ? `${first} và ${r.count - 1} người khác` : `${r.count} người`;
}

/**
 * Tên truy cập của chip: bắt đầu bằng đúng chữ nhìn thấy ("👍 3") rồi tóm tắt ai thả — "👍 3 — bạn và 2 người khác".
 * Danh sách tên đầy đủ KHÔNG nằm trong tên mà ở `aria-describedby` + tooltip (`reactionUsersText`).
 */
export function reactionChipName(r: CommentReactionDto): string {
  return `${r.emoji} ${r.count} — ${whoText(r)}`;
}

/** "Bạn, An, Bình và 3 người khác" — mình (nếu có) đứng đầu; API chỉ gửi tối đa 5 tên nên phần còn lại chỉ có số. */
export function reactionUsersText(r: CommentReactionDto, meId: string | undefined): string {
  const names: string[] = [];
  if (r.mine) names.push('Bạn');
  for (const u of r.users) if (!(r.mine && u.id === meId)) names.push(u.displayName);
  const shown = names.slice(0, r.mine ? USERS_SHOWN + 1 : USERS_SHOWN);
  const rest = r.count - shown.length;
  if (shown.length === 0) return `${r.count} người`;
  if (rest > 0) return `${shown.join(', ')} và ${rest} người khác`;
  if (shown.length === 1) return shown[0]!;
  return `${shown.slice(0, -1).join(', ')} và ${shown[shown.length - 1]}`;
}

/**
 * Cập nhật LẠC QUAN một emoji của MÌNH (không đổi dữ liệu gốc): bật = count+1, mine, nối tên mình (tối đa 5 tên);
 * tắt = count-1, bỏ tên mình, về 0 thì bỏ chip. Idempotent: bật khi đã mine / tắt khi chưa mine giữ nguyên.
 * Chip luôn theo thứ tự bảng cố định — khớp thứ tự máy chủ trả.
 */
export function applyReaction(
  list: readonly CommentReactionDto[],
  emoji: string,
  on: boolean,
  me: { id: string; displayName: string },
): CommentReactionDto[] {
  const cur = list.find((x) => x.emoji === emoji);
  if (on) {
    if (cur?.mine) return [...list];
    const next: CommentReactionDto = cur
      ? {
          ...cur,
          count: cur.count + 1,
          mine: true,
          users:
            cur.users.length < USERS_SHOWN
              ? [...cur.users, { id: me.id, displayName: me.displayName }]
              : cur.users,
        }
      : { emoji, count: 1, mine: true, users: [{ id: me.id, displayName: me.displayName }] };
    return putReactionEntry(list, emoji, next);
  }
  if (!cur?.mine) return [...list];
  const count = cur.count - 1;
  return putReactionEntry(
    list,
    emoji,
    count <= 0
      ? undefined
      : { ...cur, count, mine: false, users: cur.users.filter((u) => u.id !== me.id) },
  );
}

/** Đặt MỘT emoji về `entry` (undefined = bỏ chip), giữ chip khác nguyên và thứ tự bảng cố định. */
export function putReactionEntry(
  list: readonly CommentReactionDto[],
  emoji: string,
  entry: CommentReactionDto | undefined,
): CommentReactionDto[] {
  const rest = list.filter((x) => x.emoji !== emoji);
  if (!entry) return rest;
  return [...rest, entry].sort((a, b) => orderOf(a.emoji) - orderOf(b.emoji));
}

/** Phím mũi tên trong lưới emoji (quay vòng); phím khác → null (để Enter/Space bấm nút như thường). */
export function nextPickerIndex(index: number, key: string, count: number): number | null {
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
      return (index + 1) % count;
    case 'ArrowLeft':
    case 'ArrowUp':
      return (index - 1 + count) % count;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}
