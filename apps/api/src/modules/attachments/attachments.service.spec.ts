import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryStorage } from '../../common/storage/memory-storage.testutil';
import { readAll } from '../../common/storage/object-storage.contract.testutil';
import { StorageUnavailableError } from '../../common/storage/object-storage';
import { AttachmentsService } from './attachments.service';

function setup(maxMb = 25) {
  const storage = new MemoryStorage();
  const rows: Record<string, unknown>[] = [];
  const prisma = {
    issue: {
      findFirst: vi.fn(() => Promise.resolve({ id: 'i1' })),
      findUnique: vi.fn(() => Promise.resolve({ project: { archivedAt: null } })),
    },
    attachment: {
      create: vi.fn(({ data }: { data: Record<string, unknown> }) => {
        const row = { id: 'a1', createdAt: new Date('2026-01-01'), commentId: null, ...data };
        rows.push(row);
        return Promise.resolve(row);
      }),
      findFirst: vi.fn(() => Promise.resolve(rows[0] ?? null)),
      delete: vi.fn(() => Promise.resolve({})),
      findMany: vi.fn(() => Promise.resolve(rows)),
    },
  };
  const config = {
    get: vi.fn(() => ({ driver: 'local', localDir: '/nowhere', maxFileSizeMb: maxMb })),
  };
  const service = new AttachmentsService(prisma as never, config as never, storage);
  return { service, storage, prisma, rows };
}

const file = (name: string, body: string, mimetype = 'text/plain') =>
  ({
    originalname: name,
    mimetype,
    size: Buffer.byteLength(body),
    buffer: Buffer.from(body),
  }) as Express.Multer.File;

describe('AttachmentsService — qua ObjectStorage', () => {
  afterEach(() => vi.restoreAllMocks());

  it('upload: ghi vào storage với khoá `{workspaceId}/{id}-{tên đã làm sạch}` (định dạng cũ), lưu checksum', async () => {
    const { service, storage, prisma } = setup();
    const dto = await service.upload('w1', 'u1', 'i1', file('báo cáo ../x.txt', 'hello'));
    const key = (prisma.attachment.create.mock.calls[0]?.[0] as { data: { storageKey: string } })
      .data.storageKey;
    expect(key).toMatch(/^w1\/[a-z0-9]+-[\w.-]+$/);
    expect(key).not.toContain('..');
    expect(storage.files.get(key)?.body.toString()).toBe('hello');
    expect(storage.files.get(key)?.contentType).toBe('text/plain');
    expect(dto.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(dto)).not.toContain(key); // DTO không lộ storageKey
  });

  it('I5: tên tiếng Việt bị multer giải mã latin1 được khôi phục (DB + khoá), tên UTF-8 đúng giữ nguyên', async () => {
    const { service, prisma } = setup();
    const mangled = Buffer.from('báo cáo tháng 10.pdf', 'utf8').toString('latin1');
    const dto = await service.upload('w1', 'u1', 'i1', file(mangled, 'x'));
    expect(dto.fileName).toBe('báo cáo tháng 10.pdf');
    const key = (prisma.attachment.create.mock.calls[0]?.[0] as { data: { storageKey: string } })
      .data.storageKey;
    expect(key).toMatch(/^w1\/[a-z0-9]+-b_o_c_o_th_ng_10\.pdf$/);
    const ok = await service.upload('w1', 'u1', 'i1', file('báo cáo tháng 10.pdf', 'x'));
    expect(ok.fileName).toBe('báo cáo tháng 10.pdf');
  });

  it('upload: lưu trữ lỗi → thông báo nghiệp vụ rõ, KHÔNG lộ chi tiết, KHÔNG tạo dòng DB, có log', async () => {
    const { service, storage, prisma } = setup();
    const logged = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    storage.failNext.put = new StorageUnavailableError(
      'Kho lưu trữ tệp không phản hồi',
      new Error('connect ETIMEDOUT 172.20.20.100:9000'),
    );
    const err = await service.upload('w1', 'u1', 'i1', file('a.txt', 'x')).catch((e: unknown) => e);
    expect((err as Error).message).toBe('Không lưu được tệp, thử lại');
    expect(JSON.stringify((err as { response?: unknown }).response)).not.toMatch(
      /172\.20|ETIMEDOUT/,
    );
    expect(prisma.attachment.create).not.toHaveBeenCalled();
    expect(logged).toHaveBeenCalled();
  });

  it('upload: vượt MAX_FILE_SIZE_MB vẫn bị chặn trước khi chạm storage', async () => {
    const { service, storage } = setup(1);
    const big = { ...file('b.bin', ''), size: 2 * 1024 * 1024 };
    await expect(service.upload('w1', 'u1', 'i1', big)).rejects.toThrow(/tối đa 1MB/);
    expect(storage.files.size).toBe(0);
  });

  it('download: stream đúng nội dung + tên + mime + size', async () => {
    const { service } = setup();
    await service.upload('w1', 'u1', 'i1', file('n.txt', 'nội dung'));
    const d = await service.download('w1', 'a1');
    expect((await readAll(d.stream)).toString()).toBe('nội dung');
    expect(d.fileName).toBe('n.txt');
    expect(d.mimeType).toBe('text/plain');
    expect(d.size).toBe(Buffer.byteLength('nội dung'));
  });

  it('download: object không còn trong storage → 404 "Tệp không tồn tại"', async () => {
    const { service, storage } = setup();
    await service.upload('w1', 'u1', 'i1', file('n.txt', 'x'));
    storage.files.clear();
    await expect(service.download('w1', 'a1')).rejects.toThrow('Tệp không tồn tại');
  });

  it('download: storage sập (không phải 404) → không giả làm 404', async () => {
    const { service, storage } = setup();
    await service.upload('w1', 'u1', 'i1', file('n.txt', 'x'));
    storage.failNext.get = new StorageUnavailableError('x');
    const err = await service.download('w1', 'a1').catch((e: unknown) => e);
    expect((err as Error).message).toBe('Không tải được tệp, thử lại');
  });

  it('remove: xoá dòng DB rồi xoá object', async () => {
    const { service, storage, prisma } = setup();
    await service.upload('w1', 'u1', 'i1', file('n.txt', 'x'));
    expect(storage.files.size).toBe(1);
    expect(await service.remove('w1', 'a1')).toEqual({ ok: true });
    expect(prisma.attachment.delete).toHaveBeenCalled();
    expect(storage.files.size).toBe(0);
  });

  it('remove: xoá object lỗi → LOG, vẫn trả ok (không chặn người dùng, giống bản local)', async () => {
    const { service, storage } = setup();
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    await service.upload('w1', 'u1', 'i1', file('n.txt', 'x'));
    storage.failNext.delete = new StorageUnavailableError('x');
    expect(await service.remove('w1', 'a1')).toEqual({ ok: true });
    expect(warn).toHaveBeenCalled();
  });
});
