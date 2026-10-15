import { describe, expect, it, vi } from 'vitest';
import { WikiService } from './wiki.service';

describe('WikiService.search — escape ký tự đại diện LIKE', () => {
  it('q="_" / "50%" được escape (không khớp mọi trang), tìm cả title và body', async () => {
    const findMany = vi.fn(() => Promise.resolve([]));
    const service = new WikiService({ wikiPage: { findMany } } as never);
    await service.search('w1', '_');
    await service.search('w1', '50%');
    const calls = findMany.mock.calls as unknown as Array<[{ where: { OR: unknown[] } }]>;
    expect(calls[0]![0].where.OR).toEqual([
      { title: { contains: '\\_', mode: 'insensitive' } },
      { body: { contains: '\\_', mode: 'insensitive' } },
    ]);
    expect(JSON.stringify(calls[1]![0].where.OR)).toContain('"contains":"50\\\\%"');
  });
});
