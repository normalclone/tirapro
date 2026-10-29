import { describe, expect, it } from 'vitest';
import { COALESCE_TYPES, mergeNotificationPayload as merge } from './notification-merge';

describe('mergeNotificationPayload', () => {
  const prev = {
    key: 'TP-1',
    summary: 'S',
    count: 1,
    excerpt: 'một',
    actors: [{ id: 'a1', name: 'Trang' }],
    actorName: 'Trang',
  };
  it('cộng dồn count, thêm người mới (khử trùng theo id), lấy trích đoạn mới nhất', () => {
    const out = merge(prev, {
      key: 'TP-1',
      summary: 'S',
      excerpt: 'hai',
      actors: [{ id: 'a2', name: 'Dũng' }],
      actorName: 'Dũng',
    });
    expect(out).toMatchObject({
      count: 2,
      excerpt: 'hai',
      actors: [
        { id: 'a1', name: 'Trang' },
        { id: 'a2', name: 'Dũng' },
      ],
    });
    expect(merge(out, { actors: [{ id: 'a1', name: 'Trang' }] }).actors).toHaveLength(2);
  });
  it('đổi trạng thái: giữ "từ" đầu tiên, "đến" mới nhất', () => {
    const s1 = { key: 'TP-1', statusName: 'Done', fromStatusName: 'In Review', count: 1 };
    expect(merge(s1, { key: 'TP-1', statusName: 'To Do', fromStatusName: 'Done' })).toMatchObject({
      fromStatusName: 'In Review',
      statusName: 'To Do',
      count: 2,
    });
  });
  it('tối đa 20 người trong danh sách', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ id: `u${i}`, name: `U${i}` }));
    expect(merge({ actors: many }, { actors: [{ id: 'x', name: 'X' }] }).actors).toHaveLength(20);
  });
  it('MENTIONED và ISSUE_ASSIGNED không thuộc loại được gộp', () => {
    expect(COALESCE_TYPES.has('MENTIONED')).toBe(false);
    expect(COALESCE_TYPES.has('ISSUE_ASSIGNED')).toBe(false);
    expect(COALESCE_TYPES.has('COMMENT_ADDED')).toBe(true);
    expect(COALESCE_TYPES.has('WATCHING_UPDATE')).toBe(true);
  });
});
