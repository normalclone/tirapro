import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildFilterPatch, type SavedFilter } from './api';
import { canChangeFilterShare, resolveRouteFilter } from './filterShare';

const src = (f: string) => readFileSync(join(__dirname, f), 'utf8');
const app = (f: string) => readFileSync(join(__dirname, '..', '..', f), 'utf8');

const filter = (over: Partial<SavedFilter> = {}): SavedFilter => ({
  id: 'f1',
  name: 'Việc của tôi',
  jql: 'assignee = currentUser()',
  visibility: 'PRIVATE',
  sharedProjectId: null,
  ownerId: 'u1',
  isOwner: true,
  createdAt: '2026-10-01T00:00:00.000Z',
  ...over,
});

describe('buildFilterPatch — PATCH /filters/:id chỉ gửi trường được đổi', () => {
  it('đổi mức chia sẻ: gửi cả visibility và sharedProjectId (kể cả null)', () => {
    expect(buildFilterPatch({ id: 'f1', visibility: 'WORKSPACE', sharedProjectId: null })).toEqual({
      visibility: 'WORKSPACE',
      sharedProjectId: null,
    });
    expect(buildFilterPatch({ id: 'f1', visibility: 'PROJECT', sharedProjectId: 'p1' })).toEqual({
      visibility: 'PROJECT',
      sharedProjectId: 'p1',
    });
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
    expect(d).toContain('SharePanel');
    expect(d).toContain('useUpdateFilter');
    expect(d).toContain('canChangeFilterShare');
    expect(d).toContain('filterUrl(');
  });
});
