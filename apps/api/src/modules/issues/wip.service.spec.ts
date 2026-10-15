import { describe, expect, it, vi } from 'vitest';
import { WipService } from './wip.service';

describe('WipService.resolveWipColumn', () => {
  it('không có boardId => null, không chạm DB', async () => {
    const prisma = { boardColumn: { findFirst: vi.fn() } };
    const svc = new WipService(prisma as never, {} as never);
    await expect(svc.resolveWipColumn(undefined, 'p1', 's2')).resolves.toBeNull();
    expect(prisma.boardColumn.findFirst).not.toHaveBeenCalled();
  });
});
