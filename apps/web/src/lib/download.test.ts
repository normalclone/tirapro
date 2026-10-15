import { beforeEach, describe, expect, it, vi } from 'vitest';

const refreshAccessToken = vi.fn<() => Promise<string | null>>();
vi.mock('./api', () => ({ refreshAccessToken: () => refreshAccessToken() }));
const token = vi.hoisted(() => ({ value: 'old' }));
vi.mock('./auth-token', () => ({ getAccessToken: () => token.value }));

import { downloadErrorMessage, fetchDownload, filenameFromDisposition } from './download';

describe('filenameFromDisposition', () => {
  it('đọc filename*=UTF-8 và filename thường, rơi về fallback', () => {
    expect(
      filenameFromDisposition(`attachment; filename*=UTF-8''b%C3%A1o-c%C3%A1o.csv`, 'x.csv'),
    ).toBe('báo-cáo.csv');
    expect(filenameFromDisposition('attachment; filename="a.csv"', 'x.csv')).toBe('a.csv');
    expect(filenameFromDisposition('', 'x.csv')).toBe('x.csv');
  });
  it('percent-encoding hỏng không ném, trả nguyên chuỗi', () => {
    expect(filenameFromDisposition(`attachment; filename*=UTF-8''%E0%A4%A.csv`, 'x.csv')).toBe(
      '%E0%A4%A.csv',
    );
  });
});

describe('downloadErrorMessage', () => {
  it('câu tiếng Việt theo mã HTTP', () => {
    expect(downloadErrorMessage(401)).toContain('đăng nhập lại');
    expect(downloadErrorMessage(403)).toBe('Bạn không có quyền xuất dữ liệu này.');
    expect(downloadErrorMessage(404)).toContain('Không tìm thấy');
    expect(downloadErrorMessage(500)).toContain('Máy chủ');
    expect(downloadErrorMessage(418)).toBe('Tải dữ liệu thất bại (HTTP 418).');
  });
});

describe('fetchDownload — 401 refresh một lần rồi thử lại', () => {
  const ok = () =>
    new Response('a,b', {
      status: 200,
      headers: {
        'Content-Disposition': 'attachment; filename="x.csv"',
        'X-Export-Truncated': 'true',
      },
    });
  const status = (n: number) => new Response('', { status: n });
  const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>();
  const auth = (call: number) =>
    (fetchMock.mock.calls[call]![1]!.headers as Record<string, string>).Authorization;

  beforeEach(() => {
    fetchMock.mockReset();
    refreshAccessToken.mockReset();
    token.value = 'old';
    vi.stubGlobal('fetch', fetchMock);
  });

  it('thành công ngay: không refresh; trả tên file + cờ cắt bớt; query chỉ có tham số có giá trị', async () => {
    fetchMock.mockResolvedValueOnce(ok());
    const r = await fetchDownload('/export/x', { params: { a: 1, b: undefined } });
    expect(r.filename).toBe('x.csv');
    expect(r.truncated).toBe(true);
    expect(refreshAccessToken).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls[0]![0]).toMatch(/\/export\/x\?a=1$/);
    expect(auth(0)).toBe('Bearer old');
  });

  it('401 → refresh → thử lại đúng một lần với token mới', async () => {
    fetchMock.mockResolvedValueOnce(status(401)).mockResolvedValueOnce(ok());
    refreshAccessToken.mockResolvedValueOnce('new');
    const r = await fetchDownload('/export/x');
    expect(r.filename).toBe('x.csv');
    expect(refreshAccessToken).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(auth(1)).toBe('Bearer new');
  });

  it('401 mà refresh thất bại → báo phiên hết hạn, không gọi lần hai', async () => {
    fetchMock.mockResolvedValueOnce(status(401));
    refreshAccessToken.mockResolvedValueOnce(null);
    await expect(fetchDownload('/export/x')).rejects.toThrow('đăng nhập lại');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('401 lần hai sau refresh → không lặp vô hạn', async () => {
    fetchMock.mockResolvedValue(status(401));
    refreshAccessToken.mockResolvedValue('new');
    await expect(fetchDownload('/export/x')).rejects.toThrow('đăng nhập lại');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(refreshAccessToken).toHaveBeenCalledTimes(1);
  });

  it('403 và mất mạng đều ra câu tiếng Việt, không refresh cho 403', async () => {
    fetchMock.mockResolvedValueOnce(status(403));
    await expect(fetchDownload('/export/x')).rejects.toThrow('không có quyền');
    expect(refreshAccessToken).not.toHaveBeenCalled();
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(fetchDownload('/export/x')).rejects.toThrow('Không kết nối được máy chủ');
  });
});
