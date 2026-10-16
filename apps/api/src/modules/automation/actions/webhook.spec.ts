import { createHmac } from 'node:crypto';
import { createServer, type IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isPrivateAddress, pinnedLookup, resolveSafeTarget, runWebhook } from './webhook';

// Kết quả KHÔNG được phụ thuộc môi trường chạy: `.env` ở máy dev/CI có thể đặt AUTOMATION_WEBHOOK_ALLOW_PRIVATE=true (cho phép
// địa chỉ nội bộ) làm các ca "chặn SSRF" đỏ. Luôn bắt đầu từ trạng thái chặn; ca cần cho phép tự stub 'true'. Hoàn nguyên sau mỗi ca.
beforeEach(() => vi.stubEnv('AUTOMATION_WEBHOOK_ALLOW_PRIVATE', 'false'));
afterEach(() => vi.unstubAllEnvs());

/** Lấy hostname đúng như code thật thấy sau khi URL chuẩn hoá (127.1, 0x7f000001, [::ffff:…] đều bị đổi dạng). */
const hostOf = (u: string) => new URL(u).hostname;

describe('isPrivateAddress', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '192.168.0.5',
    '172.20.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '192.0.0.8',
    '198.18.0.1',
    '224.0.0.1',
    '240.0.0.1',
    '255.255.255.255',
    '::',
    '::1',
    'fd00::1',
    'fc00::1',
    'fe80::1',
    'fec0::1',
    '64:ff9b::7f00:1',
    'ff02::1',
    '::7f00:1',
    '::ffff:10.0.0.1',
    '::ffff:7f00:1',
    '::ffff:a9fe:a9fe',
    '::ffff:a00:1',
    '2002:7f00:1::1',
    '2002:a9fe:a9fe::',
    '2001:0:4136:e378:8000:63bf:3fff:fdd2',
    '2001::1',
  ])('%s là nội bộ/đặc biệt', (ip) => {
    expect(isPrivateAddress(ip)).toBe(true);
  });

  it.each([
    '8.8.8.8',
    '1.1.1.1',
    '172.32.0.1',
    '100.128.0.1',
    '2606:4700::1111',
    '2001:4860:4860::8888',
    '::ffff:8.8.8.8',
    '::ffff:808:808',
  ])('%s là công khai', (ip) => {
    expect(isPrivateAddress(ip)).toBe(false);
  });

  it('chuỗi không phải IP bị coi là chặn', () => {
    expect(isPrivateAddress('không phải ip')).toBe(true);
  });

  it.each([
    'http://[::ffff:127.0.0.1]/',
    'http://[::ffff:169.254.169.254]/',
    'http://[::ffff:10.0.0.1]/',
    'http://127.1/',
    'http://0x7f000001/',
    'http://2130706433/',
    'http://[::1]/',
    'http://[::ffff:c0a8:1]/',
  ])('URL %s sau chuẩn hoá vẫn bị chặn', (u) => {
    expect(isPrivateAddress(hostOf(u))).toBe(true);
  });
});

describe('resolveSafeTarget', () => {
  it.each([
    'http://localhost/',
    'http://127.1/',
    'http://0x7f000001/',
    'http://2130706433/',
    'http://[::ffff:127.0.0.1]/',
    'http://[::ffff:169.254.169.254]/',
    'http://[::ffff:10.0.0.1]/',
    'http://10.0.0.1:8080/x',
  ])('chặn %s', async (u) => {
    await expect(resolveSafeTarget(u)).rejects.toMatchObject({ code: 'BUSINESS_RULE_VIOLATION' });
  });

  it('chặn URL chứa user:pass và giao thức lạ', async () => {
    await expect(resolveSafeTarget('http://user:pw@8.8.8.8/')).rejects.toMatchObject({
      code: 'BUSINESS_RULE_VIOLATION',
    });
    await expect(resolveSafeTarget('ftp://8.8.8.8/')).rejects.toMatchObject({
      code: 'BUSINESS_RULE_VIOLATION',
    });
    await expect(resolveSafeTarget('không phải url')).rejects.toMatchObject({
      code: 'BUSINESS_RULE_VIOLATION',
    });
  });

  it('IP công khai được chấp nhận và trả đúng địa chỉ để ghim', async () => {
    const t = await resolveSafeTarget('https://8.8.8.8/hook');
    expect(t).toMatchObject({
      address: '8.8.8.8',
      family: 4,
      addresses: [{ address: '8.8.8.8', family: 4 }],
    });
  });

  it('cho phép nội bộ khi bật AUTOMATION_WEBHOOK_ALLOW_PRIVATE (dev/CI)', async () => {
    vi.stubEnv('AUTOMATION_WEBHOOK_ALLOW_PRIVATE', 'true');
    try {
      expect((await resolveSafeTarget('http://127.0.0.1:9/')).address).toBe('127.0.0.1');
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe('pinnedLookup — chống DNS rebinding', () => {
  const list = [
    { address: '8.8.8.8', family: 4 as const },
    { address: '2606:4700::1111', family: 6 as const },
  ];
  it('all:true trả cả danh sách đã kiểm, bất kể tên miền; all:false trả phần tử đầu', () => {
    const lookup = pinnedLookup(list);
    const all = vi.fn();
    lookup('evil.example', { all: true }, all);
    expect(all).toHaveBeenCalledWith(null, list);
    const one = vi.fn();
    lookup('evil.example', {}, one);
    expect(one).toHaveBeenCalledWith(null, '8.8.8.8', 4);
  });
});

describe('runWebhook — kết nối thật tới máy chủ cục bộ (bật ALLOW_PRIVATE)', () => {
  const ctx = {
    dryRun: false,
    trigger: 'ISSUE_CREATED',
    rule: { id: 'r1', name: 'R' },
    deps: {
      openSecret: (s: string) =>
        s.startsWith('enc:v1:') ? s.slice(7).split('').reverse().join('') : s,
    },
    issue: {
      id: 'i1',
      key: 'P-1',
      summary: 's',
      projectId: 'p1',
      status: { name: 'Todo' },
      priority: null,
      assigneeId: null,
    },
  } as never;

  async function withServer(
    status: number,
    fn: (url: string, seen: { headers?: IncomingHttpHeaders; body?: string }) => Promise<void>,
  ) {
    const seen: { headers?: IncomingHttpHeaders; body?: string } = {};
    const server = createServer((req, res) => {
      let body = '';
      req.on('data', (c: Buffer) => (body += c.toString()));
      req.on('end', () => {
        seen.headers = req.headers;
        seen.body = body;
        res.writeHead(
          status,
          status >= 300 && status < 400 ? { Location: 'http://127.0.0.1:1/' } : {},
        );
        res.end('ok');
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    vi.stubEnv('AUTOMATION_WEBHOOK_ALLOW_PRIVATE', 'true');
    try {
      await fn(`http://127.0.0.1:${(server.address() as AddressInfo).port}/hook`, seen);
    } finally {
      vi.unstubAllEnvs();
      await new Promise((r) => server.close(r));
    }
  }

  it('gửi POST có chữ ký HMAC đúng', async () => {
    await withServer(200, async (url, seen) => {
      await expect(runWebhook(ctx, { type: 'webhook', url, secret: 'k' })).resolves.toMatch(
        /HTTP 200/,
      );
      const expected = `sha256=${createHmac('sha256', 'k')
        .update(seen.body ?? '')
        .digest('hex')}`;
      expect(seen.headers?.['x-tirapro-signature']).toBe(expected);
    });
  });

  it('3xx bị coi là lỗi, không theo chuyển hướng', async () => {
    await withServer(302, async (url) => {
      await expect(runWebhook(ctx, { type: 'webhook', url })).rejects.toThrow(/chuyển hướng/);
    });
  });

  it('HTTP 500 là lỗi', async () => {
    await withServer(500, async (url) => {
      await expect(runWebhook(ctx, { type: 'webhook', url })).rejects.toThrow(/HTTP 500/);
    });
  });

  it('secret đã mã hoá được giải mã trước khi ký HMAC', async () => {
    await withServer(200, async (url, seen) => {
      await runWebhook(ctx, { type: 'webhook', url, secret: 'enc:v1:k' }); // openSecret giả: đảo chuỗi -> 'k'
      const expected = `sha256=${createHmac('sha256', 'k')
        .update(seen.body ?? '')
        .digest('hex')}`;
      expect(seen.headers?.['x-tirapro-signature']).toBe(expected);
    });
  });

  it('secret không giải mã được => lỗi rõ ràng, KHÔNG gửi request', async () => {
    const bad = { ...(ctx as object), deps: { openSecret: () => null } } as never;
    await withServer(200, async (url, seen) => {
      await expect(runWebhook(bad, { type: 'webhook', url, secret: 'enc:v1:xx' })).rejects.toThrow(
        /không giải mã được/,
      );
      expect(seen.body).toBeUndefined();
    });
  });
});
