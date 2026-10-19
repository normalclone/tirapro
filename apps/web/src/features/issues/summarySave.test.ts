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

describe('saveVersion', () => {
  it('lần đầu = version lúc mở ô; sau lỗi hoặc không có bản chụp = mới nhất', () => {
    expect(saveVersion({ captured: 3, latest: 5, attempt: 0 })).toBe(3);
    expect(saveVersion({ captured: 3, latest: 5, attempt: 1 })).toBe(5);
    expect(saveVersion({ captured: null, latest: 5, attempt: 0 })).toBe(5);
  });
});

const conflict = new Error('409');
const deps = (over: Partial<SummarySaveDeps> = {}): SummarySaveDeps => ({
  attempt: 0,
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

describe('saveSummaryOnce — lưu lại có chủ đích sau lỗi (attempt ≥ 1)', () => {
  it('dùng version MỚI NHẤT, không tự thử lại/nạp lại khi 409', async () => {
    const send = vi.fn().mockRejectedValue(conflict);
    const d = deps({ attempt: 1, send });
    await expect(saveSummaryOnce(d)).rejects.toBe(conflict);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(7);
    expect(d.refetch).not.toHaveBeenCalled();
  });
});
