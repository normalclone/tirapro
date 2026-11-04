import { describe, expect, it } from 'vitest';
import {
  MAX_SHARED_PROJECTS,
  SHARE_TARGET_REQUIRED_MESSAGE,
  filterAudienceSchema,
  resolveFilterShare,
  savedFilterCreateSchema,
  savedFilterUpdateSchema,
} from './saved-filter';

const base = { name: 'n', jql: 'project = HR' };

describe('savedFilterCreateSchema', () => {
  it('SHARED không có dự án lẫn người nào (thiếu / rỗng) bị từ chối với câu rõ ràng', () => {
    for (const extra of [
      { visibility: 'SHARED' },
      { visibility: 'SHARED', sharedProjectIds: [], sharedUserIds: [] },
    ]) {
      const r = savedFilterCreateSchema.safeParse({ ...base, ...extra });
      expect(r.success, JSON.stringify(extra)).toBe(false);
      if (!r.success) {
        expect(r.error.issues[0]?.message).toBe(SHARE_TARGET_REQUIRED_MESSAGE);
        expect(r.error.issues[0]?.path).toEqual(['sharedProjectIds']);
      }
    }
  });
  it('SHARED + ít nhất một dự án HOẶC một người; PRIVATE; không nói gì đều hợp lệ', () => {
    expect(
      savedFilterCreateSchema.safeParse({ ...base, visibility: 'SHARED', sharedProjectIds: ['p1'] })
        .success,
    ).toBe(true);
    expect(
      savedFilterCreateSchema.safeParse({ ...base, visibility: 'SHARED', sharedUserIds: ['u1'] })
        .success,
    ).toBe(true);
    expect(savedFilterCreateSchema.safeParse({ ...base, visibility: 'PRIVATE' }).success).toBe(
      true,
    );
    expect(savedFilterCreateSchema.safeParse(base).success).toBe(true);
  });
  it('mức cũ ORGANIZATION/PROJECT không còn hợp lệ', () => {
    for (const visibility of ['ORGANIZATION', 'PROJECT'])
      expect(savedFilterCreateSchema.safeParse({ ...base, visibility }).success).toBe(false);
  });
  it('khử trùng id; chặn quá nhiều đích', () => {
    const r = savedFilterCreateSchema.parse({
      ...base,
      visibility: 'SHARED',
      sharedProjectIds: ['p1', 'p1', 'p2'],
      sharedUserIds: ['u1', 'u1'],
    });
    expect(r.sharedProjectIds).toEqual(['p1', 'p2']);
    expect(r.sharedUserIds).toEqual(['u1']);
    const many = Array.from({ length: MAX_SHARED_PROJECTS + 1 }, (_, i) => `p${i}`);
    expect(
      savedFilterCreateSchema.safeParse({ ...base, visibility: 'SHARED', sharedProjectIds: many })
        .success,
    ).toBe(false);
  });
  it('giữ luật cũ: tên và JQL bắt buộc', () => {
    expect(savedFilterCreateSchema.safeParse({ name: '', jql: 'a = b' }).success).toBe(false);
    expect(savedFilterCreateSchema.safeParse({ name: 'x', jql: '' }).success).toBe(false);
  });
});

describe('savedFilterUpdateSchema', () => {
  it('cần ít nhất một trường', () => {
    expect(savedFilterUpdateSchema.safeParse({}).success).toBe(false);
    expect(savedFilterUpdateSchema.safeParse({ name: 'x' }).success).toBe(true);
  });
  it('SHARED tường minh phải kèm đích; gửi danh sách rỗng + PRIVATE là hợp lệ (bỏ chia sẻ)', () => {
    expect(savedFilterUpdateSchema.safeParse({ visibility: 'SHARED' }).success).toBe(false);
    expect(
      savedFilterUpdateSchema.safeParse({
        visibility: 'PRIVATE',
        sharedProjectIds: [],
        sharedUserIds: [],
      }).success,
    ).toBe(true);
  });
});

describe('resolveFilterShare', () => {
  const shared = { visibility: 'SHARED' as const, sharedProjectIds: ['p1'], sharedUserIds: ['u1'] };
  const priv = { visibility: 'PRIVATE' as const, sharedProjectIds: [], sharedUserIds: [] };
  it('tạo mới: không nói gì → PRIVATE', () => {
    expect(resolveFilterShare(null, {}).value).toEqual(priv);
  });
  it('chỉ đổi tên/JQL (không đụng chia sẻ) → giữ nguyên, kể cả bộ lọc đang SHARED', () => {
    expect(resolveFilterShare(shared, {}).value).toEqual(shared);
  });
  it('gửi danh sách mà không nói visibility: có đích → SHARED, hết đích → PRIVATE', () => {
    expect(resolveFilterShare(priv, { sharedUserIds: ['u2'] }).value).toEqual({
      visibility: 'SHARED',
      sharedProjectIds: [],
      sharedUserIds: ['u2'],
    });
    expect(resolveFilterShare(shared, { sharedProjectIds: [], sharedUserIds: [] }).value).toEqual(
      priv,
    );
  });
  it('chỉ gửi một danh sách thì danh sách kia giữ nguyên', () => {
    expect(resolveFilterShare(shared, { sharedProjectIds: ['p2'] }).value).toEqual({
      visibility: 'SHARED',
      sharedProjectIds: ['p2'],
      sharedUserIds: ['u1'],
    });
  });
  it('PRIVATE tường minh xoá hết đích', () => {
    expect(resolveFilterShare(shared, { visibility: 'PRIVATE' }).value).toEqual(priv);
  });
  it('SHARED tường minh mà không còn đích → lỗi', () => {
    expect(resolveFilterShare(priv, { visibility: 'SHARED' }).error).toBe(
      SHARE_TARGET_REQUIRED_MESSAGE,
    );
    expect(
      resolveFilterShare(shared, { visibility: 'SHARED', sharedProjectIds: [], sharedUserIds: [] })
        .error,
    ).toBe(SHARE_TARGET_REQUIRED_MESSAGE);
  });
});

describe('filterAudienceSchema', () => {
  it('thiếu danh sách → rỗng; bỏ trùng; quá giới hạn dự án bị từ chối', () => {
    expect(filterAudienceSchema.parse({})).toEqual({ sharedProjectIds: [], sharedUserIds: [] });
    expect(
      filterAudienceSchema.parse({ sharedProjectIds: ['a', 'a'], sharedUserIds: ['u'] }),
    ).toEqual({
      sharedProjectIds: ['a'],
      sharedUserIds: ['u'],
    });
    const many = Array.from({ length: MAX_SHARED_PROJECTS + 1 }, (_, i) => `p${i}`);
    expect(filterAudienceSchema.safeParse({ sharedProjectIds: many }).success).toBe(false);
  });
});
