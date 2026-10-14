import { createHmac } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import type { RuleAction } from '@tirapro/shared';
import { BusinessRuleException } from '../../../common/exceptions/app.exception';
import type { ActionContext, ActionResult } from './types';

const TIMEOUT_MS = 5000;

/** Địa chỉ nội bộ/loopback/link-local — chặn để webhook không bị lợi dụng quét mạng nội bộ (SSRF). */
export function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number) as [number, number];
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  const v6 = ip.toLowerCase();
  if (v6.startsWith('::ffff:')) return isPrivateAddress(v6.slice(7));
  return v6 === '::' || v6 === '::1' || v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe8') || v6.startsWith('fe9') || v6.startsWith('fea') || v6.startsWith('feb');
}

async function assertPublicUrl(raw: string): Promise<URL> {
  const url = new URL(raw);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new BusinessRuleException('Webhook chỉ hỗ trợ http hoặc https');
  if (process.env.AUTOMATION_WEBHOOK_ALLOW_PRIVATE === 'true') return url; // chỉ để dev/CI
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addrs = isIP(host) ? [host] : (await lookup(host, { all: true })).map((r) => r.address);
  if (!addrs.length || addrs.some(isPrivateAddress)) {
    throw new BusinessRuleException('Địa chỉ webhook trỏ vào mạng nội bộ nên bị chặn — hãy dùng địa chỉ công khai');
  }
  return url;
}

/**
 * POST JSON tới URL, timeout 5 giây, không thử lại. Có `secret` thì ký HMAC-SHA256 phần body vào
 * header `X-Tirapro-Signature: sha256=<hex>`. Không theo redirect (tránh nhảy vào địa chỉ nội bộ).
 * Lỗi chỉ được ghi vào AutomationRun, không ảnh hưởng thao tác gốc.
 */
export async function runWebhook(ctx: ActionContext, a: Extract<RuleAction, { type: 'webhook' }>): Promise<ActionResult> {
  const url = await assertPublicUrl(a.url);
  if (ctx.dryRun) return `Sẽ gọi webhook ${url.origin}${url.pathname}`;
  const body = JSON.stringify({
    event: ctx.trigger,
    rule: { id: ctx.rule.id, name: ctx.rule.name },
    issue: {
      id: ctx.issue.id, key: ctx.issue.key, summary: ctx.issue.summary, projectId: ctx.issue.projectId,
      status: ctx.issue.status.name, priority: ctx.issue.priority?.name ?? null, assigneeId: ctx.issue.assigneeId,
    },
    sentAt: new Date().toISOString(),
  });
  const headers: Record<string, string> = { 'Content-Type': 'application/json', 'User-Agent': 'Tirapro-Automation/1.0' };
  if (a.secret) headers['X-Tirapro-Signature'] = `sha256=${createHmac('sha256', a.secret).update(body).digest('hex')}`;

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { method: 'POST', headers, body, signal: ac.signal, redirect: 'manual' });
    if (!res.ok) throw new BusinessRuleException(`Webhook trả về HTTP ${res.status}`);
    return `Đã gọi webhook (HTTP ${res.status})`;
  } catch (e) {
    if (e instanceof BusinessRuleException) throw e;
    const aborted = (e as Error).name === 'AbortError';
    throw new BusinessRuleException(aborted ? `Webhook không phản hồi trong ${TIMEOUT_MS / 1000} giây` : `Không gọi được webhook: ${(e as Error).message}`);
  } finally {
    clearTimeout(timer);
  }
}
