import { describe, expect, it, vi } from 'vitest';
const { post } = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock('@/lib/api', () => ({
  api: { patch: vi.fn(), post },
  apiErrorMessage: (e: Error) => `msg:${e.message}`,
}));
import { AxiosError } from 'axios';
import {
  bulkShortfallHint,
  postStartSprint,
  rejectionReason,
  runBulkInChunks,
  sprintReportKeys,
} from './api';

const mkItems = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `i${i}`, version: 1 }));
type Items = Array<{ id: string; version: number }>;
const ok = (items: Items) =>
  Promise.resolve({
    updated: items.map((i) => ({ id: i.id, version: 2 })) as never,
    conflicts: [],
  });

describe('runBulkInChunks', () => {
  it('250 việc => 3 request (100/100/50), gộp updated + conflicts', async () => {
    const send = vi.fn((items: Items) => ok(items));
    const r = await runBulkInChunks(mkItems(250), send);
    expect(send.mock.calls.map((c) => (c[0] as unknown[]).length)).toEqual([100, 100, 50]);
    expect(r.updated).toHaveLength(250);
    expect(r.unsent).toBe(0);
  });

  it('gộp conflicts của từng lô, không mất mục nào', async () => {
    const send = vi.fn((items: Items) =>
      Promise.resolve({
        updated: items.slice(1) as never,
        conflicts: [{ id: items[0]!.id, version: 9 }],
      }),
    );
    const r = await runBulkInChunks(mkItems(150), send);
    expect(r.updated).toHaveLength(148);
    expect(r.conflicts).toEqual([
      { id: 'i0', version: 9 },
      { id: 'i100', version: 9 },
    ]);
  });

  it('lô đầu lỗi => ném (chưa ghi gì)', async () => {
    const send = vi.fn(() => Promise.reject(new Error('422')));
    await expect(runBulkInChunks(mkItems(150), send)).rejects.toThrow('422');
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('lô sau lỗi => dừng, trả phần đã xong + phần còn lại là conflicts', async () => {
    const send = vi
      .fn()
      .mockImplementationOnce((items: Items) => ok(items))
      .mockRejectedValueOnce(new Error('net'));
    const r = await runBulkInChunks(mkItems(250), send);
    expect(r.updated).toHaveLength(100);
    expect(r.conflicts).toHaveLength(150);
    expect(r.conflicts[0]).toEqual({ id: 'i100', version: 1 });
    expect(r.unsent).toBe(150); // lô lỗi + phần sau — KHÔNG phải conflict do người khác sửa
    expect(r.error).toEqual(new Error('net')); // lỗi của lô thất bại đầu tiên
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('≤ 100 => đúng 1 request', async () => {
    const send = vi.fn((i: Items) => ok(i));
    await runBulkInChunks(mkItems(100), send);
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe('bulkShortfallHint', () => {
  it('conflict thật: nói người khác vừa sửa', () => {
    expect(bulkShortfallHint(2, 0)).toMatch(/Người khác vừa sửa/);
  });
  it('chỉ có việc chưa gửi: câu trung tính, không đổ cho người khác', () => {
    const msg = bulkShortfallHint(3, 3);
    expect(msg).toBe('Một số việc chưa gửi được — thử lại.');
    expect(msg).not.toMatch(/Người khác/);
  });
  it('lẫn cả hai: nêu cả hai nguyên nhân', () => {
    expect(bulkShortfallHint(5, 3)).toMatch(/chưa gửi được\. Ngoài ra 2 việc bị người khác sửa/);
  });
});

describe('rejectionReason', () => {
  it('máy chủ từ chối (có response): trả câu lỗi — thử lại vô ích', () => {
    const e = new AxiosError('x', 'ERR_BAD_REQUEST', undefined, undefined, {
      status: 403,
    } as never);
    expect(rejectionReason(e)).toBe('msg:x');
  });
  it('mất mạng (axios không có response) hoặc lỗi không phải axios: null => câu trung tính', () => {
    expect(rejectionReason(new AxiosError('Network Error', 'ERR_NETWORK'))).toBeNull();
    expect(rejectionReason(new Error('net'))).toBeNull();
    expect(rejectionReason(undefined)).toBeNull();
  });
  it('hint dùng lý do từ chối thay cho "thử lại"', () => {
    expect(bulkShortfallHint(3, 3, 'Bạn không có quyền làm việc này.')).toBe(
      'Bạn không có quyền làm việc này.',
    );
    expect(bulkShortfallHint(5, 3, 'WIP đầy.')).toMatch(
      /^WIP đầy\. Ngoài ra 2 việc bị người khác sửa/,
    );
  });
});

describe('postStartSprint', () => {
  it('gửi ngày/mục tiêu trong body, sprintId nằm ở URL chứ không ở body', async () => {
    post.mockResolvedValueOnce({ data: { id: 's1' } });
    const r = await postStartSprint({
      sprintId: 's1',
      startDate: '2026-10-15T00:00:00.000Z',
      endDate: null,
      goal: 'G',
    });
    expect(post).toHaveBeenCalledWith('/sprints/s1/start', {
      startDate: '2026-10-15T00:00:00.000Z',
      endDate: null,
      goal: 'G',
    });
    expect(r).toEqual({ id: 's1' });
  });

  it('chỉ có sprintId → body rỗng (tương thích máy chủ cũ)', async () => {
    post.mockResolvedValueOnce({ data: {} });
    await postStartSprint({ sprintId: 's2' });
    expect(post).toHaveBeenLastCalledWith('/sprints/s2/start', {});
  });
});

describe('sprintReportKeys', () => {
  it('gồm danh sách sprint, tổng kết, burndown, velocity và báo cáo dự án', () => {
    expect(sprintReportKeys('p1', 's1')).toEqual([
      ['report', 'sprints', 'p1'],
      ['report', 'sprint-summary', 's1'],
      ['report', 'burndown', 's1'],
      ['report', 'velocity', 'p1'],
      ['report', 'project', 'p1'],
    ]);
  });
});
