import { describe, expect, it, vi } from 'vitest';
import { resolveMentionedMembers } from './mentions';

describe('resolveMentionedMembers', () => {
  it('bỏ trùng + bỏ người loại trừ, chỉ giữ thành viên còn hoạt động, giữ thứ tự gõ', async () => {
    const findMany = vi.fn().mockResolvedValue([{ userId: 'u2' }]);
    const db = { workspaceMembership: { findMany } };
    const out = await resolveMentionedMembers(db as never, 'w1', ['u1', 'u2', 'u2', 'x'], 'u1');
    expect(out).toEqual(['u2']);
    expect(findMany).toHaveBeenCalledWith({
      where: {
        workspaceId: 'w1',
        userId: { in: ['u2', 'x'] },
        user: { status: { not: 'DEACTIVATED' } },
      },
      select: { userId: true },
    });
  });

  it('không có id hợp lệ → không truy vấn', async () => {
    const findMany = vi.fn();
    const db = { workspaceMembership: { findMany } };
    expect(await resolveMentionedMembers(db as never, 'w1', ['u1', ''], 'u1')).toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });
});
