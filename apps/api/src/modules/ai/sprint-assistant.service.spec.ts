import { describe, expect, it, vi } from 'vitest';
import { SprintAssistantService } from './sprint-assistant.service';

const sprint = { id: 's1', projectId: 'p1', state: 'FUTURE', name: 'Sprint 5' };
let n = 0;
const row = (points: number | null, over: Record<string, unknown> = {}) => ({
  id: `i${++n}`,
  key: `TP-${n}`,
  summary: `Việc ${n}`,
  storyPoints: points,
  version: 1,
  dueDate: null,
  rank: `0|${String(n).padStart(3, '0')}`,
  priority: { rank: 3 },
  ...over,
});

function make(
  backlog: unknown[],
  opts: { closes?: number[]; claude?: Record<string, unknown>; sprintRow?: unknown } = {},
) {
  const prisma = {
    sprint: {
      findFirst: vi.fn().mockResolvedValue(opts.sprintRow === undefined ? sprint : opts.sprintRow),
    },
    sprintSnapshot: {
      findMany: vi.fn().mockResolvedValue((opts.closes ?? []).map((p) => ({ completedPoints: p }))),
    },
    issue: { findMany: vi.fn().mockResolvedValue(backlog) },
  };
  const claude = {
    modelFast: 'fast-m',
    modelPrimary: 'primary-m',
    available: () => false,
    extract: vi.fn(),
    ...opts.claude,
  };
  return { svc: new SprintAssistantService(prisma as never, claude as never), prisma, claude };
}
const input = { projectId: 'p1', sprintId: 's1' };

describe('SprintAssistantService', () => {
  it('capacity 20, backlog [8,5,5,3,13] → chọn [8,5,5], leftovers 2, source heuristic', async () => {
    n = 0;
    const backlog = [row(8), row(5), row(5), row(3), row(13)];
    const { svc, claude } = make(backlog);
    const out = await svc.plan('ws1', 'me', { ...input, capacityPoints: 20 });
    expect(out.picks.map((p) => p.storyPoints)).toEqual([8, 5, 5]);
    expect(out.leftovers).toBe(2);
    expect(out.capacityPoints).toBe(20);
    expect(out.source).toBe('heuristic');
    expect(claude.extract).not.toHaveBeenCalled();
  });

  it('không nhập capacity → dùng velocity trung bình 3 sprint đóng gần nhất; bỏ qua issue chưa ước lượng và đếm riêng', async () => {
    n = 0;
    const { svc, prisma } = make([row(null), row(5), row(0), row(8)], { closes: [10, 12, 14] });
    const out = await svc.plan('ws1', 'me', input);
    expect(prisma.sprintSnapshot.findMany.mock.calls[0]![0]).toMatchObject({
      where: { kind: 'CLOSE' },
      orderBy: { snapshotAt: 'desc' },
      take: 3,
    });
    expect(out.velocityAvg).toBe(12);
    expect(out.capacityPoints).toBe(12);
    expect(out.picks.map((p) => p.storyPoints)).toEqual([5]); // 5+8=13 > 12
    expect(out.unestimated).toBe(2);
    expect(out.leftovers).toBe(1);
  });

  it('ưu tiên: issue đến hạn trong 2 tuần lên đầu, rồi priority.rank giảm dần, rồi rank', async () => {
    n = 0;
    const soon = new Date(Date.now() + 3 * 86_400_000);
    const far = new Date(Date.now() + 60 * 86_400_000);
    const a = row(5, { priority: { rank: 5 } });
    const b = row(5, { priority: { rank: 1 }, dueDate: soon });
    const c = row(5, { priority: { rank: 4 }, dueDate: far });
    const d = row(5, { priority: null });
    const { svc } = make([a, b, c, d]);
    const out = await svc.plan('ws1', 'me', { ...input, capacityPoints: 100 });
    expect(out.picks.map((p) => p.issueId)).toEqual([b.id, a.id, c.id, d.id]);
    expect(out.picks[0]!.reason).toMatch(/hạn/);
  });

  it('chưa có lịch sử velocity và không nhập capacity → capacity 0, không chọn gì', async () => {
    n = 0;
    const out = await make([row(3)]).svc.plan('ws1', 'me', input);
    expect(out.capacityPoints).toBe(0);
    expect(out.picks).toEqual([]);
    expect(out.leftovers).toBe(1);
  });

  it('sprint không thuộc dự án → 404; sprint đã đóng → lỗi nghiệp vụ', async () => {
    await expect(make([], { sprintRow: null }).svc.plan('ws1', 'me', input)).rejects.toThrow();
    await expect(
      make([], { sprintRow: { ...sprint, state: 'CLOSED' } }).svc.plan('ws1', 'me', input),
    ).rejects.toThrow();
  });

  it('Claude (có goal): dùng model fast, tôn trọng capacity, bỏ id lạ/trùng, source claude', async () => {
    n = 0;
    const backlog = [row(8), row(5), row(5), row(3), row(13)];
    const extract = vi.fn().mockResolvedValue({
      data: {
        picks: [
          { id: 'c4', reason: 'Khớp mục tiêu' },
          { id: 'c4', reason: 'trùng' },
          { id: 'zz', reason: 'lạ' },
          { id: 'c1', reason: 'Quan trọng' },
          { id: 'c5', reason: 'quá lớn' },
          { id: 'c2', reason: 'Hỗ trợ' },
        ],
      },
    });
    const { svc } = make(backlog, { claude: { available: () => true, extract } });
    const out = await svc.plan('ws1', 'me', {
      ...input,
      capacityPoints: 20,
      goal: 'Hoàn thiện thanh toán',
    });
    const arg = extract.mock.calls[0]![0] as {
      model: string;
      ctx: { feature: string };
      prompt: string;
    };
    expect(arg.model).toBe('fast-m');
    expect(arg.ctx.feature).toBe('sprint-plan');
    expect(arg.prompt).toContain('Hoàn thiện thanh toán');
    expect(out.source).toBe('claude');
    // c4(3) + c1(8) + c5(13)=24>20 bỏ + c2(5)=16
    expect(out.picks.map((p) => p.storyPoints)).toEqual([3, 8, 5]);
    expect(out.picks[0]!.reason).toBe('Khớp mục tiêu');
    expect(out.leftovers).toBe(2);
  });

  it('Claude lỗi / timeout / không có goal → heuristic', async () => {
    n = 0;
    const backlog = [row(8), row(5)];
    const timeout = vi.fn().mockResolvedValue({ data: null, reason: 'timeout' });
    const a = await make(backlog, { claude: { available: () => true, extract: timeout } }).svc.plan(
      'ws1',
      'me',
      { ...input, capacityPoints: 20, goal: 'x' },
    );
    expect(a.source).toBe('heuristic');
    expect(a.reason).toBe('timeout');
    const boom = vi.fn().mockRejectedValue(new Error('x'));
    const b = await make(backlog, { claude: { available: () => true, extract: boom } }).svc.plan(
      'ws1',
      'me',
      { ...input, capacityPoints: 20, goal: 'x' },
    );
    expect(b.reason).toBe('error');
    const noGoal = vi.fn();
    const c = await make(backlog, { claude: { available: () => true, extract: noGoal } }).svc.plan(
      'ws1',
      'me',
      { ...input, capacityPoints: 20 },
    );
    expect(c.source).toBe('heuristic');
    expect(noGoal).not.toHaveBeenCalled();
  });
});

describe('SprintAssistantService — heuristic (U20)', () => {
  it('heuristic có mục tiêu: việc khớp từ khoá lên đầu, lý do nêu từ khoá thật', async () => {
    n = 0;
    const backlog = [
      row(3, { summary: 'Tìm kiếm sản phẩm' }),
      row(5, { summary: 'Giỏ hàng: thêm/xóa sản phẩm' }),
      row(2, { summary: 'Thanh toán qua VNPay' }),
    ];
    const { svc } = make(backlog, { closes: [20] });
    const r = await svc.plan('w', 'u', { ...input, goal: 'giữ giỏ hàng' });
    expect(r.picks[0]!.summary).toContain('Giỏ hàng');
    expect(r.picks[0]!.reason).toMatch(/Khớp mục tiêu: “giỏ/);
    expect(r.source).toBe('heuristic');
    expect(r.reason).toBe('unconfigured');
  });

  it('việc ưu tiên Medium không bị ghi "ưu tiên cao"', async () => {
    n = 0;
    const { svc } = make([row(3, { priority: { rank: 3, name: 'Medium' } })], { closes: [10] });
    const r = await svc.plan('w', 'u', input);
    expect(r.picks[0]!.reason).not.toMatch(/ưu tiên cao/i);
    expect(r.picks[0]!.reason).toMatch(/Vị trí 1 trong Việc chờ/);
  });

  it('High/Highest được ghi đúng tên ưu tiên', async () => {
    n = 0;
    const { svc } = make([row(3, { priority: { rank: 5, name: 'Highest' } })], { closes: [10] });
    expect((await svc.plan('w', 'u', input)).picks[0]!.reason).toContain('Ưu tiên Highest');
  });

  it('không còn chữ "backlog" trong lý do', async () => {
    n = 0;
    const { svc } = make([row(3)], { closes: [10] });
    expect((await svc.plan('w', 'u', input)).picks[0]!.reason).not.toMatch(/backlog/i);
  });

  it('vừa khớp mục tiêu vừa đến hạn → ghép lý do, ngày dd/MM; quá hạn ghi "Quá hạn"', async () => {
    n = 0;
    const due = new Date(Date.UTC(2099, 9, 22, 5, 0, 0));
    const soonDue = new Date(Date.now() + 3 * 86_400_000);
    const late = new Date(Date.now() - 2 * 86_400_000);
    const { svc } = make(
      [
        row(2, { summary: 'Giỏ hàng', dueDate: soonDue }),
        row(2, { summary: 'Việc khác', dueDate: late }),
        row(2, { summary: 'Xa', dueDate: due }),
      ],
      { closes: [20] },
    );
    const r = await svc.plan('w', 'u', { ...input, goal: 'giỏ hàng' });
    const dd = (d: Date) => {
      const vn = new Date(d.getTime() + 7 * 3_600_000); // giờ Việt Nam (UTC+7, không DST)
      return `${String(vn.getUTCDate()).padStart(2, '0')}/${String(vn.getUTCMonth() + 1).padStart(2, '0')}`;
    };
    expect(r.picks[0]!.reason).toBe(`Khớp mục tiêu: “giỏ” “hàng” · Đến hạn ${dd(soonDue)}`);
    expect(r.picks[1]!.reason).toBe(`Quá hạn ${dd(late)}`);
    expect(r.picks[1]!.reason).toMatch(/^Quá hạn \d{2}\/\d{2}$/);
    expect(r.picks[2]!.reason).toMatch(/^Vị trí 3 trong Việc chờ$/);
  });

  it('có Claude nhưng không có mục tiêu → heuristic không kèm reason', async () => {
    n = 0;
    const extract = vi.fn();
    const { svc } = make([row(3)], { closes: [10], claude: { available: () => true, extract } });
    const r = await svc.plan('w', 'u', input);
    expect(r.source).toBe('heuristic');
    expect(r.reason).toBeUndefined();
  });
});
