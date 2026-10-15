import { describe, expect, it, vi } from 'vitest';
import { AssigneeSuggestService } from './assignee-suggest.service';

const issue = {
  id: 'i1',
  summary: 'Lỗi thanh toán',
  typeId: 't-bug',
  projectId: 'p1',
  parentId: 'parent1',
  epicId: null,
  assigneeId: null,
  type: { name: 'Bug' },
  labels: [{ labelId: 'l1' }],
  components: [{ componentId: 'c1' }],
  sourceLinks: [{ targetIssueId: 'linked1' }],
  targetLinks: [],
};

const members = [
  { user: { id: 'uA', displayName: 'An', avatarUrl: null, email: 'an@secret.vn' } },
  { user: { id: 'uB', displayName: 'Bình', avatarUrl: 'b.png', email: 'binh@secret.vn' } },
  { user: { id: 'uC', displayName: 'Chi', avatarUrl: null, email: 'chi@secret.vn' } },
];

type Rows = { assigneeId: string; _count: { _all: number } }[];
const rows = (...p: [string, number][]): Rows =>
  p.map(([assigneeId, n]) => ({ assigneeId, _count: { _all: n } }));
const DEFAULT_ROWS = {
  type: rows(['uA', 4], ['uB', 4]), // cùng loại đã xử lý
  specific: rows(['uA', 1], ['uB', 2]), // cùng nhãn/thành phần
  open: rows(['uA', 5], ['uB', 1]),
  recent: rows(['uA', 3], ['uB', 3]), // hoạt động 14 ngày
};

function make(
  opts: {
    claude?: Record<string, unknown>;
    issueRow?: unknown;
    rows?: typeof DEFAULT_ROWS;
    comment?: { authorId: string }[];
  } = {},
) {
  const r = opts.rows ?? DEFAULT_ROWS;
  const prisma = {
    issue: {
      findFirst: vi.fn().mockResolvedValue(opts.issueRow === undefined ? issue : opts.issueRow),
      groupBy: vi
        .fn()
        .mockImplementation(
          (args: {
            where: { typeId?: string; updatedAt?: unknown; status?: { category?: unknown } };
          }) => {
            const w = args.where;
            if (w.status?.category === 'DONE')
              return Promise.resolve(w.typeId ? r.type : r.specific);
            if (w.updatedAt) return Promise.resolve(r.recent);
            return Promise.resolve(r.open);
          },
        ),
      findMany: vi.fn().mockResolvedValue([]),
    },
    projectMembership: { findMany: vi.fn().mockResolvedValue(members) },
    comment: { findMany: vi.fn().mockResolvedValue(opts.comment ?? [{ authorId: 'uB' }]) },
    issueHistory: { findMany: vi.fn().mockResolvedValue([]) },
  };
  const claude = {
    modelFast: 'fast-m',
    modelPrimary: 'primary-m',
    available: () => false,
    extract: vi.fn(),
    ...opts.claude,
  };
  return { svc: new AssigneeSuggestService(prisma as never, claude as never), prisma, claude };
}

describe('AssigneeSuggestService', () => {
  /**
   * A: specific 1/2 → 0.15; type 4/4 → 0.15; tải 5/5 → 0; chạm 0; gần đây 3/3 → 0.15            = 0.45
   * B: specific 2/2 → 0.30; type 4/4 → 0.15; tải 1/5 → 0.25*0.8=0.20; chạm 0.15; gần đây 3/3 0.15 = 0.95
   * C: không tín hiệu dương; tải 0 → 0.25                                                        = 0.25
   */
  it('heuristic: xếp đúng thứ tự theo điểm; lý do cụ thể có số', async () => {
    const { svc, claude, prisma } = make();
    const out = await svc.suggest('ws1', 'me', { projectId: 'p1', issueId: 'i1' });
    // Cả 4 lần đếm đều loại issue đã xoá mềm.
    expect(prisma.issue.groupBy).toHaveBeenCalledTimes(4);
    for (const c of prisma.issue.groupBy.mock.calls) {
      const w = (c[0] as { where: { deletedAt: null; id?: unknown } }).where;
      expect(w.deletedAt).toBeNull();
      expect(w.id).toEqual({ not: 'i1' }); // issue đang xét không tự tính vào tải/hoạt động/đã xử lý
    }
    expect(out.source).toBe('heuristic');
    expect('reason' in out).toBe(false);
    expect(out.suggestions.map((s) => s.userId)).toEqual(['uB', 'uA', 'uC']);
    expect(out.suggestions.map((s) => s.score)).toEqual([0.95, 0.45, 0.25]);
    const b = out.suggestions[0]!.reasons.join(' | ');
    expect(b).toMatch(/2 issue cùng nhãn\/thành phần/);
    expect(b).toMatch(/4 issue cùng loại “Bug”/);
    expect(b).toMatch(/3 issue trong 14 ngày/);
    expect(out.suggestions[0]!.displayName).toBe('Bình');
    expect(out.suggestions[2]!.reasons.join(' ')).toMatch(/Chưa có dữ liệu/);
    expect(claude.extract).not.toHaveBeenCalled(); // Claude không khả dụng → không gọi
  });

  it('ca smoke: ba người cùng tải 0, chỉ khác hoạt động gần đây => điểm KHÔNG hoà và lý do khác nhau', async () => {
    const { svc } = make({
      rows: {
        type: rows(['uA', 1], ['uB', 1], ['uC', 1]),
        specific: [],
        open: [],
        recent: rows(['uA', 5], ['uB', 2]),
      },
      comment: [], // không ai chạm issue liên quan
    });
    const out = await svc.suggest('ws1', 'me', { projectId: 'p1', issueId: 'i1' });
    const scores = out.suggestions.map((s) => s.score);
    expect(new Set(scores).size).toBe(3);
    expect(out.suggestions.map((s) => s.userId)).toEqual(['uA', 'uB', 'uC']);
    const reasons = out.suggestions.map((s) => s.reasons.join('|'));
    expect(new Set(reasons).size).toBe(3);
    expect(reasons[0]).toMatch(/5 issue trong 14 ngày/);
  });

  it('hoà hoàn toàn: ưu tiên ít việc dở hơn rồi tới tên (xác định, không phụ thuộc thứ tự DB)', async () => {
    const { svc } = make({ rows: { type: [], specific: [], open: [], recent: [] }, comment: [] });
    const out = await svc.suggest('ws1', 'me', { projectId: 'p1', issueId: 'i1' });
    expect(out.suggestions.map((s) => s.displayName)).toEqual(['An', 'Bình', 'Chi']);
  });

  it('issue không thuộc dự án trong body → 404', async () => {
    const { svc } = make({ issueRow: null });
    await expect(svc.suggest('ws1', 'me', { projectId: 'p1', issueId: 'i1' })).rejects.toThrow();
  });

  it('Claude: dùng model fast, ẩn danh u1..uN (không gửi email/id thật), map ngược và gộp reasons', async () => {
    // u1 = người điểm cao nhất (Bình), u2 = An
    const extract = vi.fn().mockResolvedValue({
      data: {
        ranking: [
          { id: 'u2', reason: 'Đã xử lý nhiều lỗi tương tự.' },
          { id: 'u1', reason: 'Đang rảnh hơn.' },
        ],
      },
    });
    const { svc } = make({ claude: { available: () => true, extract } });
    const out = await svc.suggest('ws1', 'me', { projectId: 'p1', issueId: 'i1' });
    const arg = extract.mock.calls[0]![0] as { model: string; ctx: unknown; prompt: string };
    expect(arg.prompt).toMatch(/u1/);
    expect(arg.model).toBe('fast-m');
    expect(arg.ctx).toEqual({ workspaceId: 'ws1', userId: 'me', feature: 'suggest-assignee' });
    for (const secret of ['secret.vn', 'uA', 'uB', 'uC']) expect(arg.prompt).not.toContain(secret);
    for (const col of ['giải_cùng_nhãn_thành_phần=', 'giải_cùng_loại=', 'hoạt_động_14_ngày='])
      expect(arg.prompt).toContain(col);
    expect(out.source).toBe('claude');
    expect(out.suggestions.map((s) => s.userId)).toEqual(['uA', 'uB']);
    expect(out.suggestions[0]!.reasons[0]).toBe('Đã xử lý nhiều lỗi tương tự.');
    expect(out.suggestions[0]!.reasons.length).toBeGreaterThan(1); // + lý do từ số liệu
    expect(out.suggestions[0]!.score).toBe(0.45); // điểm vẫn là điểm heuristic
  });

  it('Claude timeout → heuristic kèm reason', async () => {
    const extract = vi.fn().mockResolvedValue({ data: null, reason: 'timeout' });
    const out = await make({ claude: { available: () => true, extract } }).svc.suggest(
      'ws1',
      'me',
      { projectId: 'p1', issueId: 'i1' },
    );
    expect(out.source).toBe('heuristic');
    expect(out.reason).toBe('timeout');
    expect(out.suggestions[0]!.userId).toBe('uB');
  });

  it('Claude ném lỗi (hết hạn mức, khoá sai…) hoặc trả id lạ → vẫn trả heuristic, reason = error', async () => {
    const boom = vi.fn().mockRejectedValue(new Error('quota'));
    const a = await make({ claude: { available: () => true, extract: boom } }).svc.suggest(
      'ws1',
      'me',
      { projectId: 'p1', issueId: 'i1' },
    );
    expect(a.source).toBe('heuristic');
    expect(a.reason).toBe('error');

    const bogus = vi.fn().mockResolvedValue({ data: { ranking: [{ id: 'u99', reason: 'x' }] } });
    const b = await make({ claude: { available: () => true, extract: bogus } }).svc.suggest(
      'ws1',
      'me',
      { projectId: 'p1', issueId: 'i1' },
    );
    expect(b.source).toBe('heuristic');
    expect(b.reason).toBe('error');
  });
});
