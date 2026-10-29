import { describe, expect, it } from 'vitest';
import { COMMENT_REACTION_EMOJIS } from '@tirapro/shared';
import type { CommentReactionDto } from '@tirapro/types';
import {
  REACTION_LABELS,
  applyReaction,
  nextPickerIndex,
  putReactionEntry,
  reactionChipName,
  reactionUsersText,
} from './commentReactions';

const me = { id: 'me', displayName: 'Tôi' };
const r = (
  emoji: string,
  count: number,
  mine: boolean,
  names: string[] = [],
): CommentReactionDto => ({
  emoji,
  count,
  mine,
  users: names.map((n) => ({ id: n === 'Tôi' ? 'me' : `id-${n}`, displayName: n })),
});

describe('REACTION_LABELS', () => {
  it('mỗi emoji trong bảng cố định có nhãn tiếng Việt (tên truy cập của nút trong ô chọn)', () => {
    for (const e of COMMENT_REACTION_EMOJIS) expect(REACTION_LABELS[e]?.length).toBeGreaterThan(1);
    expect(Object.keys(REACTION_LABELS)).toHaveLength(COMMENT_REACTION_EMOJIS.length);
  });
});

describe('reactionChipName — tên truy cập của chip: bắt đầu bằng chữ nhìn thấy "emoji số"', () => {
  it('mình + người khác: "👍 3 — Đồng ý: bạn và 2 người khác"', () => {
    expect(reactionChipName(r('👍', 3, true, ['An', 'Tôi', 'Bình']))).toBe(
      '👍 3 — Đồng ý: bạn và 2 người khác',
    );
  });
  it('chỉ mình: "👍 1 — bạn"', () => {
    expect(reactionChipName(r('👍', 1, true, ['Tôi']))).toBe('👍 1 — Đồng ý: bạn');
  });
  it('mình + đúng một người khác: không đoán tên, "bạn và 1 người khác"', () => {
    expect(reactionChipName(r('🎉', 2, true, ['An', 'Tôi']))).toBe(
      '🎉 2 — Chúc mừng: bạn và 1 người khác',
    );
  });
  it('một người khác: nêu tên', () => {
    expect(reactionChipName(r('❤️', 1, false, ['An']))).toBe('❤️ 1 — Yêu thích: An');
  });
  it('nhiều người khác (không có mình): tên đầu và số còn lại', () => {
    expect(reactionChipName(r('😄', 3, false, ['An', 'Bình', 'Cường']))).toBe(
      '😄 3 — Vui: An và 2 người khác',
    );
  });
  it('không có tên (người đã bị xoá): vẫn đúng số', () => {
    expect(reactionChipName(r('👀', 1, false, []))).toBe('👀 1 — Đang xem: 1 người');
    expect(reactionChipName(r('👀', 4, false, []))).toBe('👀 4 — Đang xem: 4 người');
  });
});

describe('reactionUsersText — danh sách tên cho tooltip / aria-describedby', () => {
  it('mình hiện là "Bạn" đứng đầu, người khác theo thứ tự; phần còn lại là "và N người khác"', () => {
    expect(reactionUsersText(r('👍', 8, true, ['An', 'Tôi', 'Bình', 'Cường', 'Dũng']), 'me')).toBe(
      'Bạn, An, Bình, Cường, Dũng và 3 người khác',
    );
  });
  it('đủ tên thì không có đuôi', () => {
    expect(reactionUsersText(r('👍', 2, false, ['An', 'Bình']), 'me')).toBe('An và Bình');
    expect(reactionUsersText(r('👍', 1, false, ['An']), 'me')).toBe('An');
  });
  it('mình ngoài 5 tên đầu vẫn hiện "Bạn" (mine) và không đếm trùng', () => {
    expect(reactionUsersText(r('👍', 7, true, ['A', 'B', 'C', 'D', 'E']), 'me')).toBe(
      'Bạn, A, B, C, D, E và 1 người khác',
    );
  });
});

describe('applyReaction — cập nhật lạc quan (thuần, không đổi dữ liệu gốc)', () => {
  it('bật emoji mới: thêm chip theo thứ tự bảng cố định, count 1, mine, có tên mình', () => {
    const before = [r('🎉', 1, false, ['An'])];
    const after = applyReaction(before, '👍', true, me);
    expect(after.map((x) => x.emoji)).toEqual(['👍', '🎉']);
    expect(after[0]).toEqual(r('👍', 1, true, ['Tôi']));
    expect(before).toHaveLength(1);
  });
  it('bật emoji đã có: count+1, mine, tên mình nối cuối (tối đa 5 tên)', () => {
    const after = applyReaction([r('👍', 2, false, ['An', 'Bình'])], '👍', true, me);
    expect(after[0]).toEqual(r('👍', 3, true, ['An', 'Bình', 'Tôi']));
    const full = applyReaction([r('👍', 9, false, ['a', 'b', 'c', 'd', 'e'])], '👍', true, me);
    expect(full[0]!.count).toBe(10);
    expect(full[0]!.users).toHaveLength(5);
    expect(full[0]!.mine).toBe(true);
  });
  it('bật khi đã mine: giữ nguyên (idempotent, không đếm đôi)', () => {
    const before = [r('👍', 2, true, ['An', 'Tôi'])];
    expect(applyReaction(before, '👍', true, me)).toEqual(before);
  });
  it('tắt: count-1, mine=false, bỏ tên mình; về 0 thì bỏ chip', () => {
    expect(applyReaction([r('👍', 2, true, ['An', 'Tôi'])], '👍', false, me)).toEqual([
      r('👍', 1, false, ['An']),
    ]);
    expect(applyReaction([r('👍', 1, true, ['Tôi'])], '👍', false, me)).toEqual([]);
  });
  it('tắt khi chưa mine: giữ nguyên', () => {
    const before = [r('👍', 2, false, ['An', 'Bình'])];
    expect(applyReaction(before, '👍', false, me)).toEqual(before);
  });
  it('tắt khi mình ngoài 5 tên đầu: count-1, không xoá nhầm tên người khác', () => {
    const out = applyReaction([r('👍', 7, true, ['A', 'B', 'C', 'D', 'E'])], '👍', false, me);
    expect(out[0]).toEqual(r('👍', 6, false, ['A', 'B', 'C', 'D', 'E']));
  });
});

describe('putReactionEntry — khôi phục MỘT emoji về bản máy chủ xác nhận', () => {
  it('thay chip cũ bằng bản xác nhận, các emoji khác giữ nguyên', () => {
    const cur = [r('👍', 5, true, ['x']), r('🎉', 1, true, ['Tôi'])];
    expect(putReactionEntry(cur, '👍', r('👍', 2, false, ['An']))).toEqual([
      r('👍', 2, false, ['An']),
      r('🎉', 1, true, ['Tôi']),
    ]);
  });
  it('bản xác nhận là undefined (chưa ai thả) → bỏ chip; chưa có chip → chèn đúng thứ tự bảng', () => {
    expect(putReactionEntry([r('👍', 1, true, ['Tôi'])], '👍', undefined)).toEqual([]);
    expect(putReactionEntry([r('🎉', 1, false, ['An'])], '👍', r('👍', 1, false, ['B']))).toEqual([
      r('👍', 1, false, ['B']),
      r('🎉', 1, false, ['An']),
    ]);
  });
});

describe('nextPickerIndex — phím mũi tên trong ô chọn emoji (6 ô, quay vòng)', () => {
  it('Phải/Xuống tiến, Trái/Lên lùi, quay vòng; Home/End; phím khác → null', () => {
    expect(nextPickerIndex(0, 'ArrowRight', 6)).toBe(1);
    expect(nextPickerIndex(5, 'ArrowRight', 6)).toBe(0);
    expect(nextPickerIndex(0, 'ArrowLeft', 6)).toBe(5);
    expect(nextPickerIndex(2, 'ArrowDown', 6)).toBe(3);
    expect(nextPickerIndex(2, 'ArrowUp', 6)).toBe(1);
    expect(nextPickerIndex(3, 'Home', 6)).toBe(0);
    expect(nextPickerIndex(3, 'End', 6)).toBe(5);
    expect(nextPickerIndex(3, 'a', 6)).toBeNull();
    expect(nextPickerIndex(3, 'Enter', 6)).toBeNull();
  });
  it('giữ Alt/Cmd/Ctrl thì KHÔNG chặn (Alt/Cmd+←/→ là Quay lại/Tiến của trình duyệt), trừ Home/End', () => {
    for (const mod of ['altKey', 'metaKey', 'ctrlKey'] as const) {
      expect(nextPickerIndex(2, 'ArrowLeft', 6, { [mod]: true })).toBeNull();
      expect(nextPickerIndex(2, 'ArrowRight', 6, { [mod]: true })).toBeNull();
      expect(nextPickerIndex(2, 'ArrowDown', 6, { [mod]: true })).toBeNull();
      expect(nextPickerIndex(2, 'Home', 6, { [mod]: true })).toBe(0);
      expect(nextPickerIndex(2, 'End', 6, { [mod]: true })).toBe(5);
    }
    expect(nextPickerIndex(2, 'ArrowRight', 6, { shiftKey: false })).toBe(3);
  });
});
