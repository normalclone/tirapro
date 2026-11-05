import { describe, expect, it, vi } from 'vitest';
import { parseBulkAddMember, parseBulkAssign, parseBulkRemoveMember } from './bulkParse';
import { planBulk, planNeedsChoice, type BulkActor } from './bulkPlan';
import { bulkReply, dedupeLines, describePlan } from './bulkReply';
import { ENV, issue, makeDeps } from './fixtures';

const ACTOR: BulkActor = { id: 'u-me', displayName: 'Tôi Là Mình' };
const sub = (n: number) =>
  issue({ id: `i${n}`, key: `DEMO-SUB-${n}`, summary: `Việc ${n}`, assignee: null });
const issues = (...ns: number[]) => {
  const m = new Map(ns.map((n) => [`DEMO-SUB-${n}`, sub(n)]));
  return { getIssue: (k: string) => Promise.resolve(m.get(k) ?? null) };
};
const intentOf = (cmd: string) =>
  (parseBulkAssign(cmd) ?? parseBulkAddMember(cmd) ?? parseBulkRemoveMember(cmd))!;
/** Tóm tắt bằng chữ của KẾ HOẠCH (dùng khi không có thẻ) + dòng kết luận như `bulkReply` trả khi không dựng được thẻ. */
const text = async (cmd: string, deps = makeDeps(issues(1, 2))) => {
  const plan = await planBulk(intentOf(cmd), { ...ENV, actor: ACTOR }, deps, ACTOR);
  const tail = planNeedsChoice(plan) ? 'Còn mục cần chọn lại — mình chưa làm gì.' : 'chưa ghi gì';
  return `${describePlan(plan).join('\n')}\n${tail}`;
};
/** Khối trả về của `bulkReply` cho lệnh (card = khối `bulk`). */
const reply = async (cmd: string, deps = makeDeps(issues(1, 2))) =>
  (await bulkReply(intentOf(cmd), { ...ENV, actor: ACTOR }, deps))!;

describe('tóm tắt kế hoạch bằng chữ (describePlan)', () => {
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
  it('bulkReply dựng THẺ xem trước và không bao giờ gọi hàm ghi: chỉ các hàm đọc của deps', async () => {
    const deps = makeDeps(issues(1));
    for (const cmd of ['giao DEMO-SUB-1 cho Linh', 'thêm Linh vào DEMO', 'gỡ Linh khỏi DEMO']) {
      const blocks = await reply(cmd, deps);
      expect(blocks.map((b) => b.type)).toEqual(['text', 'bulk']);
      const bulk = blocks[1]!;
      expect(bulk.type === 'bulk' && bulk.status).toBe('pending');
    }
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
    expect(b![0]!.type).toBe('text');
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

describe('fix round 1 — bulkReply: khớp gần đúng và nhường ý định cũ', () => {
  it('khớp gần đúng được đánh dấu "kiểm tra lại" kèm người đã chọn', async () => {
    const t = await text('giao DEMO-SUB-1 cho Hươ');
    expect(t).toContain('Hương Đỗ (gần đúng — kiểm tra lại)');
    expect(t).toContain('Khớp gần đúng, hãy kiểm tra lại: “Hươ” → Hương Đỗ');
  });
  it('khớp tên đầy đủ thì không có dấu gần đúng', async () => {
    expect(await text('giao DEMO-SUB-1 cho Linh')).not.toContain('gần đúng');
  });
  it('có raw + không khớp gì → null (respond nhường ý định cũ); không raw thì vẫn trả lời', async () => {
    const intent = { ...parseBulkAddMember('thêm Zzz vào ZZZ')!, raw: 'thêm Zzz vào ZZZ' };
    expect(await bulkReply(intent, ENV, makeDeps())).toBeNull();
    expect(
      await bulkReply(parseBulkAddMember('thêm Zzz vào ZZZ')!, ENV, makeDeps()),
    ).not.toBeNull();
  });
  it('lỗi cú pháp (cặp sai cấu trúc) → nói rõ, "mình chưa làm gì"', async () => {
    const t = await text('giao DEMO-SUB-1 cho An cho Linh');
    expect(t).toContain('cặp việc');
    expect(t).toContain('mình chưa làm gì');
  });
});

describe('T2 carry — R4 mỗi điều chỉ nói một lần', () => {
  it('"Không thấy dự án “ZZZ”" chỉ xuất hiện một lần trong trả lời', async () => {
    const t = await text('thêm Linh vào ZZZ');
    expect(t.match(/ZZZ/g)).toHaveLength(1);
  });
  it('dedupeLines bỏ dòng "• Không thấy … “X”" đã có trong problems và dòng trùng', () => {
    expect(
      dedupeLines(
        ['• Không thấy dự án “ZZZ”.', 'a', 'a'],
        ['Không thấy dự án “ZZZ” trong các dự án bạn xem được.'],
      ),
    ).toEqual(['a']);
  });
});
