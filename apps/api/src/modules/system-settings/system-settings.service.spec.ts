import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryStorage } from '../../common/storage/memory-storage.testutil';
import { StorageUnavailableError } from '../../common/storage/object-storage';
import { SystemSettingsService } from './system-settings.service';

const KEY = 'system-settings.json';
const saved = (s: MemoryStorage): unknown =>
  JSON.parse(s.files.get(KEY)?.body.toString() ?? 'null');

describe('SystemSettingsService — cờ lưu qua ObjectStorage (khoá `system-settings.json`)', () => {
  beforeEach(() => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('thiếu tệp = bình thường → mặc định, coi như đã nạp', async () => {
    const svc = new SystemSettingsService(new MemoryStorage());
    await svc.onModuleInit();
    expect(svc.flags().signupEnabled).toBe(true);
    expect(svc.isLoaded()).toBe(true);
  });

  it('nạp cờ đã lưu; setFlags ghi xuyên; instance mới đọc lại được', async () => {
    const storage = new MemoryStorage();
    await storage.put(KEY, Buffer.from(JSON.stringify({ signupEnabled: false })));
    const a = new SystemSettingsService(storage);
    await a.onModuleInit();
    expect(a.flags().signupEnabled).toBe(false);
    await a.setFlags({ maintenanceBanner: 'Bảo trì 22h', aiKillSwitch: true });
    expect(saved(storage)).toMatchObject({
      signupEnabled: false,
      maintenanceBanner: 'Bảo trì 22h',
      aiKillSwitch: true,
    });
    const b = new SystemSettingsService(storage);
    await b.onModuleInit();
    expect(b.flags().aiKillSwitch).toBe(true);
  });

  describe('I1 — khởi động khi kho lưu trữ chết', () => {
    const REAL = {
      signupEnabled: false,
      aiKillSwitch: true,
      integrationsEnabled: false,
      maintenanceBanner: 'thật',
    };

    it('đọc LỖI (không phải thiếu tệp): chưa nạp, đóng đăng ký (mặc định an toàn), KHÔNG coi là mặc định bình thường', async () => {
      const storage = new MemoryStorage();
      await storage.put(KEY, Buffer.from(JSON.stringify(REAL)));
      storage.failNext.get = new StorageUnavailableError('x');
      const svc = new SystemSettingsService(storage);
      await svc.onModuleInit();
      expect(svc.isLoaded()).toBe(false);
      expect(svc.flags().signupEnabled).toBe(false);
      svc.onModuleDestroy();
    });

    it('setFlags khi chưa nạp được: TỪ CHỐI với lỗi rõ và KHÔNG ghi đè tệp thật', async () => {
      const storage = new MemoryStorage();
      await storage.put(KEY, Buffer.from(JSON.stringify(REAL)));
      storage.failNext.get = new StorageUnavailableError('x');
      const svc = new SystemSettingsService(storage);
      await svc.onModuleInit();
      // lần đọc lại trong setFlags cũng lỗi (kho vẫn chết)
      storage.failNext.get = new StorageUnavailableError('x');
      await expect(svc.setFlags({ signupEnabled: true })).rejects.toThrow(
        /chưa đọc được cờ hệ thống/i,
      );
      expect(saved(storage)).toEqual(REAL); // tệp thật còn nguyên
      svc.onModuleDestroy();
    });

    it('setFlags khi chưa nạp nhưng kho đã sống lại: đọc lại TRƯỚC khi ghi, giữ cờ thật + áp patch', async () => {
      const storage = new MemoryStorage();
      await storage.put(KEY, Buffer.from(JSON.stringify(REAL)));
      storage.failNext.get = new StorageUnavailableError('x');
      const svc = new SystemSettingsService(storage);
      await svc.onModuleInit();
      const next = await svc.setFlags({ maintenanceBanner: 'mới' });
      expect(next).toMatchObject({ ...REAL, maintenanceBanner: 'mới' });
      expect(saved(storage)).toMatchObject({ ...REAL, maintenanceBanner: 'mới' });
      svc.onModuleDestroy();
    });

    it('phục hồi: tự đọc lại có backoff (2s, 4s, …) và khi kho sống lại thì nạp cờ thật', async () => {
      const storage = new MemoryStorage();
      await storage.put(KEY, Buffer.from(JSON.stringify(REAL)));
      const get = vi.spyOn(storage, 'get');
      get.mockRejectedValueOnce(new StorageUnavailableError('x')); // khởi động
      get.mockRejectedValueOnce(new StorageUnavailableError('x')); // thử lại lần 1
      const svc = new SystemSettingsService(storage);
      await svc.onModuleInit();
      expect(svc.isLoaded()).toBe(false);
      await vi.advanceTimersByTimeAsync(2_000);
      expect(get).toHaveBeenCalledTimes(2);
      expect(svc.isLoaded()).toBe(false);
      await vi.advanceTimersByTimeAsync(3_999);
      expect(get).toHaveBeenCalledTimes(2); // chưa tới 4s
      await vi.advanceTimersByTimeAsync(1);
      expect(get).toHaveBeenCalledTimes(3);
      expect(svc.isLoaded()).toBe(true);
      expect(svc.flags()).toMatchObject(REAL);
      expect(vi.getTimerCount()).toBe(0);
    });

    it('backoff có trần 30 giây', async () => {
      const storage = new MemoryStorage();
      const get = vi.spyOn(storage, 'get').mockRejectedValue(new StorageUnavailableError('x'));
      const svc = new SystemSettingsService(storage);
      await svc.onModuleInit();
      await vi.advanceTimersByTimeAsync(2_000 + 4_000 + 8_000 + 16_000);
      const n = get.mock.calls.length;
      await vi.advanceTimersByTimeAsync(30_000);
      expect(get.mock.calls.length).toBe(n + 1);
      await vi.advanceTimersByTimeAsync(30_000);
      expect(get.mock.calls.length).toBe(n + 2);
      svc.onModuleDestroy();
      expect(vi.getTimerCount()).toBe(0);
    });
  });

  it('setFlags BÁO LỖI khi ghi lỗi (không báo thành công giả), cờ không đổi', async () => {
    const storage = new MemoryStorage();
    const svc = new SystemSettingsService(storage);
    await svc.onModuleInit();
    storage.failNext.put = new StorageUnavailableError('x');
    await expect(svc.setFlags({ signupEnabled: false })).rejects.toThrow(
      /Không lưu được cờ hệ thống/,
    );
    expect(svc.flags().signupEnabled).toBe(true);
    expect(storage.files.has(KEY)).toBe(false);
  });
});
