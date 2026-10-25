import { MutationObserver, QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import type { MemberDto, RoleRefDto } from '@tirapro/types';
import { keys } from '@/lib/queryKeys';
import { queryClient } from '@/lib/queryClient';
import { clearSessionCaches } from '@/lib/sessionCache';
import { memberRolesMutationOptions, type RolesVars } from './memberRolesMutation';

const R = (...ids: string[]): RoleRefDto[] => ids.map((id) => ({ id, name: id }));
const member = (id: string, roles: RoleRefDto[]): MemberDto =>
  ({
    membershipId: `m-${id}`,
    user: { id, displayName: id, email: id, status: 'ACTIVE' },
    roles,
  }) as MemberDto;
const vars = (...ids: string[]): RolesVars => ({ roleIds: ids, refs: R(...ids) });
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

function setup(send: (ids: string[]) => Promise<MemberDto>, uid = 'u1') {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  qc.setQueryData(keys.members.workspace, [member('u1', R('a')), member('u2', R('b'))]);
  const invalidate = vi.spyOn(qc, 'invalidateQueries').mockResolvedValue();
  const run = (v: RolesVars) =>
    new MutationObserver(qc, memberRolesMutationOptions(qc, uid, send))
      .mutate(v)
      .catch(() => undefined);
  const roles = (id = 'u1') =>
    qc
      .getQueryData<MemberDto[]>(keys.members.workspace)!
      .find((m) => m.user.id === id)!
      .roles.map((r) => r.id);
  return { qc, run, roles, invalidate };
}

describe('memberRolesMutationOptions', () => {
  it('vẽ vai trò mới vào cache NGAY, hàng khác giữ nguyên', async () => {
    const d = defer<MemberDto>();
    const { run, roles } = setup(() => d.promise);
    const p = run(vars('a', 'b'));
    await settle();
    expect(roles()).toEqual(['a', 'b']);
    expect(roles('u2')).toEqual(['b']);
    d.resolve(member('u1', R('a', 'b')));
    await p;
  });

  it('các lần lưu của cùng một người chạy NỐI TIẾP đúng thứ tự (lần cuối thắng)', async () => {
    const gates = [defer<MemberDto>(), defer<MemberDto>()];
    const calls: string[][] = [];
    let n = 0;
    const { run } = setup((ids) => {
      calls.push(ids);
      return gates[n++]!.promise;
    });
    const p1 = run(vars('a', 'b'));
    const p2 = run(vars('a', 'b', 'c'));
    await settle();
    expect(calls).toEqual([['a', 'b']]); // lần 2 CHƯA gửi khi lần 1 còn chạy
    gates[0]!.resolve(member('u1', R('a', 'b')));
    await settle();
    expect(calls).toEqual([
      ['a', 'b'],
      ['a', 'b', 'c'],
    ]);
    gates[1]!.resolve(member('u1', R('a', 'b', 'c')));
    await Promise.all([p1, p2]);
  });

  it('hai người khác nhau KHÔNG xếp hàng chung', async () => {
    const calls: string[] = [];
    const gate = defer<MemberDto>();
    const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    qc.setQueryData(keys.members.workspace, [member('u1', R('a')), member('u2', R('b'))]);
    vi.spyOn(qc, 'invalidateQueries').mockResolvedValue();
    const p1 = new MutationObserver(
      qc,
      memberRolesMutationOptions(qc, 'u1', () => (calls.push('u1'), gate.promise)),
    ).mutate(vars('a', 'x'));
    const p2 = new MutationObserver(
      qc,
      memberRolesMutationOptions(qc, 'u2', () => (calls.push('u2'), gate.promise)),
    ).mutate(vars('b', 'x'));
    await settle();
    expect(calls).toEqual(['u1', 'u2']);
    gate.resolve(member('u1', R('a')));
    await Promise.all([p1, p2]);
  });

  it('lỗi ở lần cuối → hoàn tác về vai trò máy chủ đã xác nhận', async () => {
    const { run, roles } = setup(() => Promise.reject(new Error('409')));
    await run(vars('a', 'b'));
    expect(roles()).toEqual(['a']);
  });

  it('lần 1 lỗi nhưng còn lần 2 xếp hàng → KHÔNG hoàn tác (lần 2 định đoạt); lần 2 lỗi → về confirmed', async () => {
    const gates = [defer<MemberDto>(), defer<MemberDto>()];
    let n = 0;
    const { run, roles } = setup(() => gates[n++]!.promise);
    const p1 = run(vars('a', 'b'));
    const p2 = run(vars('a', 'b', 'c'));
    await settle();
    gates[0]!.reject(new Error('500'));
    await settle();
    expect(roles()).toEqual(['a', 'b', 'c']); // không bị kéo về 'a' giữa chừng
    gates[1]!.reject(new Error('500'));
    await Promise.all([p1, p2]);
    expect(roles()).toEqual(['a']);
  });

  it('lần 1 thành công, lần 2 lỗi → về kết quả đã lưu của lần 1 (không về bản gốc)', async () => {
    const gates = [defer<MemberDto>(), defer<MemberDto>()];
    let n = 0;
    const { run, roles } = setup(() => gates[n++]!.promise);
    const p1 = run(vars('a', 'b'));
    const p2 = run(vars('a', 'b', 'c'));
    await settle();
    gates[0]!.resolve(member('u1', R('a', 'b')));
    await settle();
    gates[1]!.reject(new Error('500'));
    await Promise.all([p1, p2]);
    expect(roles()).toEqual(['a', 'b']);
  });

  it('chỉ nạp lại (và làm mới quyền) khi là lần cuối còn chạy', async () => {
    const gates = [defer<MemberDto>(), defer<MemberDto>()];
    let n = 0;
    const { run, invalidate } = setup(() => gates[n++]!.promise);
    const p1 = run(vars('a', 'b'));
    const p2 = run(vars('a', 'c'));
    await settle();
    gates[0]!.resolve(member('u1', R('a', 'b')));
    await settle();
    expect(invalidate).not.toHaveBeenCalled();
    gates[1]!.resolve(member('u1', R('a', 'c')));
    await Promise.all([p1, p2]);
    const hit = invalidate.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey));
    expect(hit).toContain(JSON.stringify(keys.members.workspace));
    expect(hit).toContain(JSON.stringify(keys.projects.permissionsAll));
  });

  it('không tìm thấy người trong cache: không vẽ lạc quan và onSettled không trừ nhầm', async () => {
    const { qc, run, roles } = setup(() => Promise.resolve(member('u1', R('a'))), 'ghost');
    await run(vars('x'));
    expect(roles()).toEqual(['a']);
    expect(qc.getQueryData<MemberDto[]>(keys.members.workspace)).toHaveLength(2);
  });

  it('đổi phiên (clearSessionCaches) giữa chừng: lỗi cũ không ghi đè dữ liệu của phiên mới', async () => {
    const gate = defer<MemberDto>();
    queryClient.setQueryData(keys.members.workspace, [member('u1', R('a'))]);
    const p = new MutationObserver(
      queryClient,
      memberRolesMutationOptions(queryClient, 'u1', () => gate.promise),
    )
      .mutate(vars('a', 'b'))
      .catch(() => undefined);
    await settle();
    clearSessionCaches();
    queryClient.setQueryData(keys.members.workspace, [member('u1', R('z'))]);
    gate.reject(new Error('500'));
    await p;
    expect(
      queryClient.getQueryData<MemberDto[]>(keys.members.workspace)![0]!.roles.map((r) => r.id),
    ).toEqual(['z']);
    queryClient.clear();
  });
});
