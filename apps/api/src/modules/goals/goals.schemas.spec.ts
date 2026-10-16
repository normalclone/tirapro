import { describe, expect, it } from 'vitest';
import {
  createKeyResultSchema,
  keyResultUpsertSchema,
  parseSourceConfig,
  updateKeyResultSchema,
} from './goals.schemas';

const base = { name: 'KR', targetValue: 0 };

describe('keyResultUpsertSchema — nguồn số liệu (L25)', () => {
  it('mặc định nhập tay: không cần cấu hình', () => {
    expect(keyResultUpsertSchema.safeParse(base).success).toBe(true);
    expect(keyResultUpsertSchema.safeParse({ ...base, source: 'MANUAL' }).success).toBe(true);
  });

  it('SPRINT_COMPLETION thiếu projectId → từ chối', () => {
    expect(keyResultUpsertSchema.safeParse({ ...base, source: 'SPRINT_COMPLETION' }).success).toBe(
      false,
    );
    expect(
      keyResultUpsertSchema.safeParse({
        ...base,
        source: 'SPRINT_COMPLETION',
        sourceConfig: { projectId: 'p1' },
      }).success,
    ).toBe(true);
  });

  it('ISSUE_COUNT_JQL thiếu/rỗng/quá 500 ký tự → từ chối', () => {
    const jql = (v: unknown) =>
      keyResultUpsertSchema.safeParse({
        ...base,
        source: 'ISSUE_COUNT_JQL',
        sourceConfig: v === undefined ? undefined : { jql: v },
      }).success;
    expect(jql(undefined)).toBe(false);
    expect(jql('   ')).toBe(false);
    expect(jql('x'.repeat(501))).toBe(false);
    expect(jql('x'.repeat(500))).toBe(true);
    expect(jql('statusCategory = DONE')).toBe(true);
  });

  it('OPEN_BUGS hợp lệ không cấu hình hoặc có projectId', () => {
    expect(keyResultUpsertSchema.safeParse({ ...base, source: 'OPEN_BUGS' }).success).toBe(true);
    expect(
      keyResultUpsertSchema.safeParse({
        ...base,
        source: 'OPEN_BUGS',
        sourceConfig: { projectId: 'p1' },
      }).success,
    ).toBe(true);
  });

  it('nguồn lạ bị từ chối', () => {
    expect(keyResultUpsertSchema.safeParse({ ...base, source: 'SQL' }).success).toBe(false);
  });

  it('create/update KR lồng cùng luật; update chỉ kiểm khi đổi nguồn', () => {
    expect(createKeyResultSchema.safeParse({ ...base, source: 'SPRINT_COMPLETION' }).success).toBe(
      false,
    );
    expect(updateKeyResultSchema.safeParse({ source: 'ISSUE_COUNT_JQL' }).success).toBe(false);
    expect(updateKeyResultSchema.safeParse({ currentValue: 3 }).success).toBe(true);
  });

  it('parseSourceConfig chuẩn hoá: MANUAL → null, bỏ khoá thừa', () => {
    expect(parseSourceConfig('MANUAL', { jql: 'x' })).toBeNull();
    expect(parseSourceConfig('OPEN_BUGS', { projectId: 'p1', evil: 1 })).toEqual({
      projectId: 'p1',
    });
    expect(parseSourceConfig('ISSUE_COUNT_JQL', { jql: '  type = Bug ' })).toEqual({
      jql: 'type = Bug',
    });
  });
});
