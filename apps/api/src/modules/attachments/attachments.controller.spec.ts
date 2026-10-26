import 'reflect-metadata';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { PERMISSIONS } from '@tirapro/types';
import { describe, expect, it, vi } from 'vitest';
import { ownOnlyFactory } from '../../common/decorators/own-only.decorator';
import { PERMISSIONS_KEY } from '../../common/decorators/permissions.decorator';
import { PROJECT_REF_KEY } from '../../common/decorators/project-ref.decorator';
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

describe('AttachmentsController.uploadForComment — người chỉ có quyền bình luận đính ảnh', () => {
  const handler = AttachmentsController.prototype.uploadForComment;

  it('cần comment:create (không phải issue:edit), theo dự án của issue', () => {
    expect(Reflect.getMetadata(PERMISSIONS_KEY, handler)).toEqual([PERMISSIONS.COMMENT_CREATE]);
    expect(Reflect.getMetadata(PROJECT_REF_KEY, handler)).toEqual({
      kind: 'issue',
      param: 'issueId',
    });
  });

  it('không có tham số @OwnOnly và gọi thẳng attachments.upload', async () => {
    const args = Object.values(
      (Reflect.getMetadata(ROUTE_ARGS_METADATA, AttachmentsController, 'uploadForComment') ??
        {}) as Record<string, { factory?: unknown }>,
    );
    expect(args.some((a) => a.factory === ownOnlyFactory)).toBe(false);

    const attachments = { upload: vi.fn(() => Promise.resolve({ id: 'at1' })) };
    const ctrl = new AttachmentsController(attachments as never, {} as never);
    const file = { originalname: 'x.png' } as never;
    await expect(ctrl.uploadForComment('w1', { id: 'u1' } as never, 'i1', file)).resolves.toEqual({
      id: 'at1',
    });
    expect(attachments.upload).toHaveBeenCalledWith('w1', 'u1', 'i1', file);
  });
});

describe('AttachmentsController.download — header (I5)', () => {
  it('Content-Disposition theo RFC 6266: ASCII dự phòng + filename*=UTF-8, kèm Content-Type/Length', async () => {
    const headers: Record<string, string | number> = {};
    const res = { setHeader: (k: string, v: string | number) => (headers[k] = v) };
    const { Readable } = await import('node:stream');
    const attachments = {
      download: vi.fn(() =>
        Promise.resolve({
          stream: Readable.from(['x']),
          fileName: 'báo cáo tháng 10.pdf',
          mimeType: 'application/pdf',
          size: 1,
        }),
      ),
    };
    const ctrl = new AttachmentsController(attachments as never, {} as never);
    await ctrl.download('w1', 'a1', res as never);
    expect(headers['Content-Disposition']).toBe(
      `attachment; filename="bao cao thang 10.pdf"; filename*=UTF-8''b%C3%A1o%20c%C3%A1o%20th%C3%A1ng%2010.pdf`,
    );
    expect(headers['Content-Type']).toBe('application/pdf');
    expect(headers['Content-Length']).toBe(1);
  });
});
