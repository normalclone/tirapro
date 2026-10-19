import { describe, expect, it } from 'vitest';
import { filterAccounts } from './accountFilter';

const users = [
  { id: '1', displayName: 'Nguyễn Văn Bình', email: 'binh@x.vn', status: 'ACTIVE' },
  { id: '2', displayName: 'Trần Dũng', email: 'dung@x.vn', status: 'DEACTIVATED' },
  { id: '3', displayName: 'Lê Hoa', email: 'hoa@corp.vn', status: 'ACTIVE' },
] as const;

describe('filterAccounts', () => {
  it('không điều kiện -> giữ nguyên', () => {
    expect(filterAccounts(users, {}).map((u) => u.id)).toEqual(['1', '2', '3']);
  });
  it('bỏ dấu tiếng Việt: "binh" khớp "Bình", "dung" khớp "Dũng"', () => {
    expect(filterAccounts(users, { search: 'binh' }).map((u) => u.id)).toEqual(['1']);
    expect(filterAccounts(users, { search: 'DUNG' }).map((u) => u.id)).toEqual(['2']);
  });
  it('gõ có dấu vẫn khớp', () => {
    expect(filterAccounts(users, { search: 'Dũng' }).map((u) => u.id)).toEqual(['2']);
  });
  it('khớp cả email', () => {
    expect(filterAccounts(users, { search: 'corp' }).map((u) => u.id)).toEqual(['3']);
  });
  it('lọc trạng thái', () => {
    expect(filterAccounts(users, { status: 'DEACTIVATED' }).map((u) => u.id)).toEqual(['2']);
    expect(filterAccounts(users, { status: 'ACTIVE' }).map((u) => u.id)).toEqual(['1', '3']);
  });
  it('kết hợp tìm kiếm + trạng thái; chuỗi chỉ có khoảng trắng bị bỏ qua', () => {
    expect(filterAccounts(users, { search: 'dung', status: 'ACTIVE' })).toEqual([]);
    expect(filterAccounts(users, { search: '   ' })).toHaveLength(3);
  });
});
