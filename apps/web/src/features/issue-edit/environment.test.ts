import { describe, expect, it } from 'vitest';
import { detectEnvironment, mergeDetected, parseUserAgent, toDraft } from './environment';

describe('parseUserAgent', () => {
  it('Chrome trên macOS', () => {
    expect(
      parseUserAgent(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      ),
    ).toEqual({ browser: 'Chrome 126', os: 'macOS' });
  });
  it('Safari trên iPhone', () => {
    expect(
      parseUserAgent(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
      ),
    ).toEqual({ browser: 'Safari 17', os: 'iOS 17.5' });
  });
  it('Edge không bị nhận nhầm thành Chrome; Firefox Windows', () => {
    expect(
      parseUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0',
      ).browser,
    ).toBe('Edge 126');
    expect(
      parseUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0',
      ),
    ).toEqual({ browser: 'Firefox 127', os: 'Windows 10/11' });
  });
  it('UA lạ => object rỗng, không ném lỗi', () => {
    expect(parseUserAgent('curl/8.0')).toEqual({});
  });
});

describe('detectEnvironment', () => {
  it('ghép UA + độ phân giải + origin/đường dẫn (không lấy query/hash)', () => {
    expect(
      detectEnvironment(
        {
          userAgent:
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        },
        { width: 1440, height: 900 },
        { origin: 'https://app.vn', pathname: '/cart' },
      ),
    ).toEqual({
      browser: 'Chrome 126',
      os: 'macOS',
      viewport: '1440×900',
      url: 'https://app.vn/cart',
    });
  });
});

describe('toDraft / mergeDetected', () => {
  it('điền từ phiên hiện tại ghi đè trình duyệt/OS/màn hình/URL nhưng giữ loại môi trường và build', () => {
    const d = toDraft({ env: 'staging', build: '2.3.1', browser: 'Cũ' });
    expect(mergeDetected(d, { browser: 'Chrome 126', viewport: '1440×900' })).toEqual({
      env: 'staging',
      build: '2.3.1',
      browser: 'Chrome 126',
      os: '',
      viewport: '1440×900',
      url: '',
    });
  });
});
