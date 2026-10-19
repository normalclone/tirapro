import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SaveStatus } from './SaveStatus';

const at = new Date(2026, 9, 19, 14, 2).getTime();
const html = (status: Parameters<typeof SaveStatus>[0]['status'], onRetry?: () => void) =>
  renderToStaticMarkup(<SaveStatus status={status} onRetry={onRetry} />);

describe('<SaveStatus>', () => {
  it('luôn có vùng aria-live="polite" (kể cả idle, để trình đọc màn hình đã đăng ký trước khi chữ đổi)', () => {
    for (const s of [{ state: 'idle' }, { state: 'saving' }, { state: 'saved', at }] as const)
      expect(html(s)).toMatch(/aria-live="polite"/);
    expect(html({ state: 'idle' })).not.toMatch(/>\s*\S[^<]*</);
  });
  it('đang lưu / đã lưu lúc / lỗi đúng chữ', () => {
    expect(html({ state: 'saving' })).toContain('Đang lưu…');
    expect(html({ state: 'saved', at })).toContain('Đã lưu lúc 14:02');
    const err = html({ state: 'error' }, () => undefined);
    expect(err.replace(/<[^>]+>/g, '')).toBe('Lỗi · Thử lại');
  });
  it('"Thử lại" là nút thật (button type=button); không có onRetry thì chỉ là chữ', () => {
    expect(html({ state: 'error' }, () => undefined)).toMatch(
      /<button[^>]*type="button"[^>]*>Thử lại<\/button>/,
    );
    expect(html({ state: 'error' })).not.toContain('<button');
  });
  it('không icon nhún/animation mạnh: fade ngắn, tôn trọng motion-reduce, token danger cho lỗi', () => {
    const s = readFileSync(join(__dirname, 'SaveStatus.tsx'), 'utf8');
    expect(s).toMatch(/motion-reduce/);
    expect(s).toMatch(/duration-fast/);
    expect(s).toMatch(/text-danger/);
    expect(s).not.toMatch(/animate-(bounce|pulse|spin)/);
  });
});
