import { describe, expect, it, vi } from 'vitest';
import type { Prisma } from '@prisma/client';
import { parseJql } from '@tirapro/shared';
import { SearchService } from './search.service';

/* ----------------------------- bộ đánh giá `where` Prisma tối giản ----------------------------- */
type Row = Record<string, unknown>;
const OPS = ['equals', 'in', 'not', 'contains', 'gt', 'gte', 'lt', 'lte'];
const low = (v: unknown) => (typeof v === 'string' ? v.toLowerCase() : v);
const str = (v: unknown): string => (typeof v === 'string' ? v.toLowerCase() : '');

function opMatch(val: unknown, cond: Record<string, unknown>): boolean {
  return Object.entries(cond).every(([op, arg]) => {
    if (op === 'mode') return true;
    if (op === 'equals') return low(val) === low(arg);
    if (op === 'in') return (arg as unknown[]).map(low).includes(low(val));
    if (op === 'not') return low(val) !== low(arg);
    if (op === 'contains') return str(val).includes(str(arg));
    if (op === 'gt') return Number(val) > Number(arg);
    return true;
  });
}
function fieldMatch(val: unknown, cond: unknown): boolean {
  if (cond === null || typeof cond !== 'object' || cond instanceof Date) return val === cond;
  const c = cond as Record<string, unknown>;
  if ('some' in c)
    return Array.isArray(val) && val.some((x) => matches(x as Row, c.some as object));
  if (Object.keys(c).some((k) => OPS.includes(k))) return opMatch(val, c);
  return val != null && matches(val as Row, c);
}
function matches(row: Row, where: object): boolean {
  return Object.entries(where as Record<string, unknown>).every(([k, v]) => {
    if (v === undefined) return true;
    if (k === 'AND') return (v as object[]).every((w) => matches(row, w));
    if (k === 'OR') return (v as object[]).some((w) => matches(row, w));
    if (k === 'NOT') return !matches(row, v as object);
    return fieldMatch(row[k], v);
  });
}

/* ----------------------------------------- dữ liệu mẫu ----------------------------------------- */
const pub = { deletedAt: null, isPrivate: false, memberships: [] as unknown[] };
const priv = { deletedAt: null, isPrivate: true, memberships: [{ userId: 'U9' }] };
const gone = { deletedAt: new Date(), isPrivate: false, memberships: [] as unknown[] };
const issue = (
  id: string,
  status: string,
  priority: string,
  project: object,
  extra: Row = {},
): Row => ({
  id,
  workspaceId: 'W1',
  deletedAt: null,
  projectId: (project as { isPrivate: boolean }).isPrivate ? 'PRIV' : 'PUB',
  status: { name: status },
  priority: { name: priority },
  assigneeId: 'U1',
  project,
  ...extra,
});

/** Việc người xem (U1) thấy được. */
const VISIBLE: Row[] = [
  issue('V1', 'Open', 'High', pub),
  issue('V2', 'Done', 'Low', pub),
  issue('V3', 'Open', 'Low', pub, { assigneeId: 'U2' }),
];
/** Việc người xem KHÔNG được tính: dự án riêng tư không thấy, dự án đã xoá, việc đã xoá, workspace khác. */
const HIDDEN: Row[] = [
  issue('H1', 'Open', 'High', priv),
  issue('H2', 'Done', 'Low', priv),
  issue('H3', 'Done', 'Low', gone),
  issue('H4', 'Open', 'High', pub, { deletedAt: new Date() }),
  issue('H5', 'Done', 'Low', pub, { workspaceId: 'W2' }),
  issue('H6', 'Done', 'Low', priv, { assigneeId: 'U1' }),
];

/* ---------------------------------------- dựng service ---------------------------------------- */
interface Opts {
  rows?: Row[];
  /** Quyền xem của U1 (mặc định: công khai hoặc thành viên). */
  visible?: Prisma.ProjectWhereInput;
  countImpl?: (where: object, n: number) => Promise<number>;
}
function make(opts: Opts = {}) {
  const rows = opts.rows ?? [...VISIBLE, ...HIDDEN];
  const state = { live: 0, peak: 0, calls: 0 };
  const counts: object[] = [];
  const order: string[] = [];
  const tx = {
    $executeRaw: vi.fn((sql: { sql: string }) => {
      order.push(`raw:${sql.sql}`);
      return Promise.resolve(0);
    }),
    issue: {
      count: vi.fn(async ({ where }: { where: object }) => {
        order.push('count');
        counts.push(where);
        const n = state.calls++;
        state.live++;
        state.peak = Math.max(state.peak, state.live);
        try {
          await new Promise<void>((r) => setTimeout(r, 2));
          if (opts.countImpl) return await opts.countImpl(where, n);
          return rows.filter((r) => matches(r, where)).length;
        } finally {
          state.live--;
        }
      }),
    },
  };
  const names = (...n: string[]) => vi.fn().mockResolvedValue(n.map((name) => ({ name })));
  const prisma = {
    $transaction: vi.fn((fn: (t: typeof tx) => Promise<unknown>, o?: unknown) => {
      order.push(`tx:${JSON.stringify(o)}`);
      return fn(tx);
    }),
    issue: { count: vi.fn() }, // đọc ngoài giao dịch = lỗi (phải đi qua tx có statement_timeout)
    project: { findMany: vi.fn().mockResolvedValue([{ id: 'PUB' }]) },
    status: { findMany: names('Open', 'Done', 'Closed') },
    priority: { findMany: names('High', 'Low') },
    issueType: { findMany: names('Bug', 'Story') },
    sprint: { findMany: names() },
  };
  const visible = opts.visible ?? {
    OR: [{ isPrivate: false }, { memberships: { some: { userId: 'U1' } } }],
  };
  const access = {
    visibleWhere: vi.fn().mockResolvedValue(visible),
    visibleProjectIds: vi.fn().mockResolvedValue(null),
  };
  const service = new SearchService({} as never, prisma as never, access as never);
  const fulltextSearch = vi.fn().mockResolvedValue({ ids: ['I1'] });
  (service as unknown as { fulltext: unknown }).fulltext = { search: fulltextSearch };
  return { service, prisma, tx, access, state, counts, order, fulltextSearch };
}

/** Phạm vi (workspace/dự án/quyền xem) trong `where` mà relaxCounts gửi cho `issue.count`. */
const scopeOf = (where: object): object =>
  (where as { AND: [{ AND: [object, object] }] }).AND[0].AND[0];

const run = (s: SearchService, jql: string, projectId?: string) =>
  s.relaxCounts('W1', 'U1', { jql, projectId });

/* ------------------------------------------------ test ------------------------------------------------ */
describe('SearchService.relaxCounts', () => {
  it('đếm khi bỏ từng mệnh đề: text + jqlWithout + count', async () => {
    const { service } = make();
    const r = await run(service, 'status = Open AND priority = Low');
    expect(r).toEqual({
      remaining: 0,
      clauses: [
        { text: 'status = "Open"', jqlWithout: 'priority = "Low"', count: 2 }, // V2, V3
        { text: 'priority = "Low"', jqlWithout: 'status = "Open"', count: 2 }, // V1, V3
      ],
    });
  });

  it('jqlWithout giữ ORDER BY và parse lại được', async () => {
    const { service } = make();
    const r = await run(service, 'status = Done AND priority = High ORDER BY created DESC');
    for (const c of r.clauses) {
      expect(c.jqlWithout).toMatch(/ORDER BY created DESC$/);
      expect(() => parseJql(c.jqlWithout)).not.toThrow();
    }
  });

  it('currentUser() dùng đúng người xem', async () => {
    const { service } = make();
    // Bỏ assignee → V3; bỏ status → V2; bỏ priority → V1.
    const r = await run(service, 'assignee = currentUser() AND status = Open AND priority = Low');
    expect(r.clauses.map((c) => c.count)).toEqual([1, 1, 1]);
  });
});

describe('SearchService.relaxCounts — RIÊNG TƯ (cùng bộ lọc xem như count())', () => {
  it('việc ở dự án riêng tư người xem không thấy / dự án đã xoá / việc đã xoá / workspace khác không đổi bất kỳ số đếm nào', async () => {
    const withHidden = await run(make().service, 'status = Open AND priority = Low');
    const onlyVisible = await run(
      make({ rows: VISIBLE }).service,
      'status = Open AND priority = Low',
    );
    expect(withHidden).toEqual(onlyVisible);
    // Chứng minh bài kiểm không rỗng: bỏ lọc quyền thì số đếm SẼ khác.
    const leaky = await run(make({ visible: {} }).service, 'status = Open AND priority = Low');
    expect(leaky.clauses.map((c) => c.count)).not.toEqual(withHidden.clauses.map((c) => c.count));
  });

  it('mọi truy vấn đếm đều mang điều kiện workspace + deletedAt + dự án chưa xoá + visibleWhere', async () => {
    const { service, counts, access } = make();
    await run(service, 'status = Open AND priority = Low AND labels = x');
    expect(access.visibleWhere).toHaveBeenCalledWith('U1', 'W1');
    expect(counts.length).toBe(3); // đúng 3 mệnh đề, không có truy vấn tổng
    for (const where of counts) {
      expect((where as { deletedAt: null }).deletedAt).toBeNull(); // chốt chặn tầng thấp nhất
      expect(scopeOf(where)).toEqual({
        workspaceId: 'W1',
        deletedAt: null,
        project: {
          deletedAt: null,
          OR: [{ isPrivate: false }, { memberships: { some: { userId: 'U1' } } }],
        },
      });
    }
  });

  it('projectId trong body được ghép vào mọi số đếm (khớp phạm vi tìm kiếm)', async () => {
    const { service, counts } = make();
    await run(service, 'status = Open AND priority = Low', 'PUB');
    for (const where of counts) {
      expect(JSON.stringify(scopeOf(where))).toContain('"projectId":"PUB"');
    }
  });

  it('JQL toàn dự án riêng tư người xem không thấy → mọi số đếm 0 (không lộ "có N việc")', async () => {
    const { service } = make({ rows: HIDDEN });
    const r = await run(service, 'status = Done AND priority = Low');
    expect(r.clauses.map((c) => c.count)).toEqual([0, 0]);
  });
});

describe('SearchService.relaxCounts — mệnh đề', () => {
  it('một mệnh đề → không có gì để nới: không chạm DB đếm', async () => {
    const { service, tx } = make();
    expect(await run(service, 'status = Open')).toEqual({
      clauses: [],
      remaining: 0,
    });
    expect(tx.issue.count).not.toHaveBeenCalled();
  });

  it('OR ở gốc, hoặc NOT, là MỘT mệnh đề', async () => {
    const { service, tx } = make();
    expect((await run(service, 'status = Open OR priority = Low')).clauses).toEqual([]);
    expect((await run(service, 'NOT (status = Open AND priority = Low)')).clauses).toEqual([]);
    expect(tx.issue.count).not.toHaveBeenCalled();
  });

  it('nhóm OR lồng trong chuỗi AND là một mệnh đề; bỏ nó giữ phần còn lại', async () => {
    const { service } = make();
    const r = await run(service, 'priority = Low AND (status = Open OR status = Done)');
    expect(r.clauses.map((c) => c.text)).toEqual([
      'priority = "Low"',
      'status = "Open" OR status = "Done"',
    ]);
    expect(r.clauses[0]!.jqlWithout).toBe('status = "Open" OR status = "Done"');
    expect(r.clauses[1]!.jqlWithout).toBe('priority = "Low"');
  });

  it('quá 8 mệnh đề: chỉ đếm 8 đầu, remaining = phần dư; jqlWithout vẫn chứa cả các mệnh đề sau', async () => {
    const { service, counts } = make();
    const jql = Array.from({ length: 11 }, (_, i) => `summary ~ "t${i}"`).join(' AND ');
    const r = await run(service, jql);
    expect(r.clauses).toHaveLength(8);
    expect(r.remaining).toBe(3);
    expect(counts).toHaveLength(8);
    expect(r.clauses[0]!.jqlWithout.match(/summary/g)).toHaveLength(10);
    expect(r.clauses[0]!.jqlWithout).toContain('"t10"');
  });

  it('đúng 8 mệnh đề → remaining 0', async () => {
    const { service } = make();
    const jql = Array.from({ length: 8 }, (_, i) => `summary ~ "t${i}"`).join(' AND ');
    const r = await run(service, jql);
    expect(r.clauses).toHaveLength(8);
    expect(r.remaining).toBe(0);
  });
});

describe('SearchService.relaxCounts — hiệu năng & an toàn', () => {
  it('đồng thời tối đa 2 trong một request', async () => {
    const { service, state } = make();
    const jql = Array.from({ length: 8 }, (_, i) => `summary ~ "t${i}"`).join(' AND ');
    await run(service, jql);
    expect(state.peak).toBeLessThanOrEqual(2); // mỗi request tối đa 2 (trên trần toàn tiến trình 3)
    expect(state.peak).toBeGreaterThan(1);
  });

  it('mỗi số đếm nằm trong giao dịch và SET LOCAL statement_timeout = 3000 chạy TRƯỚC khi đếm', async () => {
    const { service, order, prisma } = make();
    await run(service, 'status = Open AND priority = Low');
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(prisma.issue.count).not.toHaveBeenCalled(); // không đếm ngoài giao dịch
    // Mỗi giao dịch: tx → raw → count (các giao dịch có thể xen kẽ, nên kiểm theo từng đoạn)
    expect(order.filter((o) => o.startsWith('raw:'))).toEqual(
      Array(2).fill('raw:SET LOCAL statement_timeout = 3000'),
    );
    expect(order.indexOf('count')).toBeGreaterThan(order.findIndex((o) => o.startsWith('raw:')));
  });

  it('quá hạn (57014) ở một mệnh đề → count null cho mệnh đề đó, các mệnh đề khác vẫn có số', async () => {
    const timeout = Object.assign(new Error('canceling statement due to statement timeout'), {
      code: 'P2010',
      meta: { code: '57014' },
    });
    const { service } = make({
      // lần đếm thứ 2 (mệnh đề thứ hai) hết hạn
      countImpl: (where, n) => (n === 1 ? Promise.reject(timeout) : Promise.resolve(5)),
    });
    const r = await run(service, 'status = Open AND priority = Low');
    expect(r.clauses.map((c) => c.count)).toEqual([5, null]);
  });

  it('Prisma báo timeout dạng PrismaClientUnknownRequestError (đếm theo model) cũng thành null', async () => {
    const e = new Error(
      'Error occurred during query execution: PostgresError { code: "57014", message: "canceling statement due to statement timeout" }',
    );
    const { service } = make({
      countImpl: (_w, n) => (n === 0 ? Promise.reject(e) : Promise.resolve(2)),
    });
    const r = await run(service, 'status = Open AND priority = Low');
    expect(r.clauses.map((c) => c.count)).toEqual([null, 2]);
  });

  it('lỗi KHÔNG phải timeout vẫn ném (không nuốt lỗi thật)', async () => {
    const { service } = make({
      countImpl: () => Promise.reject(new Error('connection refused')),
    });
    await expect(run(service, 'status = Open AND priority = Low')).rejects.toThrow(
      'connection refused',
    );
  });

  it('full-text chỉ tra MỘT lần cho cả cuộc gọi và dùng lại cho mọi mệnh đề', async () => {
    const { service, fulltextSearch, counts } = make();
    await run(service, 'text ~ "lỗi" AND status = Open AND priority = Low');
    expect(fulltextSearch).toHaveBeenCalledTimes(1);
    // Bỏ `status` → vẫn còn điều kiện full-text trong where; bỏ `text` → không còn.
    const json = counts.map((w) => JSON.stringify(w));
    expect(json.filter((j) => j.includes('"id":{"in":["I1"]}'))).toHaveLength(2); // bỏ status + bỏ priority (bỏ text thì không còn)
  });
});

describe('SearchService.relaxCounts — JQL không hợp lệ', () => {
  it('lỗi cú pháp → cùng thông điệp 422 như /search', async () => {
    const { service, tx } = make();
    await expect(run(service, 'status = ')).rejects.toMatchObject({ status: 422 });
    await expect(run(service, 'status = ')).rejects.toThrow(/JQL không hợp lệ/);
    expect(tx.issue.count).not.toHaveBeenCalled();
  });
  it('giá trị không có thật (status = Nope) → 422 "ý bạn là" như /search', async () => {
    const { service, tx } = make();
    await expect(run(service, 'status = Opn AND priority = Low')).rejects.toThrow(
      /ý bạn là "Open"/,
    );
    expect(tx.issue.count).not.toHaveBeenCalled();
  });
});

/** Một lời gọi đếm "treo" cho tới khi `releaseAll()`; việc khác trả ngay. */
function hangingCounts() {
  const resolvers: Array<() => void> = [];
  return {
    countImpl: (where: object): Promise<number> =>
      JSON.stringify(where).includes('hang')
        ? new Promise<number>((res) => resolvers.push(() => res(7)))
        : Promise.resolve(1),
    releaseAll: () => resolvers.splice(0).forEach((r) => r()),
    held: () => resolvers.length,
  };
}
const MANY = (tag: string, n: number) =>
  Array.from({ length: n }, (_, i) => `summary ~ "${tag}${i}"`).join(' AND ');

describe('SearchService.relaxCounts — trần TOÀN TIẾN TRÌNH (mọi request)', () => {
  it('4 request đồng thời × 8 mệnh đề: tổng đếm cùng lúc không quá 3', async () => {
    const shared = { live: 0, peak: 0 };
    const makeOne = () => {
      const m = make({
        countImpl: async () => {
          shared.live++;
          shared.peak = Math.max(shared.peak, shared.live);
          await new Promise((r) => setTimeout(r, 3));
          shared.live--;
          return 1;
        },
      });
      return m.service;
    };
    const results = await Promise.all(
      Array.from({ length: 4 }, (_, i) => run(makeOne(), MANY(`t${i}x`, 8))),
    );
    expect(results.every((r) => r.clauses.every((c) => c.count === 1))).toBe(true);
    expect(shared.peak).toBeLessThanOrEqual(3);
    expect(shared.peak).toBe(3);
  });

  it('hết hạn tổng ~5 giây: đếm chưa kịp bắt đầu trả null (không chờ chỗ vô hạn); đã bắt đầu thì vẫn trả số', async () => {
    vi.useFakeTimers();
    try {
      const hang = hangingCounts();
      // Hai request treo chiếm đủ 3 chỗ toàn tiến trình (2 + 1).
      const a = run(make({ countImpl: hang.countImpl }).service, MANY('hangA', 4));
      const a2 = run(make({ countImpl: hang.countImpl }).service, MANY('hangB', 4));
      await vi.advanceTimersByTimeAsync(20);
      expect(hang.held()).toBe(3);
      // Request thứ ba không có chỗ: chờ rồi hết hạn → toàn null.
      const c = run(make().service, MANY('free', 3));
      await vi.advanceTimersByTimeAsync(4_900);
      let settled = false;
      void c.then(() => (settled = true));
      await vi.advanceTimersByTimeAsync(10);
      expect(settled).toBe(false); // chưa tới hạn
      await vi.advanceTimersByTimeAsync(200);
      expect((await c).clauses.map((x) => x.count)).toEqual([null, null, null]);
      // Nhả các việc treo: chúng vẫn ra số, và chỗ được trả lại.
      hang.releaseAll();
      await vi.advanceTimersByTimeAsync(20);
      hang.releaseAll();
      await vi.advanceTimersByTimeAsync(20);
      hang.releaseAll();
      await vi.advanceTimersByTimeAsync(2_000);
      const [ra, rb] = await Promise.all([a, a2]);
      expect(ra.clauses.some((x) => x.count === 7)).toBe(true);
      expect(rb.clauses.length).toBe(4);
    } finally {
      vi.useRealTimers();
    }
    // Sau tất cả, không rò chỗ: một request mới chạy bình thường, đủ số.
    const after = await run(make().service, MANY('after', 4));
    expect(after.clauses.map((x) => x.count)).toEqual(
      [1, 1, 1, 1].map(() => expect.any(Number) as number),
    );
  });

  it('nhả chỗ cả khi đếm ném lỗi thật: request kế tiếp không bị kẹt', async () => {
    const bad = make({ countImpl: () => Promise.reject(new Error('connection refused')) });
    for (let i = 0; i < 5; i++) {
      await expect(run(bad.service, MANY(`e${i}x`, 4))).rejects.toThrow('connection refused');
    }
    const ok = await run(make().service, MANY('ok', 8));
    expect(ok.clauses).toHaveLength(8);
    expect(ok.clauses.every((c) => c.count !== null)).toBe(true);
  });

  it('nhả chỗ cả khi đếm quá hạn (count null)', async () => {
    const timeout = Object.assign(new Error('x'), { code: 'P2010', meta: { code: '57014' } });
    const slow = make({ countImpl: () => Promise.reject(timeout) });
    for (let i = 0; i < 5; i++) {
      const r = await run(slow.service, MANY(`s${i}x`, 4));
      expect(r.clauses.every((c) => c.count === null)).toBe(true);
    }
    const ok = await run(make().service, MANY('ok2', 8));
    expect(ok.clauses.every((c) => c.count !== null)).toBe(true);
  });
});

describe('SearchService.relaxCounts — nhận diện timeout hẹp', () => {
  const failWith = (e: Error) =>
    run(make({ countImpl: () => Promise.reject(e) }).service, 'status = Open AND priority = Low');

  it('"canceling statement due to statement timeout" và meta.code 57014 và P2028 → null', async () => {
    const a = await failWith(new Error('ERROR: canceling statement due to statement timeout'));
    expect(a.clauses.map((c) => c.count)).toEqual([null, null]);
    const b = await failWith(Object.assign(new Error('x'), { meta: { code: '57014' } }));
    expect(b.clauses.map((c) => c.count)).toEqual([null, null]);
    const c = await failWith(Object.assign(new Error('x'), { code: 'P2028' }));
    expect(c.clauses.map((x) => x.count)).toEqual([null, null]);
    const d = await failWith(new Error('PostgresError { code: "57014", message: "boom" }'));
    expect(d.clauses.map((x) => x.count)).toEqual([null, null]);
  });
  it('lỗi KHÁC có chứa "57014" hoặc "statement timeout" (cổng, tham số) vẫn ném', async () => {
    await expect(failWith(new Error('connect ECONNREFUSED 127.0.0.1:57014'))).rejects.toThrow(
      'ECONNREFUSED',
    );
    await expect(failWith(new Error('port 570145 refused'))).rejects.toThrow('570145');
    await expect(failWith(new Error('invalid statement timeout setting'))).rejects.toThrow(
      'invalid statement timeout',
    );
  });
});
