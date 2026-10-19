import { describe, expect, it } from 'vitest';
import {
  nextCheckLimit,
  projectIdsToCheck,
  resolveRulesScope,
  shouldCheckMore,
  type ScopeCan,
} from './rulesScope';

const projects = [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }];
const can =
  (m: Record<string, boolean | undefined>): ScopeCan =>
  (id) =>
    m[id];
const base = { choice: null, canWorkspace: false, projects };

describe('resolveRulesScope', () => {
  it('quản trị workspace → "Tất cả quy tắc", được quản lý', () => {
    expect(resolveRulesScope({ ...base, canWorkspace: true, projectCan: can({}) })).toEqual({
      scope: 'all',
      canManage: true,
    });
  });
  it('mặc định = dự án ĐẦU TIÊN có quyền (bỏ qua dự án đứng trước không có quyền)', () => {
    expect(
      resolveRulesScope({ ...base, projectCan: can({ p1: false, p2: true, p3: true }) }),
    ).toEqual({ scope: 'p2', canManage: true });
  });
  it('dự án đứng trước chưa biết quyền nhưng đã thấy dự án có quyền → chọn dự án đó, không chờ', () => {
    expect(resolveRulesScope({ ...base, projectCan: can({ p1: undefined, p2: true }) })).toEqual({
      scope: 'p2',
      canManage: true,
    });
  });
  it('chưa thấy dự án nào có quyền mà còn dự án đang tải quyền → chờ (chưa gọi API)', () => {
    expect(
      resolveRulesScope({ ...base, projectCan: can({ p1: false, p2: undefined, p3: false }) }),
    ).toEqual({ scope: undefined, canManage: undefined });
    expect(resolveRulesScope({ ...base, projects: undefined, projectCan: can({}) })).toEqual({
      scope: undefined,
      canManage: undefined,
    });
  });
  it('không dự án nào có quyền → dự án đầu, canManage=false (trang báo thiếu quyền, không gọi API)', () => {
    expect(
      resolveRulesScope({ ...base, projectCan: can({ p1: false, p2: false, p3: false }) }),
    ).toEqual({ scope: 'p1', canManage: false });
  });
  it('không có dự án nào → canManage=false, chưa có phạm vi', () => {
    expect(resolveRulesScope({ ...base, projects: [], projectCan: can({}) })).toEqual({
      scope: undefined,
      canManage: false,
    });
  });
  it('người dùng chọn dự án không có quyền → giữ lựa chọn, canManage=false', () => {
    expect(
      resolveRulesScope({ ...base, choice: 'p1', projectCan: can({ p1: false, p2: true }) }),
    ).toEqual({ scope: 'p1', canManage: false });
  });
  it('chọn "Tất cả quy tắc" mà không phải quản trị workspace → canManage=false', () => {
    expect(resolveRulesScope({ ...base, choice: 'all', projectCan: can({ p1: true }) })).toEqual({
      scope: 'all',
      canManage: false,
    });
  });
  it('quản trị workspace chọn một dự án → được quản lý dù quyền dự án chưa tải', () => {
    expect(
      resolveRulesScope({ ...base, canWorkspace: true, choice: 'p2', projectCan: can({}) }),
    ).toEqual({ scope: 'p2', canManage: true });
  });
});

describe('projectIdsToCheck / shouldCheckMore — không bắn quyền cho mọi dự án', () => {
  const many = Array.from({ length: 12 }, (_, i) => ({ id: `p${i}` }));
  it('quản trị workspace → không tra quyền dự án nào', () => {
    expect(
      projectIdsToCheck({ projects: many, choice: null, canWorkspace: true, limit: 5 }),
    ).toEqual([]);
  });
  it('người thường → chỉ `limit` dự án đầu; thêm dự án đã chọn nếu nằm ngoài đợt', () => {
    expect(
      projectIdsToCheck({ projects: many, choice: null, canWorkspace: false, limit: 5 }),
    ).toEqual(['p0', 'p1', 'p2', 'p3', 'p4']);
    expect(
      projectIdsToCheck({ projects: many, choice: 'p9', canWorkspace: false, limit: 2 }),
    ).toEqual(['p0', 'p1', 'p9']);
    expect(
      projectIdsToCheck({ projects: many, choice: 'all', canWorkspace: false, limit: 2 }),
    ).toEqual(['p0', 'p1']);
    expect(
      projectIdsToCheck({ projects: undefined, choice: null, canWorkspace: false, limit: 5 }),
    ).toEqual([]);
  });
  const more = (m: Record<string, boolean | undefined>, limit = 5, choice: string | null = null) =>
    shouldCheckMore({ projects: many, choice, canWorkspace: false, limit, projectCan: can(m) });
  const allFalse = Object.fromEntries(many.map((p) => [p.id, false]));
  it('đợt đã tra xong hết, không có quyền, còn dự án chưa tra → tra tiếp', () => {
    expect(more(allFalse)).toBe(true);
  });
  it('còn dự án đang tải quyền, hoặc đã thấy dự án có quyền → chưa/không tra thêm', () => {
    expect(more({ ...allFalse, p2: undefined })).toBe(false);
    expect(more({ ...allFalse, p2: true })).toBe(false);
  });
  it('đã tra hết danh sách, đã chọn tay, hoặc quản trị workspace → dừng', () => {
    expect(more(allFalse, 12)).toBe(false);
    expect(more(allFalse, 5, 'p1')).toBe(false);
    expect(
      shouldCheckMore({
        projects: many,
        choice: null,
        canWorkspace: true,
        limit: 5,
        projectCan: can(allFalse),
      }),
    ).toBe(false);
  });
});

describe('nextCheckLimit — vòng tăng đợt không kẹt khi đợt kế đã có trong cache', () => {
  const many = Array.from({ length: 22 }, (_, i) => ({ id: `p${i}` }));
  // Mọi quyền đã có sẵn trong cache (mount lại trang): dự án có quyền đầu tiên là p17.
  const cached = (id: string) => id === 'p17';
  const step = (limit: number, choice: string | null = null, canWorkspace = false) =>
    nextCheckLimit({ projects: many, choice, canWorkspace, limit, projectCan: can2(limit) });
  // Chỉ các dự án nằm trong `limit` đầu mới "biết" quyền (đúng như `useProjectsCan` chỉ truy vấn các id đang tra).
  const can2 =
    (limit: number): ScopeCan =>
    (id) =>
      many.findIndex((p) => p.id === id) < limit ? cached(id) : undefined;

  it('liên tiếp tăng từng đợt dù `shouldCheckMore` giữ nguyên true, dừng ngay khi thấy dự án có quyền', () => {
    const seen: number[] = [];
    let limit = 5;
    for (let i = 0; i < 10 && step(limit) !== limit; i++) {
      limit = step(limit);
      seen.push(limit);
    }
    expect(seen).toEqual([10, 15, 20]); // p17 nằm trong đợt 15–20 → dừng ở 20
    expect(
      resolveRulesScope({
        choice: null,
        canWorkspace: false,
        projects: many,
        projectCan: can2(limit),
      }),
    ).toEqual({ scope: 'p17', canManage: true });
  });
  it('không dự án nào có quyền → tăng tới hết danh sách rồi dừng, trang báo thiếu quyền (không skeleton mãi)', () => {
    const none: ScopeCan = () => false;
    let limit = 5;
    for (let i = 0; i < 10; i++) {
      const n = nextCheckLimit({
        projects: many,
        choice: null,
        canWorkspace: false,
        limit,
        projectCan: none,
      });
      if (n === limit) break;
      limit = n;
    }
    expect(limit).toBeGreaterThanOrEqual(many.length);
    expect(
      resolveRulesScope({ choice: null, canWorkspace: false, projects: many, projectCan: none }),
    ).toEqual({ scope: 'p0', canManage: false });
  });
  it('quản trị workspace hoặc đã chọn tay → giữ nguyên giới hạn', () => {
    expect(step(5, null, true)).toBe(5);
    expect(step(5, 'p3')).toBe(5);
  });
});
