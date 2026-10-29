import { QueryClient, MutationObserver } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import {
  EMAIL_KEY_OF_TYPE,
  applyPrefsPatch,
  isOptionsOpen,
  prefsMutationOptions,
  resetPrefsKeyStates,
  restorePrefsKeys,
  type PrefsPatch,
} from './notificationPrefs';
import type { NotificationPrefsResponse } from './api';
import { keys } from '@/lib/queryKeys';
import { queryClient } from '@/lib/queryClient';
import { clearSessionCaches } from '@/lib/sessionCache';

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
  it('khôi phục CHỈ các khoá được chỉ định về giá trị đã xác nhận (khoá khác giữ nguyên)', () => {
    const cur = applyPrefsPatch(base(), {
      preferences: { COMMENT_ADDED: true, MENTIONED: false },
      email: { mention: true },
    });
    const out = restorePrefsKeys(cur, {
      preferences: { COMMENT_ADDED: false },
      email: { mention: false },
    });
    expect(out.preferences).toEqual({ MENTIONED: false, COMMENT_ADDED: false });
    expect(out.email.mention).toBe(false);
  });
  it('giá trị xác nhận là undefined (khoá chưa từng có) → xoá khoá, không để lại giá trị lạ', () => {
    const cur = applyPrefsPatch(base(), { preferences: { SPRINT_STARTED: true } });
    const out = restorePrefsKeys(cur, { preferences: { SPRINT_STARTED: undefined } });
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

describe('rollback về giá trị ĐÃ XÁC NHẬN bởi máy chủ (không về ảnh chụp lạc quan)', () => {
  const settle = () => new Promise((r) => setTimeout(r, 10));
  it('(a) bật lỗi rồi tắt (xếp hàng) cũng lỗi: khoá về giá trị máy chủ (false), không kẹt ở true', async () => {
    const gates = [defer<void>(), defer<void>()];
    let n = 0;
    const { run, data, invalidate } = setup(() => gates[n++]!.promise);
    const p1 = run({ preferences: { COMMENT_ADDED: true } });
    const p2 = run({ preferences: { COMMENT_ADDED: false } }); // onMutate thấy cache đang là true (lạc quan)
    await settle();
    gates[0]!.reject(new Error('500'));
    await settle();
    // lần tắt còn xếp hàng → lần lỗi đầu KHÔNG hoàn tác (để lần sau định đoạt); UI đang là kết quả lạc quan của lần tắt
    expect(data().preferences.COMMENT_ADDED).toBe(false);
    gates[1]!.reject(new Error('500'));
    await Promise.all([p1, p2]);
    expect(data().preferences.COMMENT_ADDED).toBe(false); // = máy chủ; KHÔNG phải true
    expect(invalidate).toHaveBeenCalledTimes(1);
  });
  it('(a2) lỗi xong hẳn rồi mới bấm tiếp: lần sau lại lỗi vẫn về giá trị máy chủ', async () => {
    const { run, data } = setup(() => Promise.reject(new Error('x')));
    await run({ preferences: { COMMENT_ADDED: true } });
    expect(data().preferences.COMMENT_ADDED).toBe(false);
    await run({ preferences: { COMMENT_ADDED: false } });
    expect(data().preferences.COMMENT_ADDED).toBe(false);
    await run({ preferences: { COMMENT_ADDED: true } });
    expect(data().preferences.COMMENT_ADDED).toBe(false);
  });
  it('(b) bật/tắt/bật, lần đầu lỗi: trạng thái cuối là BẬT, không để lại TẮT', async () => {
    const gates = [defer<void>(), defer<void>(), defer<void>()];
    let n = 0;
    const seen: boolean[] = [];
    const { run, data, qc } = setup(() => gates[n++]!.promise);
    qc.getQueryCache().subscribe(() => seen.push(data().preferences.COMMENT_ADDED!));
    const ps = [
      run({ preferences: { COMMENT_ADDED: true } }),
      run({ preferences: { COMMENT_ADDED: false } }),
      run({ preferences: { COMMENT_ADDED: true } }),
    ];
    await settle();
    gates[0]!.reject(new Error('500'));
    await settle();
    gates[1]!.resolve();
    await settle();
    expect(data().preferences.COMMENT_ADDED).toBe(true); // hai lần sau đã thắng, lần lỗi không kéo về false
    gates[2]!.resolve();
    await Promise.all(ps);
    expect(data().preferences.COMMENT_ADDED).toBe(true);
  });
  it('(c) lần lỗi là lần cuối nhưng lần trước đã được máy chủ xác nhận: về giá trị đã xác nhận đó', async () => {
    const gates = [defer<void>(), defer<void>()];
    let n = 0;
    const { run, data } = setup(() => gates[n++]!.promise);
    const p1 = run({ preferences: { COMMENT_ADDED: true } });
    const p2 = run({ preferences: { COMMENT_ADDED: false } });
    await settle();
    gates[0]!.resolve(); // máy chủ xác nhận true
    await settle();
    gates[1]!.reject(new Error('500')); // tắt lỗi → phải về TRUE (đã xác nhận), không về false ban đầu
    await Promise.all([p1, p2]);
    expect(data().preferences.COMMENT_ADDED).toBe(true);
  });
  it('khoá email tuân theo cùng quy tắc, độc lập khoá in-app', async () => {
    const { run, data } = setup(() => Promise.reject(new Error('x')));
    await run({ email: { mention: true } });
    expect(data().email.mention).toBe(false);
  });
});

describe('trạng thái theo khoá gắn với PHIÊN (không rò sang người dùng sau)', () => {
  const settle = () => new Promise((r) => setTimeout(r, 10));
  const newUserData = (): NotificationPrefsResponse => ({
    ...base(),
    preferences: { MENTIONED: true, COMMENT_ADDED: true },
  });

  it('đổi phiên (resetPrefsKeyStates): lần bấm của người sau gieo lại `confirmed` từ cache mới, không dùng giá trị cũ', async () => {
    const gate = defer<void>();
    const { qc, run, data } = setup(() => gate.promise);
    const p1 = run({ preferences: { COMMENT_ADDED: false } }); // người cũ: confirmed=false... đang chờ
    await settle();
    resetPrefsKeyStates(qc); // đăng xuất / đổi workspace
    qc.setQueryData(keys.notificationPrefs, newUserData()); // người sau: máy chủ nói COMMENT_ADDED=true
    const fail = new MutationObserver(
      qc,
      prefsMutationOptions(qc, () => Promise.reject(new Error('500'))),
    );
    const p2 = fail.mutate({ preferences: { COMMENT_ADDED: false } }).catch(() => undefined);
    gate.resolve();
    await Promise.all([p1, p2]);
    expect(data().preferences.COMMENT_ADDED).toBe(true); // hoàn tác về TRUE của người sau, không phải giá trị cũ
  });

  it('lần lưu của phiên cũ xong muộn không trừ `pending` / ghi `confirmed` của phiên mới', async () => {
    const gateOld = defer<void>();
    const { qc, run, data } = setup(() => gateOld.promise);
    const old = run({ preferences: { COMMENT_ADDED: true } });
    await settle();
    resetPrefsKeyStates(qc);
    qc.setQueryData(keys.notificationPrefs, base()); // người sau: COMMENT_ADDED=false
    const failing = new MutationObserver(
      qc,
      prefsMutationOptions(qc, () => Promise.reject(new Error('500'))),
    );
    // mutation mới chạy NỐI TIẾP sau lần cũ (cùng scope); lần cũ xong trước
    const next = failing.mutate({ preferences: { COMMENT_ADDED: true } }).catch(() => undefined);
    await settle();
    gateOld.resolve(); // lần cũ thành công → KHÔNG được đặt confirmed=true cho phiên mới
    await Promise.all([old, next]);
    expect(data().preferences.COMMENT_ADDED).toBe(false); // lần mới lỗi → về false của máy chủ phiên mới
  });

  it('clearSessionCaches (đổi phiên thật) xoá trạng thái khoá của queryClient toàn cục', async () => {
    const gate = defer<void>();
    queryClient.setQueryData(keys.notificationPrefs, base());
    const o1 = new MutationObserver(
      queryClient,
      prefsMutationOptions(queryClient, () => gate.promise),
    );
    const p1 = o1.mutate({ preferences: { COMMENT_ADDED: false } }).catch(() => undefined);
    await settle();
    clearSessionCaches();
    queryClient.setQueryData(keys.notificationPrefs, newUserData());
    const o2 = new MutationObserver(
      queryClient,
      prefsMutationOptions(queryClient, () => Promise.reject(new Error('500'))),
    );
    const p2 = o2.mutate({ preferences: { COMMENT_ADDED: false } }).catch(() => undefined);
    gate.resolve();
    await Promise.all([p1, p2]);
    expect(
      queryClient.getQueryData<NotificationPrefsResponse>(keys.notificationPrefs)?.preferences
        .COMMENT_ADDED,
    ).toBe(true);
    queryClient.clear();
  });

  it('onMutate thoát sớm (cache rỗng, không tăng pending) → onSettled KHÔNG được trừ pending của lần khác', async () => {
    const gates = [defer<void>(), defer<void>(), defer<void>()];
    let n = 0;
    const { qc, run, data } = setup(() => gates[n++]!.promise);
    const a = run({ preferences: { COMMENT_ADDED: true } }); // tăng pending (=1)
    await settle();
    qc.removeQueries({ queryKey: keys.notificationPrefs }); // cache rỗng
    const b = run({ preferences: { COMMENT_ADDED: false } }); // onMutate thoát sớm, không tăng
    await settle();
    qc.setQueryData(keys.notificationPrefs, base()); // nạp lại từ máy chủ
    const c = run({ preferences: { COMMENT_ADDED: false } }); // tăng pending (=2)
    await settle();
    gates[0]!.resolve(); // a xong → pending 1, confirmed=true
    await settle();
    gates[1]!.resolve(); // b xong (không được trừ) → pending vẫn 1
    await settle();
    gates[2]!.reject(new Error('500')); // c lỗi, là lần cuối → phải hoàn tác về confirmed (true)
    await Promise.all([a, b, c]);
    expect(data().preferences.COMMENT_ADDED).toBe(true);
  });
});
