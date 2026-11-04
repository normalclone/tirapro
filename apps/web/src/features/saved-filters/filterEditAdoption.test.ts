import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Bộ lọc đã lưu — sửa được (logbug #17)', () => {
  const src = readFileSync(new URL('./FiltersPage.tsx', import.meta.url), 'utf8');
  it('mỗi bộ lọc của mình có nút Sửa mở hộp sửa tên + JQL và gọi PATCH', () => {
    expect(src).toContain('aria-label={`Sửa bộ lọc ${f.name}`}');
    expect(src).toContain("title={editing ? 'Sửa bộ lọc' : 'Tạo bộ lọc'}");
    expect(src).toContain('updateFilter.mutateAsync');
  });
  it('hộp sửa chỉ đổi tên + truy vấn: không gửi visibility/danh sách chia sẻ (chia sẻ giữ nguyên, đổi ở hộp Chia sẻ)', () => {
    expect(src).toContain('updateFilter.mutateAsync({ id: target.id, name, jql })');
    expect(src).not.toMatch(/mutateAsync\(\{[^}]*visibility/);
  });
});
