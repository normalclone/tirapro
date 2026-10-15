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

/**
 * A: giải 4 issue tương tự nhưng đang ôm 5 issue mở, không đụng issue liên quan → 0.5*1 + 0.3*0 + 0 = 0.50
 * B: giải 2, ôm 1, có comment ở issue cha                                      → 0.5*0.5 + 0.3*0.8 + 0.2 = 0.69
 * C: chưa giải issue tương tự nào, rảnh                                        → 0 + 0.3 = 0.30
 */
function make(opts: { claude?: Record<string, unknown>; issueRow?: unknown } = {}) {
  const prisma = {
    issue: {
      findFirst: vi.fn().mockResolvedValue(opts.issueRow === undefined ? issue : opts.issueRow),
      groupBy: vi.fn().mockImplementation((args: { where: { status: { category: unknown } } }) =>
        Promise.resolve(
          args.where.status.category === 'DONE'
            ? [
                { assigneeId: 'uA', _count: { _all: 4 } },
                { assigneeId: 'uB', _count: { _all: 2 } },
              ]
            : [
                { assigneeId: 'uA', _count: { _all: 5 } },
                { assigneeId: 'uB', _count: { _all: 1 } },
              ],
        ),
      ),
      findMany: vi.fn().mockResolvedValue([]),
    },
    projectMembership: { findMany: vi.fn().mockResolvedValue(members) },
    comment: { findMany: vi.fn().mockResolvedValue([{ authorId: 'uB' }]) },
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
  it('heuristic: xếp đúng thứ tự theo điểm và có lý do bằng số liệu', async () => {
    const { svc, claude } = make();
    const out = await svc.suggest('ws1', 'me', { projectId: 'p1', issueId: 'i1' });
    expect(out.source).toBe('heuristic');
    expect('reason' in out).toBe(false);
    expect(out.suggestions.map((s) => s.userId)).toEqual(['uB', 'uA', 'uC']);
    expect(out.suggestions.map((s) => s.score)).toEqual([0.69, 0.5, 0.3]);
    expect(out.suggestions[0]!.reasons.join(' ')).toMatch(/2 issue tương tự/);
    expect(out.suggestions[0]!.displayName).toBe('Bình');
    expect(claude.extract).not.toHaveBeenCalled(); // Claude không khả dụng → không gọi
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
    expect(out.source).toBe('claude');
    expect(out.suggestions.map((s) => s.userId)).toEqual(['uA', 'uB']);
    expect(out.suggestions[0]!.reasons[0]).toBe('Đã xử lý nhiều lỗi tương tự.');
    expect(out.suggestions[0]!.reasons.length).toBeGreaterThan(1); // + lý do từ số liệu
    expect(out.suggestions[0]!.score).toBe(0.5); // điểm vẫn là điểm heuristic
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
