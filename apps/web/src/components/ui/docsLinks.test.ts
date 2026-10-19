import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(__dirname, '..', '..');
function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx$/.test(f) && !/\.test\.tsx$/.test(f)) out.push(p);
  }
  return out;
}

describe('"Tìm hiểu thêm" (RB5)', () => {
  const docs = readFileSync(join(root, 'features/docs/DocumentationPage.tsx'), 'utf8');
  const uses = walk(root).flatMap((p) => {
    const t = readFileSync(p, 'utf8');
    return [...t.matchAll(/<DocsLink anchor="([^"]+)"/g)].map((m) => ({
      file: p.slice(root.length + 1),
      anchor: m[1] as string,
    }));
  });
  it('có chỗ dùng', () => expect(uses.length).toBeGreaterThanOrEqual(8));
  it('mọi anchor trỏ tới id có thật trong trang Hướng dẫn', () => {
    for (const u of uses) expect(docs, `${u.file} → #${u.anchor}`).toContain(`id="${u.anchor}"`);
  });
  it('trang Hướng dẫn cuộn tới #mục khi mở bằng liên kết sâu', () => {
    const scroll = readFileSync(join(root, 'features/docs/ScrollToHash.tsx'), 'utf8');
    expect(scroll).toMatch(/location\.hash[\s\S]{0,200}scrollIntoView/);
    expect(readFileSync(join(root, 'app/router.tsx'), 'utf8')).toMatch(
      /<ScrollToHash \/>\s*<DocumentationPage \/>/,
    );
  });
  it('liên kết mở tab mới và an toàn', () => {
    const s = readFileSync(join(root, 'components/ui/DocsLink.tsx'), 'utf8');
    expect(s).toMatch(/target="_blank"/);
    expect(s).toMatch(/rel="noopener noreferrer"/);
    expect(s).toMatch(/\/documentation#/);
  });
});
