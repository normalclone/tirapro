import { describe, expect, it } from 'vitest';
import { isImageMime, parseAttachmentRef } from './ref';

describe('parseAttachmentRef', () => {
  it('nhận attachment:<id>, từ chối chuỗi khác/khoảng trắng', () => {
    expect(parseAttachmentRef('attachment:cmabc123')).toBe('cmabc123');
    expect(parseAttachmentRef('  attachment:cmabc123 ')).toBe('cmabc123');
    expect(parseAttachmentRef('attachment:')).toBeNull();
    expect(parseAttachmentRef('attachment:a b')).toBeNull();
    expect(parseAttachmentRef('https://x/y.png')).toBeNull();
    expect(parseAttachmentRef('javascript:alert(1)')).toBeNull();
  });

  it('không cho id chứa ký tự đường dẫn/script (chặn chèn vào URL tải)', () => {
    expect(parseAttachmentRef('attachment:../../etc/passwd')).toBeNull();
    expect(parseAttachmentRef('attachment:a/b')).toBeNull();
    expect(parseAttachmentRef('attachment:a?x=1')).toBeNull();
  });
});

describe('isImageMime', () => {
  it('ảnh an toàn, không SVG', () => {
    for (const m of ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif'])
      expect(isImageMime(m)).toBe(true);
    expect(isImageMime('image/svg+xml')).toBe(false);
    expect(isImageMime('application/pdf')).toBe(false);
  });

  it('không phân biệt hoa thường', () => {
    expect(isImageMime('IMAGE/PNG')).toBe(true);
  });
});
