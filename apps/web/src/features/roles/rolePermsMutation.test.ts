import { MutationObserver, QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import type { RoleDto } from '@tirapro/types';
import { keys } from '@/lib/queryKeys';
import { rolePermsMutationOptions, type PermsVars } from './rolePermsMutation';

const role = (id: string, permissionKeys: string[], updatedAt = 't0'): RoleDto =>
  ({ id, name: id, scope: 'PROJECT', isSystem: false, permissionKeys, updatedAt }) as RoleDto;
const vars = (...ks: string[]): PermsVars => ({ keys: ks });
const settle = () => new Promise((r) => setTimeout(r, 10));
const defer = <T>() => {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

type Send = (keys: string[], expectedUpdatedAt: string | undefined) => Promise<RoleDto>;

function setup(send: Send, roleId = 'r1') {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  // hai biến thể cache (ALL và theo phạm vi) cùng chứa vai trò
  qc.setQueryData(keys.roles.byScope(undefined), [role('r1', ['a']), role('r2', ['x'])]);
  qc.setQueryData(keys.roles.byScope('PROJECT'), [role('r1', ['a']), role('r2', ['x'])]);
  const invalidate = vi.spyOn(qc, 'invalidateQueries').mockResolvedValue();
  const run = (v: PermsVars) =>
    new MutationObserver(qc, rolePermsMutationOptions(qc, roleId, send))
      .mutate(v)
      .catch((e: unknown) => e);
  const cached = (scope?: 'PROJECT', id = 'r1') =>
    qc.getQueryData<RoleDto[]>(keys.roles.byScope(scope))!.find((r) => r.id === id)!.permissionKeys;
  return { qc, run, cached, invalidate };
}

describe('rolePermsMutationOptions', () => {
  it('vẽ bộ quyền mới vào MỌI biến thể cache NGAY, vai trò khác giữ nguyên', async () => {
    const d = defer<RoleDto>();
    const { run, cached } = setup(() => d.promise);
    const p = run(vars('a', 'b'));
    await settle();
    expect(cached()).toEqual(['a', 'b']);
    expect(cached('PROJECT')).toEqual(['a', 'b']);
    expect(cached(undefined, 'r2')).toEqual(['x']);
    d.resolve(role('r1', ['a', 'b'], 't1'));
    await p;
  });

  it('gọi onOptimistic SAU khi đã ghi cache (để bản nháp cục bộ không nhấp nháy)', async () => {
    const d = defer<RoleDto>();
    const { run, cached } = setup(() => d.promise);
    let seen: string[] | null = null;
    const p = run({ keys: ['a', 'b'], onOptimistic: () => (seen = cached()) });
    await settle();
    expect(seen).toEqual(['a', 'b']);
    d.resolve(role('r1', ['a', 'b'], 't1'));
    await p;
  });

  it('gửi expectedUpdatedAt = bản đã thấy; lần xếp hàng sau dùng updatedAt MỚI từ lần trước, không phải bản cũ', async () => {
    const gates = [defer<RoleDto>(), defer<RoleDto>()];
    const calls: Array<[string[], string | undefined]> = [];
    let n = 0;
    const { run } = setup((ks, at) => {
      calls.push([ks, at]);
      return gates[n++]!.promise;
    });
    const p1 = run(vars('a', 'b'));
    const p2 = run(vars('a', 'b', 'c'));
    await settle();
    expect(calls).toEqual([[['a', 'b'], 't0']]); // lần 2 CHƯA gửi khi lần 1 còn chạy
    gates[0]!.resolve(role('r1', ['a', 'b'], 't1'));
    await settle();
    expect(calls[1]).toEqual([['a', 'b', 'c'], 't1']);
    gates[1]!.resolve(role('r1', ['a', 'b', 'c'], 't2'));
    await Promise.all([p1, p2]);
  });

  it('hai vai trò khác nhau KHÔNG xếp hàng chung', async () => {
    const calls: string[] = [];
    const gate = defer<RoleDto>();
    const { qc } = setup(() => gate.promise);
    const send =
      (id: string): Send =>
      () => {
        calls.push(id);
        return gate.promise;
      };
    const o1 = new MutationObserver(qc, rolePermsMutationOptions(qc, 'r1', send('r1')));
    const o2 = new MutationObserver(qc, rolePermsMutationOptions(qc, 'r2', send('r2')));
    const p1 = o1.mutate(vars('a', 'z')).catch(() => undefined);
    const p2 = o2.mutate(vars('x', 'z')).catch(() => undefined);
    await settle();
    expect(calls.sort()).toEqual(['r1', 'r2']);
    gate.resolve(role('r1', [], 't1'));
    await Promise.all([p1, p2]);
  });

  it('lỗi ở lần LẺ giữa chuỗi KHÔNG hoàn tác (còn lần sau định đoạt); lỗi ở lần cuối hoàn về bản máy chủ ĐÃ XÁC NHẬN, không phải ảnh lạc quan', async () => {
    const gates = [defer<RoleDto>(), defer<RoleDto>()];
    let n = 0;
    const { run, cached } = setup(() => gates[n++]!.promise);
    const p1 = run(vars('a', 'b'));
    const p2 = run(vars('a', 'b', 'c'));
    await settle();
    gates[0]!.reject(new Error('lần 1 lỗi'));
    await settle();
    expect(cached()).toEqual(['a', 'b', 'c']); // chưa hoàn tác: lần 2 còn chờ
    gates[1]!.reject(new Error('lần 2 lỗi'));
    await Promise.all([p1, p2]);
    expect(cached()).toEqual(['a']); // bản máy chủ xác nhận từ đầu
    expect(cached('PROJECT')).toEqual(['a']);
  });

  it('lần 1 thành công rồi lần 2 lỗi → hoàn về kết quả lần 1 (đã xác nhận)', async () => {
    const gates = [defer<RoleDto>(), defer<RoleDto>()];
    let n = 0;
    const { run, cached } = setup(() => gates[n++]!.promise);
    const p1 = run(vars('a', 'b'));
    const p2 = run(vars('a', 'b', 'c'));
    await settle();
    gates[0]!.resolve(role('r1', ['a', 'b'], 't1'));
    await settle();
    gates[1]!.reject(new Error('x'));
    await Promise.all([p1, p2]);
    expect(cached()).toEqual(['a', 'b']);
  });

  it('chỉ nạp lại danh sách (và quyền hiệu lực của dự án) khi đây là lần CUỐI còn chạy', async () => {
    const gates = [defer<RoleDto>(), defer<RoleDto>()];
    let n = 0;
    const { run, invalidate } = setup(() => gates[n++]!.promise);
    const p1 = run(vars('a', 'b'));
    const p2 = run(vars('a', 'b', 'c'));
    await settle();
    gates[0]!.resolve(role('r1', ['a', 'b'], 't1'));
    await settle();
    expect(invalidate).not.toHaveBeenCalled();
    gates[1]!.resolve(role('r1', ['a', 'b', 'c'], 't2'));
    await Promise.all([p1, p2]);
    const keysCalled = invalidate.mock.calls.map((c) =>
      JSON.stringify((c[0] as { queryKey: unknown }).queryKey),
    );
    expect(keysCalled).toContain(JSON.stringify(keys.roles.all));
    expect(keysCalled).toContain(JSON.stringify(keys.projects.permissionsAll));
  });

  it('lỗi cũng nạp lại ở lần cuối (409: bản máy chủ mới thay bản đã hoàn tác)', async () => {
    const { run, invalidate } = setup(() => Promise.reject(new Error('409')));
    await run(vars('a', 'b'));
    expect(invalidate).toHaveBeenCalled();
  });
});

describe('rolePermsMutationOptions — sau thành công / mốc Hoàn tác', () => {
  it('thành công: GHI updatedAt trả về vào MỌI biến thể cache (không đợi nạp lại) — bó bấm kế tiếp không gửi bản cũ', async () => {
    const gate = defer<RoleDto>();
    const { run, cached, qc } = setup(() => gate.promise);
    const p = run(vars('a', 'b'));
    await settle();
    gate.resolve(role('r1', ['a', 'b'], 't1'));
    await p;
    const at = (scope?: 'PROJECT') =>
      qc.getQueryData<RoleDto[]>(keys.roles.byScope(scope))!.find((r) => r.id === 'r1')!.updatedAt;
    expect(at()).toBe('t1');
    expect(at('PROJECT')).toBe('t1');
    expect(cached()).toEqual(['a', 'b']);
  });

  it('bó bấm thứ hai sau khi bó đầu xong (cache chưa nạp lại) gửi updatedAt MỚI, không 409 giả', async () => {
    const calls: Array<string | undefined> = [];
    const { run, qc } = setup((ks, at) => {
      calls.push(at);
      return Promise.resolve(role('r1', ks, `t${calls.length}`));
    });
    await run(vars('a', 'b'));
    // invalidate bị giả (mockResolvedValue) → cache KHÔNG được nạp lại; vẫn phải mang updatedAt mới
    expect(qc.getQueryData<RoleDto[]>(keys.roles.byScope(undefined))![0]!.updatedAt).toBe('t1');
    await run(vars('a', 'b', 'c'));
    expect(calls).toEqual(['t0', 't1']);
  });

  it('thành công giữa chuỗi: chỉ đóng dấu updatedAt, KHÔNG ghi đè bộ quyền lạc quan của lần xếp hàng sau', async () => {
    const gates = [defer<RoleDto>(), defer<RoleDto>()];
    let n = 0;
    const { run, cached } = setup(() => gates[n++]!.promise);
    const p1 = run(vars('a', 'b'));
    const p2 = run(vars('a', 'b', 'c'));
    await settle();
    gates[0]!.resolve(role('r1', ['a', 'b'], 't1'));
    await settle();
    expect(cached()).toEqual(['a', 'b', 'c']);
    gates[1]!.resolve(role('r1', ['a', 'b', 'c'], 't2'));
    await Promise.all([p1, p2]);
  });

  it('onConfirmed báo bộ ĐÃ XÁC NHẬN TRƯỚC lần lưu: lần 1 lỗi (không phải 409), lần 2 thành công → trước = bản máy chủ cũ, không phải ảnh lạc quan của lần 1', async () => {
    const gates = [defer<RoleDto>(), defer<RoleDto>()];
    let n = 0;
    const { run } = setup(() => gates[n++]!.promise);
    const before: string[][] = [];
    const p1 = run(vars('a', 'b'));
    const p2 = run({ keys: ['a', 'b', 'c'], onConfirmed: (b) => before.push(b) });
    await settle();
    gates[0]!.reject(new Error('500'));
    await settle();
    gates[1]!.resolve(role('r1', ['a', 'b', 'c'], 't2'));
    await Promise.all([p1, p2]);
    expect(before).toEqual([['a']]);
  });

  it('không có vai trò trong cache → không ghi lạc quan, không hoàn tác bậy', async () => {
    const { qc, run } = setup(() => Promise.reject(new Error('x')));
    qc.setQueryData(keys.roles.byScope(undefined), []);
    qc.setQueryData(keys.roles.byScope('PROJECT'), []);
    await run(vars('a'));
    expect(qc.getQueryData<RoleDto[]>(keys.roles.byScope(undefined))).toEqual([]);
  });
});
