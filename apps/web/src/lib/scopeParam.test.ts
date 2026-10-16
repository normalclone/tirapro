import { describe, expect, it } from 'vitest';
import { scopeFromParam } from './scopeParam';

const projects = [{ id: 'p1' }, { id: 'p2' }];
describe('scopeFromParam', () => {
  it('id có trong danh sách → dùng', () => expect(scopeFromParam('p2', projects)).toBe('p2'));
  it('id lạ / rỗng / chưa tải danh sách → null', () => {
    expect(scopeFromParam('zzz', projects)).toBeNull();
    expect(scopeFromParam('', projects)).toBeNull();
    expect(scopeFromParam(null, projects)).toBeNull();
    expect(scopeFromParam('p1', undefined)).toBeNull();
  });
});
