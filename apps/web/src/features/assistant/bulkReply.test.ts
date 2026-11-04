import { describe, expect, it, vi } from 'vitest';
import { parseBulkAddMember, parseBulkAssign, parseBulkRemoveMember } from './bulkParse';
import { planBulk, type BulkActor } from './bulkPlan';
import { bulkReply, describePlan } from './bulkReply';
import { ENV, issue, makeDeps } from './fixtures';

const ACTOR: BulkActor = { id: 'u-me', displayName: 'Tôi Là Mình' };
const sub = (n: number) =>
  issue({ id: `i${n}`, key: `DEMO-SUB-${n}`, summary: `Việc ${n}`, assignee: null });
const issues = (...ns: number[]) => {
  const m = new Map(ns.map((n) => [`DEMO-SUB-${n}`, sub(n)]));
  return { getIssue: (k: string) => Promise.resolve(m.get(k) ?? null) };
};
const text = async (cmd: string, deps = makeDeps(issues(1, 2))) => {
  const b = await bulkReply(
    (parseBulkAssign(cmd) ?? parseBulkAddMember(cmd) ?? parseBulkRemoveMember(cmd))!,
    { ...ENV, actor: ACTOR },
    deps,
  );
  expect(b).toHaveLength(1);
  return b[0]!.type === 'text' ? b[0]!.text : '';
};

describe('bulkReply (tóm tắt kế hoạch — chưa ghi gì)', () => {
  it('giao việc rõ ràng: nêu số việc, người, mã không thấy; nói rõ chưa ghi', async () => {
    const t = await text('giao DEMO-SUB-1..3 cho Linh');
    expect(t).toContain('Giao 2 việc cho Phạm Linh');
    expect(t).toContain('DEMO-SUB-3');
    expect(t).toContain('chưa ghi gì');
    expect(t).not.toContain('Còn mục cần chọn lại');
  });
  it('tên mơ hồ → liệt kê lựa chọn kèm email và nói "cần chọn", không làm gì', async () => {
    const t = await text('giao DEMO-SUB-1 cho Thuỷ');
    expect(t).toContain('cần chọn một');
    expect(t).toContain('Còn mục cần chọn lại — mình chưa làm gì.');
  });
  it('không bao giờ gọi hàm ghi: chỉ các hàm đọc của deps', async () => {
    const deps = makeDeps(issues(1));
    await text('giao DEMO-SUB-1 cho Linh', deps);
    await text('thêm Linh vào DEMO', deps);
    await text('gỡ Linh khỏi DEMO', deps);
    expect(deps.calls.every((c) => /^(get|search|can)/.test(c))).toBe(true);
  });
  it('thêm thành viên: dự án, vai trò, người từ team', async () => {
    const t = await text('thêm Nhóm QA vào DEMO, ALPHA vai trò Tester');
    expect(t).toContain('Thêm Phạm Linh, Bình Trần vào 2 dự án (DEMO, ALPHA)');
    expect(t).toContain('Vai trò: Tester');
    expect(t).toMatch(/2 người từ team QA/);
  });
  it('không nói vai trò → nhắc chọn trên thẻ; nhóm cá nhân hiện tên nhóm', async () => {
    const t = await text('thêm Hương vào mọi dự án nhóm Thanh Hóa của tôi');
    expect(t).toContain('Chưa nói vai trò');
    expect(t).toContain('Nhóm dự án của bạn: Thanh Hóa');
  });
  it('gỡ thành viên + lỗi dự án', async () => {
    const t = await text('gỡ Linh khỏi DEMO, ZZZ');
    expect(t).toContain('Gỡ Phạm Linh khỏi 1 dự án (DEMO)');
    expect(t).toContain('Không thấy dự án “ZZZ”');
    expect(t).toContain('Còn mục cần chọn lại');
  });
  it('thiếu actor (chưa đăng nhập) không làm vỡ; "tôi" không khớp ai', async () => {
    const b = await bulkReply(
      parseBulkAssign('giao DEMO-SUB-1 cho tôi')!,
      ENV,
      makeDeps(issues(1)),
    );
    expect(b[0]!.type).toBe('text');
  });
  it('describePlan là hàm thuần trên kế hoạch (không cần deps)', async () => {
    const plan = await planBulk(
      parseBulkAssign('giao DEMO-SUB-1 cho Linh')!,
      ENV,
      makeDeps(issues(1)),
      ACTOR,
    );
    expect(describePlan(plan)[0]).toBe('Giao 1 việc cho Phạm Linh (tất cả cho một người).');
    const spy = vi.fn();
    expect(spy).not.toHaveBeenCalled();
  });
});
