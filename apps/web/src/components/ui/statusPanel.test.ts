import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { headingTag } from './StatusPanel';

const read = (rel: string) => readFileSync(join(__dirname, '..', '..', rel), 'utf8');

describe('StatusPanel — cấp tiêu đề', () => {
  it('headingTag: mặc định h1; nhận 1|2|3', () => {
    expect(headingTag()).toBe('h1');
    expect(headingTag(1)).toBe('h1');
    expect(headingTag(2)).toBe('h2');
    expect(headingTag(3)).toBe('h3');
  });
  it('source không còn <h1 cứng; có prop headingLevel', () => {
    const src = read('components/ui/StatusPanel.tsx');
    expect(src).not.toMatch(/<h1/);
    expect(src).toMatch(/headingLevel\?: 1 \| 2 \| 3/);
  });
  it('panel xem nhanh (cạnh trang đã có h1) dùng cấp 2', () => {
    expect(read('features/issues/peek/IssuePeekPanel.tsx')).toMatch(/headingLevel=\{2\}/);
  });
});
