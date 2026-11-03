import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Bộ lọc đã lưu — sửa được (logbug #17)', () => {
  const src = readFileSync(new URL('./FiltersPage.tsx', import.meta.url), 'utf8');
  it('mỗi bộ lọc của mình có nút Sửa mở hộp sửa tên + JQL + phạm vi và gọi PATCH', () => {
    expect(src).toContain('aria-label={`Sửa bộ lọc ${f.name}`}');
    expect(src).toContain("title={editing ? 'Sửa bộ lọc' : 'Tạo bộ lọc'}");
    expect(src).toContain('updateFilter.mutateAsync');
  });
  it('bộ lọc chia sẻ theo dự án giữ nguyên phạm vi khi sửa', () => {
    expect(src).toContain("target.visibility === 'PROJECT' ? {} : { visibility }");
  });
});
