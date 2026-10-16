import { describe, expect, it } from 'vitest';
import { filterProjects, sortProjects } from './projectsFilter';

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

describe('sortProjects', () => {
  const q = (name: string, key: string, createdAt: string, archived = false) =>
    ({ id: key, name, key, createdAt, archivedAt: archived ? '2026-01-01' : null }) as never;
  const items = [
    q('Beta', 'B', '2026-02-01'),
    q('Alpha', 'A', '2026-03-01', true),
    q('Đồng bộ', 'D', '2026-01-01'),
    q('Gamma', 'G', '2026-04-01'),
  ];
  const keys = (l: { key: string }[]) => l.map((x) => x.key);
  it('Tên: A→Z theo tiếng Việt, dự án lưu trữ xuống cuối', () =>
    expect(keys(sortProjects(items, 'name'))).toEqual(['B', 'D', 'G', 'A']));
  it('Ngày tạo: mới nhất trước, lưu trữ xuống cuối', () =>
    expect(keys(sortProjects(items, 'created'))).toEqual(['G', 'B', 'D', 'A']));
  it('Gần nhất: dự án xem gần nhất đứng đầu, còn lại giữ thứ tự, lưu trữ cuối', () =>
    expect(keys(sortProjects(items, 'recent', 'G'))).toEqual(['G', 'B', 'D', 'A']));
  it('không đổi mảng gốc', () => {
    const copy = [...items];
    sortProjects(items, 'name');
    expect(items).toEqual(copy);
  });
});
