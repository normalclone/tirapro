import { describe, expect, it, vi } from 'vitest';
import {
  SummaryConflictError,
  resolveConflict,
  saveSummaryOnce,
  saveVersion,
  type SummarySaveDeps,
} from './summarySave';

describe('resolveConflict — chỉ đổi TIÊU ĐỀ mới là xung đột thật', () => {
  it('tiêu đề trên máy chủ = tiêu đề lúc mở ô → thử lại tự động', () => {
    expect(resolveConflict({ startSummary: 'Cũ', serverSummary: 'Cũ' })).toBe('retry');
  });
  it('tiêu đề đã đổi → xung đột', () => {
    expect(resolveConflict({ startSummary: 'Cũ', serverSummary: 'Người khác sửa' })).toBe(
      'conflict',
    );
  });
  it('không biết tiêu đề lúc mở ô → coi là xung đột (không đoán)', () => {
    expect(resolveConflict({ startSummary: null, serverSummary: 'Cũ' })).toBe('conflict');
  });
});

describe('saveVersion — chỉ leo lên version mới nhất SAU KHI người dùng đã thấy xung đột', () => {
  it('chưa thấy xung đột (kể cả đã lỗi 500/mất mạng) = version lúc mở ô; đã thấy xung đột hoặc không có bản chụp = mới nhất', () => {
    expect(saveVersion({ captured: 3, latest: 5, conflictSeen: false })).toBe(3);
    expect(saveVersion({ captured: 3, latest: 5, conflictSeen: true })).toBe(5);
    expect(saveVersion({ captured: null, latest: 5, conflictSeen: false })).toBe(5);
  });
});

const conflict = new Error('409');
const deps = (over: Partial<SummarySaveDeps> = {}): SummarySaveDeps => ({
  conflictSeen: false,
  isMounted: () => true,
  notifyLate: vi.fn(),
  onConflictShown: vi.fn(),
  startVersion: 3,
  startSummary: 'Cũ',
  latestVersion: () => 7,
  send: vi.fn().mockResolvedValue(undefined),
  refetch: vi.fn().mockResolvedValue({ version: 9, summary: 'Cũ' }),
  isConflict: (e) => e === conflict,
  ...over,
});

describe('saveSummaryOnce — 409 ở lần lưu đầu', () => {
  it('không lỗi: gửi đúng một lần với version lúc mở ô, không nạp lại', async () => {
    const d = deps();
    await saveSummaryOnce(d);
    expect(d.send).toHaveBeenCalledTimes(1);
    expect(d.send).toHaveBeenCalledWith(3);
    expect(d.refetch).not.toHaveBeenCalled();
  });
  it('409 + tiêu đề không đổi (chỉ trường khác đổi) → nạp lại 1 lần rồi tự thử lại với version MỚI, thành công', async () => {
    const send = vi.fn().mockRejectedValueOnce(conflict).mockResolvedValueOnce(undefined);
    const d = deps({ send });
    await expect(saveSummaryOnce(d)).resolves.toBeUndefined();
    expect(d.refetch).toHaveBeenCalledTimes(1);
    expect(send.mock.calls).toEqual([[3], [9]]);
  });
  it('409 + tiêu đề đã bị đổi → SummaryConflictError kèm tiêu đề hiện tại, KHÔNG gửi lại', async () => {
    const send = vi.fn().mockRejectedValue(conflict);
    const d = deps({
      send,
      refetch: vi.fn().mockResolvedValue({ version: 9, summary: 'Người khác sửa' }),
    });
    const err = await saveSummaryOnce(d).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SummaryConflictError);
    expect((err as SummaryConflictError).serverSummary).toBe('Người khác sửa');
    expect(send).toHaveBeenCalledTimes(1);
  });
  it('nạp lại thất bại → lỗi của lần nạp (câu thường), không gửi lại', async () => {
    const boom = new Error('mất mạng');
    const send = vi.fn().mockRejectedValue(conflict);
    const d = deps({ send, refetch: vi.fn().mockRejectedValue(boom) });
    await expect(saveSummaryOnce(d)).rejects.toBe(boom);
    expect(send).toHaveBeenCalledTimes(1);
  });
  it('tự thử lại cũng lỗi (không phải 409) → lỗi đó; không lặp (đúng 2 lần gửi)', async () => {
    const e2 = new Error('500');
    const send = vi.fn().mockRejectedValueOnce(conflict).mockRejectedValueOnce(e2);
    const d = deps({ send });
    await expect(saveSummaryOnce(d)).rejects.toBe(e2);
    expect(send).toHaveBeenCalledTimes(2);
    expect(d.refetch).toHaveBeenCalledTimes(1);
  });
  it('tự thử lại lại gặp 409 → trả lỗi 409, KHÔNG lặp vòng (đúng 2 lần gửi, 1 lần nạp)', async () => {
    const send = vi.fn().mockRejectedValue(conflict);
    const d = deps({ send });
    await expect(saveSummaryOnce(d)).rejects.toBe(conflict);
    expect(send).toHaveBeenCalledTimes(2);
    expect(d.refetch).toHaveBeenCalledTimes(1);
  });
  it('lỗi khác 409 ở lần đầu → ném nguyên, không nạp lại', async () => {
    const e = new Error('500');
    const d = deps({ send: vi.fn().mockRejectedValue(e) });
    await expect(saveSummaryOnce(d)).rejects.toBe(e);
    expect(d.refetch).not.toHaveBeenCalled();
  });
});

describe('saveSummaryOnce — sau khi đã thấy xung đột (conflictSeen)', () => {
  it('dùng version MỚI NHẤT (ghi đè có chủ đích), không tự thử lại/nạp lại khi 409', async () => {
    const send = vi.fn().mockRejectedValue(conflict);
    const d = deps({ conflictSeen: true, send });
    await expect(saveSummaryOnce(d)).rejects.toBe(conflict);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(7);
    expect(d.refetch).not.toHaveBeenCalled();
  });
});

describe('saveSummaryOnce — sau lỗi KHÔNG phải xung đột (500, mất mạng) vẫn giữ version lúc mở ô', () => {
  it('Thử lại sau lỗi 500 gửi version đã chụp (không leo lên mới nhất) → thay đổi xen giữa vẫn trả 409', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const d = deps({ conflictSeen: false, send, latestVersion: () => 7 });
    await saveSummaryOnce(d);
    expect(send).toHaveBeenCalledWith(3);
  });
  it('Thử lại sau lỗi 500 mà gặp 409 thật (tiêu đề đã bị đổi) → SummaryConflictError, KHÔNG ghi đè âm thầm', async () => {
    const send = vi.fn().mockRejectedValue(conflict);
    const d = deps({
      send,
      refetch: vi.fn().mockResolvedValue({ version: 9, summary: 'Người khác sửa' }),
    });
    await expect(saveSummaryOnce(d)).rejects.toBeInstanceOf(SummaryConflictError);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(3);
  });
});

describe('saveSummaryOnce — báo xung đột đã hiển thị (để lần lưu sau được ghi đè có chủ đích)', () => {
  it('xung đột thật → gọi onConflictShown một lần', async () => {
    const d = deps({
      send: vi.fn().mockRejectedValue(conflict),
      refetch: vi.fn().mockResolvedValue({ version: 9, summary: 'Người khác sửa' }),
    });
    await saveSummaryOnce(d).catch(() => undefined);
    expect(d.onConflictShown).toHaveBeenCalledTimes(1);
  });
  it('lỗi 500 → KHÔNG gọi onConflictShown', async () => {
    const d = deps({ send: vi.fn().mockRejectedValue(new Error('500')) });
    await saveSummaryOnce(d).catch(() => undefined);
    expect(d.onConflictShown).not.toHaveBeenCalled();
  });
  it('thành công → không gọi', async () => {
    const d = deps();
    await saveSummaryOnce(d);
    expect(d.onConflictShown).not.toHaveBeenCalled();
  });
});

describe('saveSummaryOnce — lỗi đến sau khi ô sửa đã gỡ (không ai còn thấy ô lỗi)', () => {
  it('lỗi 500 sau khi gỡ → notifyLate(lỗi) đúng một lần, vẫn ném lỗi', async () => {
    const e = new Error('500');
    const d = deps({ send: vi.fn().mockRejectedValue(e), isMounted: () => false });
    await expect(saveSummaryOnce(d)).rejects.toBe(e);
    expect(d.notifyLate).toHaveBeenCalledTimes(1);
    expect(d.notifyLate).toHaveBeenCalledWith(e);
  });
  it('xung đột thật sau khi gỡ → notifyLate(SummaryConflictError); không đánh dấu "đã thấy" (không ai thấy)', async () => {
    const d = deps({
      send: vi.fn().mockRejectedValue(conflict),
      refetch: vi.fn().mockResolvedValue({ version: 9, summary: 'Người khác sửa' }),
      isMounted: () => false,
    });
    await saveSummaryOnce(d).catch(() => undefined);
    expect(d.notifyLate).toHaveBeenCalledWith(expect.any(SummaryConflictError));
    expect(d.onConflictShown).not.toHaveBeenCalled();
  });
  it('còn gắn → không notifyLate (ô sửa tự hiển thị lỗi)', async () => {
    const d = deps({ send: vi.fn().mockRejectedValue(new Error('500')), isMounted: () => true });
    await saveSummaryOnce(d).catch(() => undefined);
    expect(d.notifyLate).not.toHaveBeenCalled();
  });
  it('gỡ trong lúc lưu mà lưu thành công → im lặng', async () => {
    const d = deps({ isMounted: () => false });
    await saveSummaryOnce(d);
    expect(d.notifyLate).not.toHaveBeenCalled();
  });
});
