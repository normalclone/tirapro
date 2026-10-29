import { describe, expect, it } from 'vitest';
import { updateBoardSchema } from './board';

describe('updateBoardSchema.type (đổi loại board)', () => {
  it('nhận SCRUM và KANBAN, một mình đủ làm thay đổi hợp lệ', () => {
    expect(updateBoardSchema.safeParse({ type: 'SCRUM' }).success).toBe(true);
    expect(updateBoardSchema.safeParse({ type: 'KANBAN' }).success).toBe(true);
  });

  it('từ chối giá trị lạ / chữ thường / null', () => {
    expect(updateBoardSchema.safeParse({ type: 'scrum' }).success).toBe(false);
    expect(updateBoardSchema.safeParse({ type: 'FOO' }).success).toBe(false);
    expect(updateBoardSchema.safeParse({ type: null }).success).toBe(false);
  });

  it('vẫn kết hợp được với các trường khác', () => {
    expect(updateBoardSchema.safeParse({ name: 'B', type: 'KANBAN' }).success).toBe(true);
  });
});
