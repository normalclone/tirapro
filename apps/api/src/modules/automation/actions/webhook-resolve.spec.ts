import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const lookup = vi.hoisted(() => vi.fn<(...a: unknown[]) => Promise<unknown>>());
vi.mock('node:dns/promises', () => ({ lookup: (...a: unknown[]) => lookup(...a) }));
import { resolveSafeTarget, runWebhook } from './webhook';

// Kết quả KHÔNG được phụ thuộc môi trường chạy: `.env` ở máy dev/CI có thể đặt AUTOMATION_WEBHOOK_ALLOW_PRIVATE=true (cho phép
// địa chỉ nội bộ) làm các ca "chặn SSRF" đỏ. Luôn bắt đầu từ trạng thái chặn; ca cần cho phép tự stub 'true'. Hoàn nguyên sau mỗi ca.
beforeEach(() => vi.stubEnv('AUTOMATION_WEBHOOK_ALLOW_PRIVATE', 'false'));
afterEach(() => vi.unstubAllEnvs());

beforeEach(() => {
  // Dùng khối lệnh: nếu trả mock về, vitest coi nó là hàm dọn dẹp và gọi lại (lookup treo => hook treo).
  lookup.mockReset();
});

describe('resolveSafeTarget — tên miền', () => {
  it('ghim TẤT CẢ địa chỉ công khai, giữ thứ tự', async () => {
    lookup.mockResolvedValue([
      { address: '2606:4700::1111', family: 6 },
      { address: '8.8.8.8', family: 4 },
    ]);
    const t = await resolveSafeTarget('https://hook.example.com/x');
    expect(t.addresses).toEqual([
      { address: '2606:4700::1111', family: 6 },
      { address: '8.8.8.8', family: 4 },
    ]);
    expect(t).toMatchObject({ address: '2606:4700::1111', family: 6 });
  });

  it('một trong các địa chỉ là nội bộ => từ chối cả tên miền', async () => {
    lookup.mockResolvedValue([
      { address: '8.8.8.8', family: 4 },
      { address: '10.0.0.5', family: 4 },
    ]);
    await expect(resolveSafeTarget('https://mixed.example.com/')).rejects.toMatchObject({
      code: 'BUSINESS_RULE_VIOLATION',
    });
  });

  it('địa chỉ 6to4 nhúng IPv4 nội bộ bị chặn', async () => {
    lookup.mockResolvedValue([{ address: '2002:7f00:1::1', family: 6 }]);
    await expect(resolveSafeTarget('https://sixtofour.example.com/')).rejects.toMatchObject({
      code: 'BUSINESS_RULE_VIOLATION',
    });
  });

  it('DNS không bao giờ trả lời => bị cắt khi signal abort, báo lỗi phân giải', async () => {
    lookup.mockReturnValue(new Promise(() => undefined));
    const ac = new AbortController();
    const p = resolveSafeTarget('https://slow.example.com/', ac.signal);
    ac.abort();
    await expect(p).rejects.toMatchObject({ code: 'BUSINESS_RULE_VIOLATION' });
    await expect(p).rejects.toThrow(/phân giải/);
  });
});

describe('runWebhook — timeout bao cả DNS', () => {
  it('DNS treo => lỗi trong ~5s (dùng fake timers), không treo vô hạn', async () => {
    vi.useFakeTimers();
    try {
      lookup.mockReturnValue(new Promise(() => undefined));
      const ctx = {
        dryRun: false,
        trigger: 'ISSUE_CREATED',
        rule: { id: 'r', name: 'R' },
        deps: { openSecret: (s: string) => s },
        issue: {},
      } as never;
      const p = runWebhook(ctx, { type: 'webhook', url: 'https://slow.example.com/hook' });
      const assertion = expect(p).rejects.toThrow(/5 giây|phân giải/);
      await vi.advanceTimersByTimeAsync(5001);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });
});
