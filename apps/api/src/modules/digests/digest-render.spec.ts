import { describe, expect, it } from 'vitest';
import type { DigestModel } from '@tirapro/shared';
import { renderPlainText, renderTelegramHtml, TELEGRAM_MAX_LENGTH } from './digest-render';

const model = (lines: string[], title = 'Tổng kết'): DigestModel => ({
  title,
  subtitle: '',
  sections: [{ id: 'sprint', title: 'Sprint', lines }],
});

describe('digest-render', () => {
  it('escape đúng một lần: "Tài khoản & Giỏ hàng" → Telegram HTML có &amp;, text thuần giữ nguyên "&"', () => {
    const m = model(['Tài khoản & Giỏ hàng · còn 8 điểm']);
    expect(renderTelegramHtml(m)).toContain('Tài khoản &amp; Giỏ hàng');
    expect(renderTelegramHtml(m)).not.toContain('&amp;amp;');
    expect(renderPlainText(m)).toContain('Tài khoản & Giỏ hàng');
    expect(renderPlainText(m)).not.toMatch(/&amp;|<b>/);
  });

  it('escape cả < và > trong tiêu đề/dòng (không để người dùng chèn thẻ vào Telegram)', () => {
    const html = renderTelegramHtml(model(['<script>x</script>'], 'A <b> B'));
    expect(html).toContain('&lt;script&gt;x&lt;/script&gt;');
    expect(html).toContain('A &lt;b&gt; B');
    expect(html).not.toContain('<script>');
  });

  it('Telegram dùng <b> cho tiêu đề; text thuần không có thẻ', () => {
    const m = model(['một dòng']);
    expect(renderTelegramHtml(m)).toContain('<b>Tổng kết</b>');
    expect(renderTelegramHtml(m)).toContain('<b>Sprint</b>');
    expect(renderPlainText(m)).toContain('Tổng kết');
    expect(renderPlainText(m)).toContain('• một dòng');
  });

  it('subtitle chỉ hiện khi có; khối không có dòng bị bỏ', () => {
    const m: DigestModel = {
      title: 'T',
      subtitle: 'Dự án X',
      sections: [
        { id: 'a', title: 'Có dòng', lines: ['x'] },
        { id: 'b', title: 'Rỗng', lines: [] },
      ],
    };
    expect(renderPlainText(m)).toContain('Dự án X');
    expect(renderPlainText(m)).not.toContain('Rỗng');
    expect(renderTelegramHtml(m)).not.toContain('Rỗng');
    expect(renderPlainText(model(['x']))).not.toMatch(/\n\n\n/);
  });

  it('cắt ở 4096 ký tự kèm số dòng còn lại', () => {
    const lines = Array.from({ length: 500 }, (_, i) => `Dòng số ${i + 1} & thêm chữ cho dài`);
    const out = renderTelegramHtml(model(lines));
    expect(out.length).toBeLessThanOrEqual(TELEGRAM_MAX_LENGTH);
    expect(out).toMatch(/…\(còn \d+ dòng\)/);
    // Không cắt giữa thực thể &amp; (Telegram từ chối HTML hỏng).
    expect(out).not.toMatch(/&[a-z]*$/);
  });

  it('không cắt khi vừa đủ', () => {
    const out = renderTelegramHtml(model(['a', 'b']));
    expect(out).not.toContain('còn');
  });
});
