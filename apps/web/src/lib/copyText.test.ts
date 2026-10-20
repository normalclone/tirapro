import { afterEach, describe, expect, it, vi } from 'vitest';
import { COPIED_FLASH_MS, dashboardUrl, filterUrl, issueUrl, writeClipboard } from './copyText';

describe('issueUrl', () => {
  it('ghép origin + /issue/KEY, không mang query/hash của trang hiện tại', () => {
    expect(issueUrl('TIRA-12', 'https://app.example.com')).toBe(
      'https://app.example.com/issue/TIRA-12',
    );
  });
  it('bỏ dấu / thừa ở cuối origin', () => {
    expect(issueUrl('A-1', 'https://x.test/')).toBe('https://x.test/issue/A-1');
  });
  it('mã được mã hoá đường dẫn', () => {
    expect(issueUrl('A B/1', 'https://x.test')).toBe('https://x.test/issue/A%20B%2F1');
  });
  it('mặc định lấy origin của cửa sổ hiện tại', () => {
    vi.stubGlobal('window', { location: { origin: 'http://localhost:5173' } });
    expect(issueUrl('P-3')).toBe('http://localhost:5173/issue/P-3');
    vi.unstubAllGlobals();
  });
});

describe('dashboardUrl / filterUrl — liên kết TRONG ứng dụng (không cấp thêm quyền)', () => {
  it('bảng tổng quan: origin + /dashboards/ID', () => {
    expect(dashboardUrl('d1', 'https://app.example.com/')).toBe(
      'https://app.example.com/dashboards/d1',
    );
  });
  it('bộ lọc: origin + /filters/ID', () => {
    expect(filterUrl('f1', 'https://app.example.com')).toBe('https://app.example.com/filters/f1');
  });
  it('id được mã hoá đường dẫn', () => {
    expect(filterUrl('a/b c', 'https://x.test')).toBe('https://x.test/filters/a%2Fb%20c');
  });
});

describe('COPIED_FLASH_MS', () => {
  it('dấu ✓ hiện 1,2 giây', () => {
    expect(COPIED_FLASH_MS).toBe(1200);
  });
});

describe('writeClipboard', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('true khi ghi được', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    await expect(writeClipboard('abc')).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith('abc');
  });
  it('false khi trình duyệt từ chối', async () => {
    vi.stubGlobal('navigator', {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error('x')) },
    });
    await expect(writeClipboard('abc')).resolves.toBe(false);
  });
  it('false khi không có navigator.clipboard (HTTP thường)', async () => {
    vi.stubGlobal('navigator', {});
    await expect(writeClipboard('abc')).resolves.toBe(false);
  });
});
