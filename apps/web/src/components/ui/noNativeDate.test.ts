import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx$/.test(f)) out.push(p);
  }
  return out;
}

describe('ô ngày giờ', () => {
  it('không dùng input date/datetime-local/time native (dùng DateInput/DateTimeInput)', () => {
    // Ngoại lệ duy nhất: DateInput.tsx — ô lịch ẩn (sr-only) chỉ để mở lịch hệ điều hành.
    const bad = walk(join(__dirname, '..', '..'))
      .filter((f) => !f.endsWith('DateInput.tsx'))
      .filter((f) => /type=["'](date|datetime-local|time)["']/.test(readFileSync(f, 'utf8')));
    expect(bad.map((f) => f.split('/src/')[1])).toEqual([]);
  });
});
