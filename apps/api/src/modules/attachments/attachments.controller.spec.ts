import { describe, expect, it, vi } from 'vitest';
import { AttachmentsController } from './attachments.controller';

describe('AttachmentsController — :own', () => {
  const user = { id: 'u1' } as never;
  const make = (ownershipError?: Error) => {
    const attachments = { remove: vi.fn(() => Promise.resolve({ ok: true })) };
    const ownership = {
      assertOwnsAttachment: vi.fn(() =>
        ownershipError ? Promise.reject(ownershipError) : Promise.resolve(),
      ),
    };
    return {
      ctrl: new AttachmentsController(attachments as never, ownership as never),
      attachments,
      ownership,
    };
  };

  it('remove: kiểm sở hữu TRƯỚC khi xoá; bị từ chối thì service không được gọi', async () => {
    const { ctrl, attachments, ownership } = make(new Error('403'));
    await expect(ctrl.remove('w1', user, 'at1', true)).rejects.toThrow('403');
    expect(ownership.assertOwnsAttachment).toHaveBeenCalledWith(true, 'w1', 'u1', 'at1');
    expect(attachments.remove).not.toHaveBeenCalled();
  });
});
