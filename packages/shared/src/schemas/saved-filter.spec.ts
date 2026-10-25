import { describe, expect, it } from 'vitest';
import {
  SHARED_PROJECT_REQUIRED_MESSAGE,
  effectiveFilterShareError,
  savedFilterCreateSchema,
  savedFilterUpdateSchema,
} from './saved-filter';

const base = { name: 'n', jql: 'project = HR' };

describe('savedFilterCreateSchema — mức "Dự án" bắt buộc có dự án', () => {
  it('PROJECT không kèm dự án (thiếu / null / rỗng) bị từ chối: nếu không, máy chủ coi là cả không gian thấy', () => {
    for (const extra of [
      { visibility: 'PROJECT' },
      { visibility: 'PROJECT', sharedProjectId: null },
      { visibility: 'PROJECT', sharedProjectId: undefined },
    ]) {
      const r = savedFilterCreateSchema.safeParse({ ...base, ...extra });
      expect(r.success, JSON.stringify(extra)).toBe(false);
      if (!r.success) {
        expect(r.error.issues[0]?.message).toBe(SHARED_PROJECT_REQUIRED_MESSAGE);
        expect(r.error.issues[0]?.path).toEqual(['sharedProjectId']);
      }
    }
    expect(
      savedFilterCreateSchema.safeParse({ ...base, visibility: 'PROJECT', sharedProjectId: '' })
        .success,
    ).toBe(false);
  });
  it('PROJECT + dự án, PRIVATE, WORKSPACE, và không nói gì (mặc định PRIVATE) đều hợp lệ', () => {
    expect(
      savedFilterCreateSchema.safeParse({ ...base, visibility: 'PROJECT', sharedProjectId: 'p1' })
        .success,
    ).toBe(true);
    expect(savedFilterCreateSchema.safeParse({ ...base, visibility: 'PRIVATE' }).success).toBe(
      true,
    );
    expect(savedFilterCreateSchema.safeParse({ ...base, visibility: 'WORKSPACE' }).success).toBe(
      true,
    );
    expect(savedFilterCreateSchema.safeParse(base).success).toBe(true);
  });
  it('giữ nguyên các luật cũ: tên và JQL bắt buộc', () => {
    expect(savedFilterCreateSchema.safeParse({ name: '', jql: 'a = b' }).success).toBe(false);
    expect(savedFilterCreateSchema.safeParse({ name: 'x', jql: '' }).success).toBe(false);
  });
});

describe('savedFilterUpdateSchema', () => {
  it('đổi sang PROJECT phải kèm dự án khác null', () => {
    expect(savedFilterUpdateSchema.safeParse({ visibility: 'PROJECT' }).success).toBe(false);
    expect(
      savedFilterUpdateSchema.safeParse({ visibility: 'PROJECT', sharedProjectId: null }).success,
    ).toBe(false);
    expect(
      savedFilterUpdateSchema.safeParse({ visibility: 'PROJECT', sharedProjectId: 'p1' }).success,
    ).toBe(true);
  });
  it('các mức khác và sửa tên/JQL thì không đòi dự án; thân rỗng vẫn bị từ chối', () => {
    expect(
      savedFilterUpdateSchema.safeParse({ visibility: 'PRIVATE', sharedProjectId: null }).success,
    ).toBe(true);
    expect(
      savedFilterUpdateSchema.safeParse({ visibility: 'WORKSPACE', sharedProjectId: null }).success,
    ).toBe(true);
    expect(savedFilterUpdateSchema.safeParse({ name: 'mới' }).success).toBe(true);
    expect(savedFilterUpdateSchema.safeParse({}).success).toBe(false);
  });
});

describe('effectiveFilterShareError — kiểm trạng thái SAU khi sửa (chốt chặn ở dịch vụ)', () => {
  const row = (visibility: string, sharedProjectId: string | null) =>
    ({ visibility, sharedProjectId }) as never;
  it('không đụng tới visibility/sharedProjectId → luôn cho phép (bộ lọc cũ PROJECT + null vẫn đổi tên được)', () => {
    expect(effectiveFilterShareError(row('PROJECT', null), { name: 'x' })).toBeNull();
    expect(effectiveFilterShareError(row('PROJECT', null), {})).toBeNull();
  });
  it('tạo/sửa ra PROJECT + null → lỗi, kể cả khi chỉ gỡ dự án của bộ lọc đang PROJECT', () => {
    expect(effectiveFilterShareError(null, { visibility: 'PROJECT', sharedProjectId: null })).toBe(
      SHARED_PROJECT_REQUIRED_MESSAGE,
    );
    expect(effectiveFilterShareError(null, { visibility: 'PROJECT' })).toBe(
      SHARED_PROJECT_REQUIRED_MESSAGE,
    );
    expect(effectiveFilterShareError(row('PROJECT', 'p1'), { sharedProjectId: null })).toBe(
      SHARED_PROJECT_REQUIRED_MESSAGE,
    );
    expect(effectiveFilterShareError(row('WORKSPACE', null), { visibility: 'PROJECT' })).toBe(
      SHARED_PROJECT_REQUIRED_MESSAGE,
    );
  });
  it('đủ dự án, hoặc rời khỏi PROJECT → ổn', () => {
    expect(
      effectiveFilterShareError(null, { visibility: 'PROJECT', sharedProjectId: 'p1' }),
    ).toBeNull();
    expect(
      effectiveFilterShareError(row('PROJECT', 'p1'), {
        visibility: 'PRIVATE',
        sharedProjectId: null,
      }),
    ).toBeNull();
    expect(effectiveFilterShareError(row('PROJECT', 'p1'), { visibility: 'WORKSPACE' })).toBeNull();
    expect(
      effectiveFilterShareError(row('PROJECT', null), {
        visibility: 'WORKSPACE',
        sharedProjectId: null,
      }),
    ).toBeNull();
    expect(
      effectiveFilterShareError(row('WORKSPACE', null), {
        visibility: 'PROJECT',
        sharedProjectId: 'p2',
      }),
    ).toBeNull();
  });
});
