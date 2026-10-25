import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Prisma } from '@prisma/client';
import type { PreviewMatchInput } from '@tirapro/shared';
import { boundedCountSlotsSemaphore } from '../../common/bounded-count';
import { countSelected, type Row } from '../../common/testing/where-matcher';
import { RulePreviewService } from './rule-preview.service';

afterEach(() => vi.useRealTimers());

/* --------------------------------- dữ liệu mẫu (đánh giá bằng where-matcher) --------------------------------- */
const pubProject = {
  deletedAt: null,
  archivedAt: null,
  isPrivate: false,
  memberships: [] as unknown[],
};
const mine = { ...pubProject, isPrivate: true, memberships: [{ userId: 'U1' }] }; // riêng tư nhưng U1 là thành viên
const secret = { ...pubProject, isPrivate: true, memberships: [{ userId: 'U9' }] }; // riêng tư, U1 KHÔNG thấy
const deletedProject = { ...pubProject, deletedAt: new Date() };
const archivedProject = { ...pubProject, archivedAt: new Date() };

const issue = (id: string, project: object, extra: Row = {}): Row => ({
  id,
  workspaceId: 'W1',
  deletedAt: null,
  project,
  projectId: project === secret ? 'SEC' : project === mine ? 'MINE' : 'PUB',
  statusId: 's1',
  priorityId: 'p1',
  priority: { name: 'High' },
  assigneeId: null,
  summary: 'x',
  labels: [],
  ...extra,
});
const VISIBLE: Row[] = [
  issue('V1', pubProject),
  issue('V2', pubProject, { statusId: 's2' }),
  issue('V3', mine),
  issue('V4', pubProject, { assigneeId: 'U1' }),
  issue('V5', pubProject, { assigneeId: 'SYS' }),
  issue('V6', pubProject, { assigneeId: 'SYS' }),
];
const HIDDEN: Row[] = [
  issue('H1', secret), // dự án riêng tư người soạn không thấy
  issue('H2', secret, { statusId: 's2' }),
  issue('H3', pubProject, { deletedAt: new Date() }), // issue xoá mềm
  issue('H4', deletedProject), // dự án xoá mềm
  issue('H5', archivedProject), // dự án lưu trữ: quy tắc không chạy
  issue('H6', pubProject, { workspaceId: 'W2' }),
  issue('H7', secret, { assigneeId: 'SYS' }),
];

interface Opts {
  rows?: Row[];
  visible?: Prisma.ProjectWhereInput;
  countImpl?: () => Promise<number>;
}
function make(opts: Opts = {}) {
  const rows = opts.rows ?? [...VISIBLE, ...HIDDEN];
  const counts: object[] = [];
  const tx = {
    $executeRaw: vi.fn().mockResolvedValue(0),
    issue: {
      count: vi.fn(({ where }: { where: object }) => {
        counts.push(where);
        return opts.countImpl ? opts.countImpl() : Promise.resolve(countSelected(rows, where));
      }),
    },
  };
  const prisma = {
    $transaction: vi.fn((fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    user: { findUnique: vi.fn().mockResolvedValue({ id: 'SYS' }) },
  };
  const visible = opts.visible ?? {
    OR: [{ isPrivate: false }, { memberships: { some: { userId: 'U1' } } }],
  };
  const access = { visibleWhere: vi.fn().mockResolvedValue(visible) };
  return {
    service: new RulePreviewService(prisma as never, access as never),
    prisma,
    tx,
    access,
    counts,
  };
}
const run = (s: RulePreviewService, input: PreviewMatchInput) => s.previewMatch('W1', 'U1', input);
const status = (v: string) => ({ field: 'statusId', op: 'eq', value: v }) as const;

/* ------------------------------------------------------------------------------------------------------------- */
describe('RulePreviewService — riêng tư và phạm vi', () => {
  it('chỉ đếm theo quyền xem của NGƯỜI SOẠN: dự án riêng tư không thấy / xoá mềm / lưu trữ / issue xoá / workspace khác không vào số đếm', async () => {
    const withHidden = await run(make().service, { conditions: [status('s1')] });
    const onlyVisible = await run(make({ rows: VISIBLE }).service, { conditions: [status('s1')] });
    expect(withHidden).toEqual(onlyVisible);
    expect(withHidden.count).toBe(5); // V1, V3 (dự án riêng tư mà U1 là thành viên), V4, V5, V6
    // Kiểm chứng ngược: bỏ lọc quyền xem thì số đếm SẼ khác (bài kiểm không rỗng).
    const leaky = await run(make({ visible: {} }).service, { conditions: [status('s1')] });
    expect(leaky.count).toBeGreaterThan(withHidden.count as number);
  });

  it('mọi lần đếm mang đủ: workspace + deletedAt + dự án chưa xoá/chưa lưu trữ + visibleWhere(người soạn)', async () => {
    const { service, counts, access } = make();
    await run(service, { conditions: [status('s1')] });
    expect(access.visibleWhere).toHaveBeenCalledWith('U1', 'W1');
    expect(counts).toHaveLength(1);
    // `boundedIssueCount` bọc thêm `{ deletedAt: null, AND: [where] }` làm chốt chặn tầng thấp nhất.
    const outer = counts[0] as { deletedAt: null; AND: Record<string, unknown>[] };
    expect(outer.deletedAt).toBeNull();
    const where = outer.AND[0]!;
    expect(where).toMatchObject({
      workspaceId: 'W1',
      deletedAt: null,
      project: {
        deletedAt: null,
        archivedAt: null,
        OR: [{ isPrivate: false }, { memberships: { some: { userId: 'U1' } } }],
      },
    });
    expect(where).not.toHaveProperty('projectId');
  });

  it('quy tắc cấp dự án: thêm projectId; cấp workspace: không', async () => {
    const ws = await run(make().service, { conditions: [status('s1')] });
    const proj = await run(make().service, { projectId: 'PUB', conditions: [status('s1')] });
    expect(ws.count).toBe(5);
    expect(proj.count).toBe(4); // bỏ V3 (dự án MINE)
  });

  it('dự án riêng tư người soạn không thấy → 0, không lộ "có N việc"', async () => {
    const r = await run(make({ rows: HIDDEN }).service, { conditions: [status('s1')] });
    expect(r.count).toBe(0);
  });

  it('không điều kiện = mọi việc trong phạm vi nhìn thấy (không chạm quyền hệ thống)', async () => {
    const r = await run(make().service, { conditions: [] });
    expect(r.count).toBe(VISIBLE.length);
  });
});

describe('RulePreviewService — điều kiện', () => {
  it('nhiều điều kiện trường nối bằng VÀ, đúng như engine', async () => {
    const r = await run(make().service, {
      conditions: [status('s1'), { field: 'assigneeId', op: 'notEmpty' }],
    });
    expect(r.count).toBe(3); // V4 (U1), V5, V6 (SYS)
  });

  it('điều kiện JQL: compile như engine; currentUser() = NGƯỜI DÙNG HỆ THỐNG, không phải người soạn; kèm cờ cảnh báo', async () => {
    const { service, prisma } = make();
    const r = await run(service, { conditions: [{ jql: 'assignee = currentUser()' }] });
    expect(prisma.user.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { email: 'automation@tirapro.local' } }),
    );
    expect(r.count).toBe(2); // V5, V6 (gán cho SYS); V4 gán cho người soạn U1 KHÔNG được đếm; H7 ẩn
    expect(r.currentUserInJql).toBe(true);
  });

  it('JQL không dùng currentUser → không cờ; trộn JQL + điều kiện trường', async () => {
    const r = await run(make().service, {
      conditions: [{ jql: 'priority = High' }, status('s2')],
    });
    expect(r.currentUserInJql).toBe(false);
    expect(r.count).toBe(1); // V2
  });

  it('chỉ tra người dùng hệ thống khi có điều kiện JQL', async () => {
    const { service, prisma } = make();
    await run(service, { conditions: [status('s1')] });
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('alias `me` cũng bị cảnh báo', async () => {
    const r = await run(make().service, { conditions: [{ jql: 'reporter = me' }] });
    expect(r.currentUserInJql).toBe(true);
  });

  it('JQL sai cú pháp → count null + lý do, không đếm', async () => {
    const { service, tx } = make();
    const r = await run(service, { conditions: [{ jql: 'status = ' }] });
    expect(r.count).toBeNull();
    expect(r.reason).toMatch(/JQL không hợp lệ/);
    expect(r.timedOut).toBe(false);
    expect(tx.issue.count).not.toHaveBeenCalled();
  });

  it('điều kiện không diễn đạt chính xác được (dueDate contains) → count null "không xem trước được điều kiện này", KHÔNG xấp xỉ', async () => {
    const { service, tx } = make();
    const r = await run(service, {
      conditions: [status('s1'), { field: 'dueDate', op: 'contains', value: '2026-10' }],
    });
    expect(r).toEqual({
      count: null,
      reason: 'không xem trước được điều kiện này',
      timedOut: false,
      currentUserInJql: false,
    });
    expect(tx.issue.count).not.toHaveBeenCalled();
  });
});

describe('RulePreviewService — tài nguyên', () => {
  it('SET LOCAL statement_timeout + quá hạn → count null, timedOut', async () => {
    const timeout = Object.assign(new Error('x'), { code: 'P2010', meta: { code: '57014' } });
    const { service, tx } = make({ countImpl: () => Promise.reject(timeout) });
    const r = await run(service, { conditions: [status('s1')] });
    expect(r).toMatchObject({ count: null, timedOut: true, reason: null });
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect((tx.$executeRaw.mock.calls[0] as unknown as [{ sql: string }])[0].sql).toBe(
      'SET LOCAL statement_timeout = 3000',
    );
  });

  it('lỗi KHÔNG phải timeout (kể cả có "57014" trong cổng) vẫn ném', async () => {
    const { service } = make({
      countImpl: () => Promise.reject(new Error('connect ECONNREFUSED 127.0.0.1:57014')),
    });
    await expect(run(service, { conditions: [status('s1')] })).rejects.toThrow('ECONNREFUSED');
  });

  it('dùng CHUNG trần kết nối với gợi ý nới bộ lọc: hết mọi chỗ thì chờ ~5s rồi count null (không chờ vô hạn)', async () => {
    vi.useFakeTimers();
    const sem = boundedCountSlotsSemaphore();
    const held = await Promise.all(
      Array.from({ length: sem.capacity }, () => sem.acquire(Date.now() + 1e6)),
    );
    const { service, tx } = make();
    const p = run(service, { conditions: [status('s1')] });
    await vi.advanceTimersByTimeAsync(4_900);
    expect(tx.issue.count).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(200);
    expect(await p).toMatchObject({ count: null, timedOut: true });
    held.forEach((r) => r!());
    // chỗ đã trả: lần sau đếm bình thường
    vi.useRealTimers();
    expect((await run(make().service, { conditions: [status('s1')] })).count).toBe(5);
  });
});

describe('RulePreviewService — đầu vào Postgres không nhận được', () => {
  it('ký tự NUL ở giá trị / khoá / JQL → count:null + lý do, KHÔNG chạm DB (không phải lỗi 500)', async () => {
    const bad = [
      { field: 'summary', op: 'contains', value: 'a\u0000b' },
      { field: 'summary', op: 'in', value: ['ok', 'a\u0000'] },
      { field: 'summary', op: 'eq', value: { a: ['x\u0000'] } },
      { jql: 'text ~ "a\u0000b"' },
    ];
    for (const c of bad) {
      const { service, tx } = make();
      const r = await run(service, { conditions: [c as never] });
      expect(r).toMatchObject({ count: null, timedOut: false });
      expect(r.reason).toMatch(/không hợp lệ/);
      expect(tx.issue.count).not.toHaveBeenCalled();
    }
  });

  it('contains với chữ gấp-hoa-thường không chắc chắn (İ, Hy Lạp…) → count:null + lý do, không đếm', async () => {
    const { service, tx } = make();
    const r = await run(service, {
      conditions: [{ field: 'summary', op: 'contains', value: 'ΟΔΟΣ' }],
    });
    expect(r).toMatchObject({ count: null, timedOut: false });
    expect(r.reason).toBe('không xem trước được điều kiện này (chỉ hỗ trợ chữ Latin)');
    expect(tx.issue.count).not.toHaveBeenCalled();
  });

  it('lý do chỉ gợi "chữ Latin" khi nguyên nhân là chữ; `dueDate contains` giữ lý do chung', async () => {
    const { service } = make();
    const r = await run(service, {
      conditions: [{ field: 'dueDate', op: 'contains', value: '2026' }],
    });
    expect(r).toMatchObject({ count: null, reason: 'không xem trước được điều kiện này' });
  });
});
