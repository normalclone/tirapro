import { describe, expect, it } from 'vitest';
import { safeHref, safeImg } from './safeUrl';

describe('safeHref', () => {
  it.each([
    'https://example.com/a?b=1',
    'http://example.com',
    'HTTPS://EXAMPLE.COM',
    'mailto:a@b.co',
    '/issue/DEMO-1',
    '/wiki',
  ])('cho phép %s', (u) => expect(safeHref(u)).toBe(u));

  it.each([
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    '\tjavascript:alert(1)',
    ' javascript:alert(1)',
    'java\nscript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:x',
    '//evil.com/x',
    '/\\evil.com',
    '/\t/evil.com',
    '//',
    'ftp://x',
    'evil.com',
    '',
  ])('chặn %j', (u) => expect(safeHref(u)).toBeNull());
});

describe('safeImg', () => {
  it('cho phép https, đường dẫn nội bộ và data:image', () => {
    for (const u of ['https://x.io/a.png', '/uploads/a.png', 'data:image/png;base64,AAAA'])
      expect(safeImg(u)).toBe(u);
  });
  it('chặn data:text/html, javascript:, //host, /\\host', () => {
    for (const u of [
      'data:text/html,x',
      'javascript:alert(1)',
      '//evil.com/p.png',
      '/\\evil.com/p.png',
    ])
      expect(safeImg(u)).toBeNull();
  });
});
