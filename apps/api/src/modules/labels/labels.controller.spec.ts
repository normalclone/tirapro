import { describe, expect, it, vi } from 'vitest';
import { LabelsController } from './labels.controller';

describe('LabelsController — :own', () => {
  const user = { id: 'u1' } as never;
  const make = (ownershipError?: Error) => {
    const labels = {
      attach: vi.fn(() => Promise.resolve({ ok: true })),
      detach: vi.fn(() => Promise.resolve({ ok: true })),
    };
    const ownership = {
      assertOwnsIssue: vi.fn(() =>
        ownershipError ? Promise.reject(ownershipError) : Promise.resolve(),
      ),
    };
    return { ctrl: new LabelsController(labels as never, ownership as never), labels, ownership };
  };

  it('attach: kiểm sở hữu TRƯỚC khi ghi; bị từ chối thì service không được gọi', async () => {
    const { ctrl, labels, ownership } = make(new Error('403'));
    await expect(ctrl.attach('w1', user, 'i1', { labelId: 'l1' }, true)).rejects.toThrow('403');
    expect(ownership.assertOwnsIssue).toHaveBeenCalledWith(true, 'w1', 'u1', 'i1');
    expect(labels.attach).not.toHaveBeenCalled();
  });

  it('detach: truyền đúng cờ ownOnly=false (quyền đầy đủ)', async () => {
    const { ctrl, labels, ownership } = make();
    await ctrl.detach('w1', user, 'i1', 'l1', false);
    expect(ownership.assertOwnsIssue).toHaveBeenCalledWith(false, 'w1', 'u1', 'i1');
    expect(labels.detach).toHaveBeenCalledWith('w1', 'i1', 'l1');
  });
});
