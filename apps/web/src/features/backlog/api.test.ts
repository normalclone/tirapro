import { describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/api', () => ({ api: { patch: vi.fn() } }));
import { runBulkInChunks } from './api';

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
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('≤ 100 => đúng 1 request', async () => {
    const send = vi.fn((i: Items) => ok(i));
    await runBulkInChunks(mkItems(100), send);
    expect(send).toHaveBeenCalledTimes(1);
  });
});
