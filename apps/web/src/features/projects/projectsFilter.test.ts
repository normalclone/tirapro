import { describe, expect, it } from 'vitest';
import { filterProjects } from './projectsFilter';

const p = (name: string, key: string, lead?: string) =>
  ({ id: key, name, key, lead: lead ? { displayName: lead } : null }) as never;
const list = [p('Giỏ hàng & Thanh toán', 'GHT', 'Bình (BA)'), p('Demo App', 'DEMO', 'An Quản Trị')];

describe('filterProjects', () => {
  it('rỗng → trả nguyên danh sách', () => expect(filterProjects(list, '  ')).toHaveLength(2));
  it('tìm không dấu theo tên', () =>
    expect(filterProjects(list, 'gio hang').map((x) => x.key)).toEqual(['GHT']));
  it('tìm theo mã (không phân biệt hoa thường)', () =>
    expect(filterProjects(list, 'demo').map((x) => x.key)).toEqual(['DEMO']));
  it('tìm theo người phụ trách', () =>
    expect(filterProjects(list, 'quan tri').map((x) => x.key)).toEqual(['DEMO']));
  it('không khớp → rỗng', () => expect(filterProjects(list, 'zzz')).toEqual([]));
  it('gõ có dấu vẫn khớp, "đ" khớp "d"', () => {
    expect(filterProjects(list, 'Giỏ hàng').map((x) => x.key)).toEqual(['GHT']);
    expect(filterProjects([p('Đồng bộ', 'DB')], 'dong bo')).toHaveLength(1);
  });
});
