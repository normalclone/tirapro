import { QueryClient, MutationObserver } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import {
  EMAIL_KEY_OF_TYPE,
  applyPrefsPatch,
  isOptionsOpen,
  prefsMutationOptions,
  revertPrefsPatch,
  type PrefsPatch,
} from './notificationPrefs';
import type { NotificationPrefsResponse } from './api';
import { keys } from '@/lib/queryKeys';

const base = (): NotificationPrefsResponse => ({
  preferences: { MENTIONED: true, COMMENT_ADDED: false },
  defaults: {},
  email: { mention: false, assigned: false, comment: false, transition: false },
  emailDefaults: { mention: false, assigned: false, comment: false, transition: false },
});

describe('applyPrefsPatch / revertPrefsPatch (thuần)', () => {
  it('áp bản vá in-app và email, không đụng khoá khác, không đổi dữ liệu gốc', () => {
    const d = base();
    const n = applyPrefsPatch(d, {
      preferences: { COMMENT_ADDED: true },
      email: { mention: true },
    });
    expect(n.preferences).toEqual({ MENTIONED: true, COMMENT_ADDED: true });
    expect(n.email.mention).toBe(true);
    expect(n.email.assigned).toBe(false);
    expect(d.preferences.COMMENT_ADDED).toBe(false);
  });
  it('hoàn tác CHỈ khoá của bản vá đó (khoá bị bản vá khác đổi sau vẫn giữ)', () => {
    const d = base();
    const failed: PrefsPatch = { preferences: { COMMENT_ADDED: true } };
    let cur = applyPrefsPatch(d, failed);
    cur = applyPrefsPatch(cur, { preferences: { MENTIONED: false } }); // lần bấm sau, khoá khác
    const out = revertPrefsPatch(cur, failed, d);
    expect(out.preferences).toEqual({ MENTIONED: false, COMMENT_ADDED: false });
  });
  it('khoá chưa từng có trong dữ liệu gốc → hoàn tác là xoá khoá (không để lại giá trị lạ)', () => {
    const d = base();
    const p: PrefsPatch = { preferences: { SPRINT_STARTED: true } };
    const out = revertPrefsPatch(applyPrefsPatch(d, p), p, d);
    expect('SPRINT_STARTED' in out.preferences).toBe(false);
  });
});

describe('isOptionsOpen — mở dòng con', () => {
  it('chưa người dùng chạm: mở khi in-app BẬT hoặc email đã bật; tắt cả hai thì đóng', () => {
    expect(isOptionsOpen(undefined, true, false)).toBe(true);
    expect(isOptionsOpen(undefined, false, true)).toBe(true);
    expect(isOptionsOpen(undefined, false, false)).toBe(false);
  });
  it('lựa chọn thủ công thắng suy diễn', () => {
    expect(isOptionsOpen(false, true, true)).toBe(false);
    expect(isOptionsOpen(true, false, false)).toBe(true);
  });
  it('bốn loại có email ánh xạ đúng khoá', () => {
    expect(EMAIL_KEY_OF_TYPE).toEqual({
      MENTIONED: 'mention',
      ISSUE_ASSIGNED: 'assigned',
      COMMENT_ADDED: 'comment',
      STATUS_CHANGED: 'transition',
    });
  });
});

function setup(send: (p: PrefsPatch) => Promise<unknown>) {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  qc.setQueryData(keys.notificationPrefs, base());
  const invalidate = vi.spyOn(qc, 'invalidateQueries').mockResolvedValue();
  const run = (p: PrefsPatch) => {
    const o = new MutationObserver(qc, prefsMutationOptions(qc, send));
    return o.mutate(p).catch(() => undefined);
  };
  const data = () => qc.getQueryData<NotificationPrefsResponse>(keys.notificationPrefs)!;
  return { qc, run, data, invalidate };
}
const defer = <T>() => {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

describe('prefsMutationOptions — optimistic, nối tiếp, không đua', () => {
  it('cập nhật cache NGAY (trước khi máy chủ trả lời)', async () => {
    const d = defer<void>();
    const { run, data } = setup(() => d.promise);
    const p = run({ preferences: { COMMENT_ADDED: true } });
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
    expect(data().preferences.COMMENT_ADDED).toBe(true);
    d.resolve();
    await p;
  });
  it('bấm liên tiếp cùng khoá: gửi NỐI TIẾP đúng thứ tự, giá trị cuối thắng, cache không bị hoàn tác cũ', async () => {
    const order: string[] = [];
    const gates = [defer<void>(), defer<void>()];
    let n = 0;
    const { run, data, invalidate } = setup(async (p) => {
      const i = n++;
      order.push(`start${i}:${p.preferences?.COMMENT_ADDED}`);
      await gates[i]!.promise;
      order.push(`end${i}`);
    });
    const p1 = run({ preferences: { COMMENT_ADDED: true } });
    const p2 = run({ preferences: { COMMENT_ADDED: false } });
    await new Promise((r) => setTimeout(r, 10));
    expect(order).toEqual(['start0:true']); // lần hai chờ lần một
    gates[0]!.resolve();
    await new Promise((r) => setTimeout(r, 10));
    expect(order).toEqual(['start0:true', 'end0', 'start1:false']);
    gates[1]!.resolve();
    await Promise.all([p1, p2]);
    expect(data().preferences.COMMENT_ADDED).toBe(false); // lần bấm cuối thắng
    expect(invalidate).toHaveBeenCalledTimes(1); // chỉ nạp lại khi lần cuối xong
  });
  it('một lần lỗi hoàn tác đúng khoá của nó, không xoá thay đổi lạc quan của khoá khác', async () => {
    const gates = [defer<void>(), defer<void>()];
    let n = 0;
    const { run, data, invalidate } = setup(() => gates[n++]!.promise);
    const p1 = run({ preferences: { COMMENT_ADDED: true } });
    const p2 = run({ email: { mention: true } });
    await new Promise((r) => setTimeout(r, 10));
    gates[0]!.reject(new Error('500'));
    await new Promise((r) => setTimeout(r, 10));
    expect(data().preferences.COMMENT_ADDED).toBe(false); // hoàn tác
    expect(data().email.mention).toBe(true); // vẫn giữ (đang chờ gửi)
    gates[1]!.resolve();
    await Promise.all([p1, p2]);
    expect(data().email.mention).toBe(true);
    expect(invalidate).toHaveBeenCalledTimes(1);
  });
  it('lỗi duy nhất: hoàn tác về đúng giá trị cũ rồi nạp lại để khớp máy chủ', async () => {
    const { run, data, invalidate } = setup(() => Promise.reject(new Error('x')));
    await run({ preferences: { COMMENT_ADDED: true } });
    expect(data().preferences.COMMENT_ADDED).toBe(false);
    expect(invalidate).toHaveBeenCalledTimes(1);
  });
  it('payload gửi lên giữ nguyên hình dạng cũ', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const { run } = setup(send);
    await run({ preferences: { MENTIONED: false } });
    await run({ email: { assigned: true } });
    expect(send.mock.calls).toEqual([
      [{ preferences: { MENTIONED: false } }],
      [{ email: { assigned: true } }],
    ]);
  });
});
