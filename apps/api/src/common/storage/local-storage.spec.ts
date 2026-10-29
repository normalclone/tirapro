import { mkdtempSync, readFileSync, existsSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { LocalStorage } from './local-storage';
import { runObjectStorageContract } from './object-storage.contract.testutil';

const root = mkdtempSync(join(tmpdir(), 'tirapro-local-storage-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

runObjectStorageContract('LocalStorage', () => {
  const dir = mkdtempSync(join(root, 'c-'));
  return Promise.resolve({
    storage: new LocalStorage(dir),
    cleanup: () => Promise.resolve(),
  });
});

describe('LocalStorage — giữ nguyên đường dẫn/khoá như trước khi có lớp lưu trữ', () => {
  it('khoá `ws/id-file.png` nằm đúng ở {localDir}/ws/id-file.png (tự tạo thư mục con)', async () => {
    const dir = mkdtempSync(join(root, 'l-'));
    const s = new LocalStorage(dir);
    await s.put('ws1/abc-file.png', Buffer.from('PNG'));
    expect(readFileSync(join(dir, 'ws1', 'abc-file.png'), 'utf8')).toBe('PNG');
    await s.put('avatars/user-1.png', Buffer.from('A'));
    expect(existsSync(join(dir, 'avatars', 'user-1.png'))).toBe(true);
    await s.put('system-settings.json', Buffer.from('{}'));
    expect(existsSync(join(dir, 'system-settings.json'))).toBe(true);
  });

  it('stat trả mtime thật của tệp (Jira import dựa vào đây để hết hạn)', async () => {
    const dir = mkdtempSync(join(root, 'm-'));
    const s = new LocalStorage(dir);
    await s.put('imports/x.csv', Buffer.from('a'));
    const past = new Date(Date.now() - 3 * 3_600_000);
    utimesSync(join(dir, 'imports', 'x.csv'), past, past);
    const st = await s.stat('imports/x.csv');
    expect(Math.abs((st?.lastModified.getTime() ?? 0) - past.getTime())).toBeLessThan(2000);
  });

  it('list thư mục chưa tồn tại → mảng rỗng (không lỗi)', async () => {
    const s = new LocalStorage(mkdtempSync(join(root, 'e-')));
    expect(await s.list('imports/')).toEqual([]);
  });

  it('driver = local', () => {
    expect(new LocalStorage(root).driver).toBe('local');
  });
});
