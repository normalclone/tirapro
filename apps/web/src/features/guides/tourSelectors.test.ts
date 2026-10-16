import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_GUIDES, type TourContent } from '@tirapro/shared';

function tsx(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? tsx(p) : p.endsWith('.tsx') ? [p] : [];
  });
}
const src = tsx(join(__dirname, '..', '..'))
  .map((f) => readFileSync(f, 'utf8'))
  .join('\n');

describe('tour mặc định ↔ data-tour trong giao diện', () => {
  const wanted = DEFAULT_GUIDES.filter((g) => g.type === 'TOUR')
    .flatMap((g) => (g.content as TourContent).steps.map((s) => s.selector))
    .filter((s): s is string => !!s)
    .map((s) => /data-tour="([^"]+)"/.exec(s)![1]!);
  // Chấp nhận thuộc tính dạng chữ (`data-tour="x"`) lẫn biểu thức có điều kiện (`data-tour={cond ? 'x' : undefined}`).
  it.each([...new Set(wanted)])('có thuộc tính data-tour="%s" trong mã nguồn', (name) => {
    const re = new RegExp(`data-tour=(?:"${name}"|\\{[^}]*['"]${name}['"][^}]*\\})`);
    expect(re.test(src)).toBe(true);
  });
});
