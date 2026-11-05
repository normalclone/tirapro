import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { AUTH_ONLY_KEY } from '../../common/decorators/auth-only.decorator';
import { PERMISSIONS_KEY } from '../../common/decorators/permissions.decorator';
import { AssistantBulkController } from './assistant-bulk.controller';
import {
  ASSISTANT_BULK_MAX_ROWS,
  assistantBulkAssignSchema,
  assistantBulkMembersSchema,
} from './assistant-bulk.schemas';

describe('AssistantBulkController', () => {
  it('route chỉ AuthOnly (không có quyền chung ở cấp route) — quyền được kiểm từng dòng trong service', () => {
    for (const name of ['assign', 'members'] as const) {
      const handler = AssistantBulkController.prototype[name];
      expect(Reflect.getMetadata(AUTH_ONLY_KEY, handler)).toBe(true);
      expect(Reflect.getMetadata(PERMISSIONS_KEY, handler)).toBeUndefined();
    }
  });

  it('chuyển đúng organizationId + người gọi + rows cho service', async () => {
    const bulk = {
      assign: vi.fn(() => Promise.resolve({ results: [] })),
      setMembers: vi.fn(() => Promise.resolve({ results: [] })),
    };
    const ctrl = new AssistantBulkController(bulk as never);
    const user = { id: 'me' } as never;
    await ctrl.assign('o1', user, { rows: [{ issueId: 'i', version: 1, assigneeId: null }] });
    await ctrl.members('o1', user, {
      rows: [{ projectId: 'p', userId: 'u', expect: null, set: ['r'] }],
    });
    expect(bulk.assign).toHaveBeenCalledWith('o1', user, [
      { issueId: 'i', version: 1, assigneeId: null },
    ]);
    expect(bulk.setMembers).toHaveBeenCalledWith('o1', user, [
      { projectId: 'p', userId: 'u', expect: null, set: ['r'] },
    ]);
  });
});

describe('schema thao tác hàng loạt', () => {
  const row = { issueId: 'i', version: 0, assigneeId: 'u' };
  it('assign: 1..200 dòng; assigneeId null được (Hoàn tác về chưa giao); version âm bị từ chối', () => {
    expect(assistantBulkAssignSchema.safeParse({ rows: [] }).success).toBe(false);
    expect(
      assistantBulkAssignSchema.safeParse({ rows: [{ ...row, assigneeId: null }] }).success,
    ).toBe(true);
    expect(assistantBulkAssignSchema.safeParse({ rows: [{ ...row, version: -1 }] }).success).toBe(
      false,
    );
    expect(
      assistantBulkAssignSchema.safeParse({ rows: Array(ASSISTANT_BULK_MAX_ROWS).fill(row) })
        .success,
    ).toBe(true);
    expect(
      assistantBulkAssignSchema.safeParse({ rows: Array(ASSISTANT_BULK_MAX_ROWS + 1).fill(row) })
        .success,
    ).toBe(false);
  });
  it('members: expect/set là null hoặc 1..20 vai trò; rỗng bị từ chối', () => {
    const ok = { projectId: 'p', userId: 'u', expect: null, set: ['r'] };
    expect(assistantBulkMembersSchema.safeParse({ rows: [ok] }).success).toBe(true);
    expect(
      assistantBulkMembersSchema.safeParse({ rows: [{ ...ok, set: null, expect: ['a', 'b'] }] })
        .success,
    ).toBe(true);
    expect(assistantBulkMembersSchema.safeParse({ rows: [{ ...ok, set: [] }] }).success).toBe(
      false,
    );
    expect(assistantBulkMembersSchema.safeParse({ rows: [{ ...ok, expect: [] }] }).success).toBe(
      false,
    );
    expect(assistantBulkMembersSchema.safeParse({ rows: [{ ...ok, userId: '' }] }).success).toBe(
      false,
    );
  });
});
