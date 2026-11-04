import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildFilterPatch, type SavedFilter } from './api';
import {
  audienceOf,
  canChangeFilterShare,
  draftChanged,
  draftError,
  draftFrom,
  draftPatch,
  resolveRouteFilter,
  shareLabel,
  splitByAccess,
} from './filterShare';

const src = (f: string) => readFileSync(join(__dirname, f), 'utf8');
const app = (f: string) => readFileSync(join(__dirname, '..', '..', f), 'utf8');

const filter = (over: Partial<SavedFilter> = {}): SavedFilter => ({
  id: 'f1',
  name: 'Việc của tôi',
  jql: 'assignee = currentUser()',
  visibility: 'PRIVATE',
  ownerId: 'u1',
  isOwner: true,
  access: 'owner',
  owner: { id: 'u1', displayName: 'Chủ', avatarUrl: null },
  sharedProjects: [],
  sharedUsers: [],
  createdAt: '2026-10-01T00:00:00.000Z',
  ...over,
});

describe('buildFilterPatch — PATCH /filters/:id chỉ gửi trường được đổi', () => {
  it('đổi chia sẻ: gửi cả visibility và hai danh sách (kể cả rỗng)', () => {
    expect(
      buildFilterPatch({
        id: 'f1',
        visibility: 'SHARED',
        sharedProjectIds: ['p1'],
        sharedUserIds: [],
      }),
    ).toEqual({ visibility: 'SHARED', sharedProjectIds: ['p1'], sharedUserIds: [] });
  });
  it('không gửi id trong thân yêu cầu, không gửi trường không đổi', () => {
    const body = buildFilterPatch({ id: 'f1', name: 'Mới' });
    expect(body).toEqual({ name: 'Mới' });
    expect('visibility' in body).toBe(false);
    expect('id' in body).toBe(false);
  });
});

describe('useUpdateFilter', () => {
  const s = src('api.ts');
  it('dùng PATCH /filters/:id sẵn có, thay bản ghi trong cache danh sách và làm mới', () => {
    expect(s).toMatch(/export function useUpdateFilter\(/);
    expect(s).toMatch(/api\.patch<SavedFilter>\(`\/filters\/\$\{input\.id\}`/);
    expect(s).toMatch(/keys\.filters\.all/);
  });
});

describe('canChangeFilterShare — chỉ chủ có filter:manage', () => {
  it('chủ + quyền → được; chủ không quyền, người khác có quyền → không', () => {
    expect(canChangeFilterShare(filter({ isOwner: true }), true)).toBe(true);
    expect(canChangeFilterShare(filter({ isOwner: true }), false)).toBe(false);
    expect(canChangeFilterShare(filter({ isOwner: false }), true)).toBe(false);
  });
});

describe('resolveRouteFilter — /filters/:id', () => {
  const list = [filter(), filter({ id: 'f2', name: 'Khác' })];
  it('không có :id → none', () => {
    expect(resolveRouteFilter({ data: list, isError: false }, undefined)).toEqual({
      state: 'none',
    });
  });
  it('danh sách chưa về → loading (không vội báo "không thấy")', () => {
    expect(resolveRouteFilter({ data: undefined, isError: false }, 'f1')).toEqual({
      state: 'loading',
    });
  });
  it('lỗi tải danh sách khi chưa có dữ liệu → error', () => {
    expect(resolveRouteFilter({ data: undefined, isError: true }, 'f1')).toEqual({
      state: 'error',
    });
  });
  it('có trong danh sách người xem thấy → found', () => {
    const r = resolveRouteFilter({ data: list, isError: false }, 'f2');
    expect(r).toMatchObject({ state: 'found' });
    expect(r.state === 'found' && r.filter.name).toBe('Khác');
  });
  it('KHÔNG có trong danh sách (không tồn tại, xoá, hoặc người xem không có quyền) → missing, không phân biệt', () => {
    expect(resolveRouteFilter({ data: list, isError: false }, 'ghost')).toEqual({
      state: 'missing',
    });
    expect(resolveRouteFilter({ data: [], isError: false }, 'f1')).toEqual({ state: 'missing' });
  });
});

describe('nối dây', () => {
  it('router: /filters/:id dùng cùng trang bộ lọc (một tuyến, id tuỳ chọn → không dựng lại khi đổi)', () => {
    expect(app('app/router.tsx')).toMatch(/path: 'filters\/:id\?', element: <FiltersPage \/>/);
  });
  it('FiltersPage: đọc :id, nạp & chạy bộ lọc, trạng thái không-thấy dùng StatusPanel not-found', () => {
    const s = src('FiltersPage.tsx');
    expect(s).toContain('useParams');
    expect(s).toContain('resolveRouteFilter');
    expect(s).toMatch(/variant="not-found"/);
    expect(s).toContain('Không tìm thấy bộ lọc');
  });
  it('mỗi hàng bộ lọc có nút "Chia sẻ bộ lọc <tên>" mở FilterShareDialog; chủ mới đổi được', () => {
    const s = src('FiltersPage.tsx');
    expect(s).toContain('Chia sẻ bộ lọc ${f.name}');
    expect(s).toContain('FilterShareDialog');
    const d = src('FilterShareDialog.tsx');
    expect(d).toContain('useUpdateFilter');
    expect(d).toContain('canChangeFilterShare');
    expect(d).toContain('filterUrl(');
  });
  it('biểu mẫu "Tạo bộ lọc" không còn chọn phạm vi: bộ lọc mới riêng tư, chia sẻ qua hộp "Chia sẻ" sau khi lưu', () => {
    const s = src('FiltersPage.tsx');
    const form = s.slice(s.indexOf('function CreateFilterModalInner'));
    expect(form).not.toMatch(/value: 'WORKSPACE'/);
    expect(form).not.toMatch(/value: 'PRIVATE'/);
    expect(form).toContain('Bộ lọc mới chỉ mình bạn xem được');
  });
  it('đường dẫn đổi sang id KHÔNG thấy khi đang có kết quả → bỏ kết quả cũ (không để kết quả sai dưới URL sai)', () => {
    const s = src('FiltersPage.tsx');
    expect(s).toMatch(
      /routeFilter\.state === 'missing'[\s\S]{0,260}setActive\(\{ kind: 'none' \}\)/,
    );
    expect(s).toMatch(/routeFilter\.state === 'missing'[\s\S]{0,260}setResults\(null\)/);
    expect(s).toMatch(/routeFilter\.state === 'missing'[\s\S]{0,260}setAdhocJql\(''\)/);
  });
});

describe('rail: hai nhóm "Của tôi" / "Được chia sẻ với tôi"', () => {
  it('tách theo access, giữ thứ tự máy chủ', () => {
    const list = [
      filter({ id: 'a' }),
      filter({ id: 'b', access: 'shared', isOwner: false, visibility: 'SHARED' }),
      filter({ id: 'c' }),
    ];
    const { mine, shared } = splitByAccess(list);
    expect(mine.map((f) => f.id)).toEqual(['a', 'c']);
    expect(shared.map((f) => f.id)).toEqual(['b']);
  });
  it('nhãn: Riêng tư / Chia sẻ · N dự án · M người / Được chia sẻ', () => {
    expect(shareLabel(filter())).toBe('Riêng tư');
    expect(
      shareLabel(
        filter({
          visibility: 'SHARED',
          sharedProjects: [
            { id: 'p1', key: 'A', name: 'A' },
            { id: 'p2', key: 'B', name: 'B' },
          ],
          sharedUsers: [{ id: 'u2', displayName: 'X', avatarUrl: null }],
        }),
      ),
    ).toBe('Chia sẻ · 2 dự án · 1 người');
    expect(
      shareLabel(
        filter({
          visibility: 'SHARED',
          sharedUsers: [{ id: 'u2', displayName: 'X', avatarUrl: null }],
        }),
      ),
    ).toBe('Chia sẻ · 1 người');
    expect(shareLabel(filter({ access: 'shared', isOwner: false, visibility: 'SHARED' }))).toBe(
      'Được chia sẻ',
    );
  });
});

describe('bản nháp chia sẻ', () => {
  const shared = filter({
    visibility: 'SHARED',
    sharedProjects: [{ id: 'p1', key: 'A', name: 'A' }],
    sharedUsers: [{ id: 'u2', displayName: 'X', avatarUrl: null }],
  });
  it('draftFrom → draftPatch: SHARED gửi đủ ba trường; PRIVATE xoá hết đích', () => {
    expect(draftPatch(draftFrom(shared))).toEqual({
      visibility: 'SHARED',
      sharedProjectIds: ['p1'],
      sharedUserIds: ['u2'],
    });
    expect(draftPatch({ visibility: 'PRIVATE', projectIds: ['p1'], userIds: ['u2'] })).toEqual({
      visibility: 'PRIVATE',
      sharedProjectIds: [],
      sharedUserIds: [],
    });
  });
  it('"Chia sẻ" mà chưa chọn dự án/người nào → lỗi; có một trong hai → hợp lệ', () => {
    expect(draftError({ visibility: 'SHARED', projectIds: [], userIds: [] })).toBe(
      'Chọn ít nhất một dự án hoặc một người để chia sẻ',
    );
    expect(draftError({ visibility: 'SHARED', projectIds: ['p'], userIds: [] })).toBeNull();
    expect(draftError({ visibility: 'SHARED', projectIds: [], userIds: ['u'] })).toBeNull();
    expect(draftError({ visibility: 'PRIVATE', projectIds: [], userIds: [] })).toBeNull();
  });
  it('draftChanged: so theo tập (không theo thứ tự); riêng tư bỏ qua danh sách', () => {
    const a = draftFrom(shared);
    expect(draftChanged(a, { ...a, projectIds: [...a.projectIds] })).toBe(false);
    expect(draftChanged(a, { ...a, userIds: ['u2', 'u3'] })).toBe(true);
    expect(draftChanged(a, { visibility: 'PRIVATE', projectIds: [], userIds: [] })).toBe(true);
    const priv = draftFrom(filter());
    expect(draftChanged({ ...priv, projectIds: ['x'] }, priv)).toBe(false);
  });
});

describe('audienceOf — hợp thành viên dự án + người cụ thể, không đếm trùng', () => {
  const P = (id: string, active = true) => ({ id, name: id, avatarUrl: null, active });
  it('một người ở nhiều dự án + được chọn riêng chỉ đếm một lần; không tính chủ bộ lọc; bỏ người đã vô hiệu', () => {
    const r = audienceOf({
      projectIds: ['p1', 'p2'],
      userIds: ['b', 'owner'],
      projectMembers: {
        p1: [P('owner'), P('a'), P('b')],
        p2: [P('a'), P('c'), P('off', false)],
      },
      people: {
        b: { id: 'b', name: 'b', avatarUrl: null },
        owner: { id: 'owner', name: 'owner', avatarUrl: null },
      },
      ownerId: 'owner',
    });
    expect(r.people.map((p) => p.id).sort()).toEqual(['a', 'b', 'c']);
    expect(r.loading).toBe(false);
  });
  it('dự án chưa tải thành viên → loading (đừng báo số sai); chỉ người cụ thể thì không cần tải', () => {
    expect(
      audienceOf({ projectIds: ['p1'], userIds: [], projectMembers: {}, people: {}, ownerId: 'o' })
        .loading,
    ).toBe(true);
    const r = audienceOf({
      projectIds: [],
      userIds: ['b'],
      projectMembers: {},
      people: { b: { id: 'b', name: 'b', avatarUrl: null } },
      ownerId: 'o',
    });
    expect(r.loading).toBe(false);
    expect(r.people).toHaveLength(1);
  });
});
