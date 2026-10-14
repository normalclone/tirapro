import { describe, expect, it } from 'vitest';
import { updateCommentSchema, updateProfileSchema, validateJqlSchema } from '@tirapro/shared';

describe('zod cho body còn thiếu', () => {
  it('updateCommentSchema đòi body không rỗng và version nguyên', () => {
    expect(updateCommentSchema.safeParse({ body: 'ok', version: 1 }).success).toBe(true);
    expect(updateCommentSchema.safeParse({ body: '', version: 1 }).success).toBe(false);
    expect(updateCommentSchema.safeParse({ body: 'ok', version: 1.5 }).success).toBe(false);
    expect(updateCommentSchema.safeParse({ body: 'ok' }).success).toBe(false);
  });

  it('updateProfileSchema loại khoá lạ (không cho ghi isSystemAdmin…)', () => {
    const r = updateProfileSchema.parse({ displayName: ' An ', isSystemAdmin: true, passwordHash: 'x' });
    expect(r).toEqual({ displayName: 'An' });
    expect(updateProfileSchema.safeParse({ displayName: '' }).success).toBe(false);
    expect(updateProfileSchema.safeParse({ avatarUrl: null }).success).toBe(true);
  });

  it('validateJqlSchema chỉ nhận chuỗi', () => {
    expect(validateJqlSchema.safeParse({}).success).toBe(true);
    expect(validateJqlSchema.safeParse({ jql: 'project = A' }).success).toBe(true);
    expect(validateJqlSchema.safeParse({ jql: 123 }).success).toBe(false);
  });
});
