import { createHmac } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { Agent, fetch } from 'undici';
import type { RuleAction } from '@tirapro/shared';
import { BusinessRuleException } from '../../../common/exceptions/app.exception';
import type { ActionContext, ActionResult } from './types';

const TIMEOUT_MS = 5000;

/** Dải địa chỉ đặc biệt (nội bộ, loopback, link-local, multicast, dự phòng…) — webhook không được trỏ vào đây (SSRF). */
const BLOCKED = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const)
  BLOCKED.addSubnet(net, prefix, 'ipv4');
for (const [net, prefix] of [
  ['::', 96], // gồm :: và ::1 và dạng IPv4-compatible (::a.b.c.d)
  ['fc00::', 7],
  ['fe80::', 10],
  ['fec0::', 10],
  ['64:ff9b::', 96],
  ['2002::', 16], // 6to4 và Teredo nhúng IPv4 tuỳ ý
  ['2001::', 32],
  ['ff00::', 8],
] as const)
  BLOCKED.addSubnet(net, prefix, 'ipv6');

/** `::ffff:a.b.c.d` hoặc `::ffff:7f00:1` (dạng URL chuẩn hoá) → IPv4 dạng chấm; không phải dạng mapped thì null. */
function mappedIPv4(ip: string): string | null {
  const dotted = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
  if (dotted) return dotted[1]!;
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(ip);
  if (!hex) return null;
  const hi = parseInt(hex[1]!, 16);
  const lo = parseInt(hex[2]!, 16);
  return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
}

/** Địa chỉ IP (v4/v6, kể cả IPv4-mapped IPv6) có nằm trong dải bị chặn không. Không phải IP hợp lệ → coi là bị chặn. */
export function isPrivateAddress(ip: string): boolean {
  const bare = ip.replace(/^\[|\]$/g, '');
  const mapped = mappedIPv4(bare);
  const addr = mapped ?? bare;
  const family = isIP(addr);
  if (family === 0) return true;
  return BLOCKED.check(addr, family === 4 ? 'ipv4' : 'ipv6');
}

export interface SafeTarget {
  url: URL;
  address: string;
  family: 4 | 6;
  /** Mọi địa chỉ đã kiểm (theo thứ tự phân giải) — dispatcher ghim cả danh sách để thử lần lượt. */
  addresses: Array<{ address: string; family: 4 | 6 }>;
}

/** Chờ `p` nhưng bỏ ngay (reject) khi `signal` abort — `dns.lookup` không huỷ được nên lệnh treo vẫn chạy nền. */
function raceAbort<T>(
  p: Promise<T>,
  signal: AbortSignal | undefined,
  onAbort: () => Error,
): Promise<T> {
  if (!signal) return p;
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) return reject(onAbort());
    const h = () => reject(onAbort());
    signal.addEventListener('abort', h, { once: true });
    p.then(resolve, reject).finally(() => signal.removeEventListener('abort', h));
  });
}

/**
 * Phân giải tên miền MỘT lần, kiểm TOÀN BỘ địa chỉ trả về, rồi trả địa chỉ đã kiểm để kết nối đúng IP đó
 * (chống DNS rebinding: không phân giải lần hai giữa lúc kiểm và lúc kết nối). Không cho kèm user:pass trong URL.
 */
export async function resolveSafeTarget(raw: string, signal?: AbortSignal): Promise<SafeTarget> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new BusinessRuleException('Địa chỉ webhook không hợp lệ');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:')
    throw new BusinessRuleException('Webhook chỉ hỗ trợ http hoặc https');
  if (url.username || url.password)
    throw new BusinessRuleException(
      'Địa chỉ webhook không được chứa tên đăng nhập/mật khẩu — hãy dùng khoá bí mật',
    );
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const found = isIP(host)
    ? [{ address: host, family: isIP(host) }]
    : await raceAbort(
        lookup(host, { all: true }).catch(() => []),
        signal,
        () =>
          new BusinessRuleException(
            'Không phân giải được địa chỉ webhook trong thời gian cho phép — hãy kiểm tra lại tên miền',
          ),
      );
  if (!found.length)
    throw new BusinessRuleException(
      'Không phân giải được địa chỉ webhook — hãy kiểm tra lại tên miền',
    );
  // Dev/CI có thể cho phép địa chỉ nội bộ; vẫn ghim IP đã phân giải.
  const allowPrivate = process.env.AUTOMATION_WEBHOOK_ALLOW_PRIVATE === 'true';
  if (!allowPrivate && found.some((r) => isPrivateAddress(r.address))) {
    throw new BusinessRuleException(
      'Địa chỉ webhook trỏ vào mạng nội bộ nên bị chặn — hãy dùng địa chỉ công khai',
    );
  }
  const addresses = found.map((r) => ({
    address: r.address,
    family: r.family === 6 ? (6 as const) : (4 as const),
  }));
  return { url, address: addresses[0]!.address, family: addresses[0]!.family, addresses };
}

/**
 * Hàm `lookup` cho undici: chỉ trả các địa chỉ đã kiểm (xử lý cả kiểu gọi `all: true` — undici/Node dùng để
 * thử lần lượt khi `autoSelectFamily`; `all: false` trả phần tử đầu).
 */
export function pinnedLookup(addresses: ReadonlyArray<{ address: string; family: 4 | 6 }>) {
  return (
    _hostname: string,
    options: { all?: boolean },
    cb: (
      err: Error | null,
      address: string | Array<{ address: string; family: number }>,
      family?: number,
    ) => void,
  ): void => {
    if (options?.all)
      cb(
        null,
        addresses.map((a) => ({ ...a })),
      );
    else cb(null, addresses[0]!.address, addresses[0]!.family);
  };
}

/**
 * POST JSON tới URL, timeout 5 giây, không thử lại. Có `secret` thì ký HMAC-SHA256 phần body vào
 * header `X-Tirapro-Signature: sha256=<hex>`. Không theo redirect (tránh nhảy vào địa chỉ nội bộ).
 * Lỗi chỉ được ghi vào AutomationRun, không ảnh hưởng thao tác gốc.
 */
export async function runWebhook(
  ctx: ActionContext,
  a: Extract<RuleAction, { type: 'webhook' }>,
): Promise<ActionResult> {
  // Một đồng hồ 5 giây bao cả phân giải DNS lẫn kết nối/phản hồi.
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  let dispatcher: Agent | undefined;
  try {
    const { url, addresses } = await resolveSafeTarget(a.url, ac.signal);
    if (ctx.dryRun) return `Sẽ gọi webhook ${url.origin}${url.pathname}`;
    const secret = a.secret ? ctx.deps.openSecret(a.secret) : undefined;
    if (a.secret && secret == null)
      throw new BusinessRuleException(
        'Khoá bí mật của webhook không giải mã được — hãy nhập lại khoá trong quy tắc',
      );
    const body = JSON.stringify({
      event: ctx.trigger,
      rule: { id: ctx.rule.id, name: ctx.rule.name },
      issue: {
        id: ctx.issue.id,
        key: ctx.issue.key,
        summary: ctx.issue.summary,
        projectId: ctx.issue.projectId,
        status: ctx.issue.status.name,
        priority: ctx.issue.priority?.name ?? null,
        assigneeId: ctx.issue.assigneeId,
      },
      sentAt: new Date().toISOString(),
    });
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': 'Tirapro-Automation/1.0',
    };
    if (secret)
      headers['X-Tirapro-Signature'] =
        `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;

    // Kết nối thẳng tới các IP đã kiểm (thử lần lượt); TLS/SNI vẫn dùng tên miền trong URL.
    dispatcher = new Agent({
      connect: { lookup: pinnedLookup(addresses), autoSelectFamily: true },
    });
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body,
      signal: ac.signal,
      redirect: 'manual',
      dispatcher,
    });
    await res.body?.cancel().catch(() => undefined);
    if (res.status >= 300 && res.status < 400)
      throw new BusinessRuleException(
        `Webhook trả về chuyển hướng (HTTP ${res.status}) — không theo chuyển hướng, hãy dùng địa chỉ cuối cùng`,
      );
    if (!res.ok) throw new BusinessRuleException(`Webhook trả về HTTP ${res.status}`);
    return `Đã gọi webhook (HTTP ${res.status})`;
  } catch (e) {
    if (e instanceof BusinessRuleException) throw e;
    const aborted = (e as Error).name === 'AbortError';
    throw new BusinessRuleException(
      aborted
        ? `Webhook không phản hồi trong ${TIMEOUT_MS / 1000} giây`
        : `Không gọi được webhook: ${(e as Error).message}`,
    );
  } finally {
    clearTimeout(timer);
    await dispatcher?.close().catch(() => undefined);
  }
}
