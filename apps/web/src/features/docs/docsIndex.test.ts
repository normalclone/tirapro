import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DOC_GROUPS, DOC_NAV, DOC_TOPICS } from './docsIndex';

const page = readFileSync(join(__dirname, 'DocumentationPage.tsx'), 'utf8');

describe('docsIndex', () => {
  const all = [...DOC_GROUPS.flatMap((g) => g.items), ...DOC_TOPICS];
  it('mọi id có thật trong trang Hướng dẫn (id="…") — thanh bên và trợ lý không trỏ vào hư không', () => {
    for (const e of all) expect(page, `#${e.id}`).toContain(`id="${e.id}"`);
  });
  it('id không trùng, tóm tắt không rỗng và đủ ngắn để không thay cho trang đầy đủ', () => {
    expect(new Set(all.map((e) => e.id)).size).toBe(all.length);
    for (const e of all) {
      expect(e.summary.length, e.id).toBeGreaterThan(20);
      expect(e.summary.length, e.id).toBeLessThanOrEqual(260);
      expect(e.keywords.trim(), e.id).not.toBe('');
    }
  });
  it('trang Docs lấy thanh bên từ DOC_NAV (không còn bản NAV riêng)', () => {
    expect(page).toContain('const NAV = DOC_NAV;');
    expect(DOC_NAV.map((g) => g.group)).toEqual([
      'Bắt đầu',
      'Ai cũng dùng',
      'Theo vai trò',
      'Nâng cao',
    ]);
    expect(DOC_NAV.flatMap((g) => g.items)).toHaveLength(DOC_GROUPS.flatMap((g) => g.items).length);
  });
});
