import { afterEach, describe, expect, it } from 'vitest';
import { MemoryStorage } from './memory-storage.testutil';
import { StorageUnavailableError } from './object-storage';
import { avatarKeyFromUrl, collectKeys, migrateObjects } from './migrate-local-to-s3';

const put = (s: MemoryStorage, key: string, body: string) => s.put(key, Buffer.from(body));

describe('avatarKeyFromUrl', () => {
  it('trích khoá `avatars/<file>` từ URL media của ta; URL ngoài/lạ → null', () => {
    expect(avatarKeyFromUrl('https://h.test/api/v1/media/avatars/user-abc.png')).toBe(
      'avatars/user-abc.png',
    );
    expect(avatarKeyFromUrl('http://x/api/v1/media/avatars/ws-1.webp?v=2')).toBe(
      'avatars/ws-1.webp',
    );
    expect(avatarKeyFromUrl('https://api.dicebear.com/9.x/x/svg?seed=a')).toBeNull();
    expect(avatarKeyFromUrl('https://h.test/api/v1/media/avatars/../../etc/passwd')).toBeNull();
    expect(avatarKeyFromUrl(null)).toBeNull();
    expect(avatarKeyFromUrl('')).toBeNull();
  });
});

describe('collectKeys', () => {
  it('gộp khoá đính kèm + avatar (user/workspace/project) + system-settings, bỏ trùng/null', () => {
    const keys = collectKeys({
      attachmentKeys: ['w1/a-x.txt', 'w1/a-x.txt', 'w1/b-y.png'],
      avatarUrls: [
        'https://h/api/v1/media/avatars/user-1.png',
        'https://dicebear/x.svg',
        null,
        'https://h/api/v1/media/avatars/user-1.png',
      ],
    });
    expect(keys.sort()).toEqual(
      ['avatars/user-1.png', 'system-settings.json', 'w1/a-x.txt', 'w1/b-y.png'].sort(),
    );
  });
});

describe('migrateObjects', () => {
  let src: MemoryStorage;
  let dst: MemoryStorage;
  const fresh = () => {
    src = new MemoryStorage();
    dst = new MemoryStorage();
  };
  afterEach(fresh);
  fresh();

  it('chép tệp thiếu, giữ nội dung + contentType theo đuôi, không xoá nguồn', async () => {
    await put(src, 'w1/a.png', 'PNGDATA');
    await put(src, 'avatars/u.jpg', 'JPG');
    const r = await migrateObjects({
      source: src,
      dest: dst,
      keys: ['w1/a.png', 'avatars/u.jpg'],
      dryRun: false,
    });
    expect(r).toMatchObject({ copied: 2, skipped: 0, missing: 0, failed: 0 });
    expect(dst.files.get('w1/a.png')?.body.toString()).toBe('PNGDATA');
    expect(dst.files.get('w1/a.png')?.contentType).toBe('image/png');
    expect(dst.files.get('avatars/u.jpg')?.contentType).toBe('image/jpeg');
    expect(src.files.size).toBe(2);
  });

  it('idempotent: chạy lần hai bỏ qua object đã có cùng kích thước', async () => {
    await put(src, 'w1/a.txt', 'abc');
    await migrateObjects({ source: src, dest: dst, keys: ['w1/a.txt'], dryRun: false });
    const again = await migrateObjects({
      source: src,
      dest: dst,
      keys: ['w1/a.txt'],
      dryRun: false,
    });
    expect(again).toMatchObject({ copied: 0, skipped: 1 });
  });

  it('khác kích thước → chép đè (bản dở dang / đã sửa)', async () => {
    await put(src, 'w1/a.txt', 'abcdef');
    await put(dst, 'w1/a.txt', 'abc');
    const r = await migrateObjects({ source: src, dest: dst, keys: ['w1/a.txt'], dryRun: false });
    expect(r.copied).toBe(1);
    expect(dst.files.get('w1/a.txt')?.body.toString()).toBe('abcdef');
  });

  it('dry-run: chỉ đếm, KHÔNG ghi', async () => {
    await put(src, 'w1/a.txt', 'abc');
    const r = await migrateObjects({ source: src, dest: dst, keys: ['w1/a.txt'], dryRun: true });
    expect(r).toMatchObject({ copied: 1, dryRun: true });
    expect(dst.files.size).toBe(0);
  });

  it('khoá được DB tham chiếu nhưng thiếu trên đĩa → "missing" (không phải lỗi dừng)', async () => {
    const r = await migrateObjects({ source: src, dest: dst, keys: ['w1/mat.txt'], dryRun: false });
    expect(r).toMatchObject({ copied: 0, missing: 1, failed: 0 });
    expect(r.missingKeys).toEqual(['w1/mat.txt']);
  });

  it('một tệp lỗi không dừng cả mẻ; báo số lỗi + khoá lỗi', async () => {
    await put(src, 'a.txt', '1');
    await put(src, 'b.txt', '2');
    dst.failNext.put = new StorageUnavailableError('x');
    const r = await migrateObjects({
      source: src,
      dest: dst,
      keys: ['a.txt', 'b.txt'],
      dryRun: false,
    });
    expect(r).toMatchObject({ copied: 1, failed: 1 });
    expect(r.failedKeys).toHaveLength(1);
  });

  it('khoá không an toàn → tính là lỗi, không đọc ngoài thư mục gốc', async () => {
    const r = await migrateObjects({
      source: src,
      dest: dst,
      keys: ['../../etc/passwd'],
      dryRun: false,
    });
    expect(r).toMatchObject({ failed: 1, copied: 0 });
  });
});
