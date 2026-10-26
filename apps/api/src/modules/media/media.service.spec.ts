import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryStorage } from '../../common/storage/memory-storage.testutil';
import { readAll } from '../../common/storage/object-storage.contract.testutil';
import { StorageUnavailableError } from '../../common/storage/object-storage';
import { MediaService } from './media.service';

const config = {
  get: (k: string) => ({ 'api.globalPrefix': 'api', 'api.version': 'v1' })[k],
};
const req = (host = 'h.test') => ({ get: () => host, headers: {}, protocol: 'https' }) as never;
const png = (n = 4) =>
  ({ mimetype: 'image/png', size: n, buffer: Buffer.alloc(n, 1) }) as Express.Multer.File;

describe('MediaService — qua ObjectStorage', () => {
  afterEach(() => vi.restoreAllMocks());

  it('saveAvatar: khoá `avatars/{scope}-{id}.png` (như đường dẫn cũ), URL tuyệt đối trỏ /media/avatars/', async () => {
    const storage = new MemoryStorage();
    const svc = new MediaService(config as never, storage);
    const url = await svc.saveAvatar(png(), 'user', req());
    const key = [...storage.files.keys()][0] ?? '';
    expect(key).toMatch(/^avatars\/user-[a-z0-9]+\.png$/);
    expect(url).toBe(`https://h.test/api/v1/media/${key}`);
    expect(storage.files.get(key)?.contentType).toBe('image/png');
  });

  it('saveAvatar: storage lỗi → "Không lưu được tệp, thử lại"', async () => {
    const storage = new MemoryStorage();
    storage.failNext.put = new StorageUnavailableError('x');
    const svc = new MediaService(config as never, storage);
    await expect(svc.saveAvatar(png(), 'user', req())).rejects.toThrow(
      'Không lưu được tệp, thử lại',
    );
  });

  it('serve: stream ảnh + mime theo đuôi; thiếu → 404; tên lạ → 404', async () => {
    const storage = new MemoryStorage();
    const svc = new MediaService(config as never, storage);
    await storage.put('avatars/x-1.jpg', Buffer.from('JPG'));
    const r = await svc.serve('x-1.jpg');
    expect(r.mimeType).toBe('image/jpeg');
    expect((await readAll(r.stream)).toString()).toBe('JPG');
    await expect(svc.serve('nope.png')).rejects.toThrow('Ảnh không tồn tại');
    await expect(svc.serve('../secret')).rejects.toThrow('Ảnh không tồn tại');
  });

  it('M3: tên `.`/`..` bị từ chối sạch (400), KHÔNG chạm storage, KHÔNG ghi log lỗi', async () => {
    const storage = new MemoryStorage();
    const get = vi.spyOn(storage, 'get');
    const logged = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const svc = new MediaService(config as never, storage);
    for (const bad of ['.', '..', '...']) {
      const err = await svc.serve(bad).catch((e: unknown) => e);
      expect((err as { getStatus: () => number }).getStatus()).toBe(400);
    }
    expect(get).not.toHaveBeenCalled();
    expect(logged).not.toHaveBeenCalled();
    await expect(svc.removeByUrl('https://h/api/v1/media/avatars/..')).resolves.toBeUndefined();
  });

  it('serve: storage sập (không phải 404) → lỗi nghiệp vụ, không giả làm 404', async () => {
    const storage = new MemoryStorage();
    await storage.put('avatars/x-1.jpg', Buffer.from('JPG'));
    storage.failNext.get = new StorageUnavailableError('x');
    const svc = new MediaService(config as never, storage);
    await expect(svc.serve('x-1.jpg')).rejects.toThrow('Không tải được tệp, thử lại');
  });

  it('removeByUrl: xoá đúng object; URL ngoài bị bỏ qua; lỗi xoá không ném', async () => {
    const storage = new MemoryStorage();
    const svc = new MediaService(config as never, storage);
    const url = await svc.saveAvatar(png(), 'ws', req());
    await svc.removeByUrl('https://api.dicebear.com/x/seed.svg');
    expect(storage.files.size).toBe(1);
    storage.failNext.delete = new StorageUnavailableError('x');
    await expect(svc.removeByUrl(url)).resolves.toBeUndefined();
    await svc.removeByUrl(url);
    expect(storage.files.size).toBe(0);
  });
});
