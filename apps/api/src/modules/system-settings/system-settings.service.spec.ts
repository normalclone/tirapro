import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryStorage } from '../../common/storage/memory-storage.testutil';
import { StorageUnavailableError } from '../../common/storage/object-storage';
import { SystemSettingsService } from './system-settings.service';

describe('SystemSettingsService — cờ lưu qua ObjectStorage (khoá `system-settings.json`)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('onModuleInit nạp cờ đã lưu; thiếu tệp → mặc định', async () => {
    const storage = new MemoryStorage();
    const empty = new SystemSettingsService(storage);
    await empty.onModuleInit();
    expect(empty.flags().signupEnabled).toBe(true);

    await storage.put(
      'system-settings.json',
      Buffer.from(JSON.stringify({ signupEnabled: false })),
    );
    const svc = new SystemSettingsService(storage);
    await svc.onModuleInit();
    expect(svc.flags().signupEnabled).toBe(false);
    expect(svc.flags().integrationsEnabled).toBe(true);
  });

  it('setFlags ghi xuyên vào storage; instance mới đọc lại được', async () => {
    const storage = new MemoryStorage();
    const a = new SystemSettingsService(storage);
    await a.setFlags({ maintenanceBanner: 'Bảo trì 22h', aiKillSwitch: true });
    expect(
      JSON.parse(storage.files.get('system-settings.json')?.body.toString() ?? '{}'),
    ).toMatchObject({
      maintenanceBanner: 'Bảo trì 22h',
      aiKillSwitch: true,
    });
    const b = new SystemSettingsService(storage);
    await b.onModuleInit();
    expect(b.flags().aiKillSwitch).toBe(true);
  });

  it('ghi lỗi → log cảnh báo, cờ trong bộ nhớ vẫn đổi (degrade như cũ)', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const storage = new MemoryStorage();
    storage.failNext.put = new StorageUnavailableError('x');
    const svc = new SystemSettingsService(storage);
    const next = await svc.setFlags({ signupEnabled: false });
    expect(next.signupEnabled).toBe(false);
    expect(warn).toHaveBeenCalled();
  });
});
