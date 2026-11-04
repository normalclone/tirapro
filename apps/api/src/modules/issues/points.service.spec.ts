import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_POINTS_FORMULA, type PointsFormula } from '@tirapro/shared';
import { PointsService } from './points.service';

const CUSTOM: PointsFormula = {
  ...DEFAULT_POINTS_FORMULA,
  base: { ...DEFAULT_POINTS_FORMULA.base, BUG: 5 },
};

function make(row: { formula: unknown } | null = null) {
  const config = {
    findUnique: vi.fn(() => Promise.resolve(row)),
    upsert: vi.fn(() => Promise.resolve({})),
  };
  const service = new PointsService({ pointsFormulaConfig: config } as never);
  return { service, config };
}

describe('PointsService.getFormula', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('không có dòng cấu hình => bảng mặc định', async () => {
    const { service } = make(null);
    expect(await service.getFormula()).toEqual(DEFAULT_POINTS_FORMULA);
  });
  it('đọc bảng đã lưu; cache trong bộ nhớ (không truy vấn lại trong TTL), hết TTL thì đọc lại', async () => {
    const { service, config } = make({ formula: CUSTOM });
    expect(await service.getFormula()).toEqual(CUSTOM);
    await service.getFormula();
    expect(config.findUnique).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(31_000);
    await service.getFormula();
    expect(config.findUnique).toHaveBeenCalledTimes(2);
  });
  it('các lần đọc đồng thời gộp thành một truy vấn', async () => {
    const { service, config } = make({ formula: CUSTOM });
    await Promise.all([service.getFormula(), service.getFormula(), service.getFormula()]);
    expect(config.findUnique).toHaveBeenCalledTimes(1);
  });
  it('dòng cấu hình hỏng (hệ số <= 0) => rơi về mặc định thay vì tính điểm sai', async () => {
    const bad = { ...CUSTOM, base: { ...CUSTOM.base, BUG: 0 } };
    const { service } = make({ formula: bad });
    expect(await service.getFormula()).toEqual(DEFAULT_POINTS_FORMULA);
  });
  it('setFormula ghi (upsert) rồi làm mới cache NGAY, không đợi hết TTL', async () => {
    const { service, config } = make(null);
    await service.getFormula();
    await service.setFormula(CUSTOM, 'sa1');
    expect(config.upsert).toHaveBeenCalledWith({
      where: { id: 'default' },
      create: { id: 'default', formula: CUSTOM, updatedById: 'sa1' },
      update: { formula: CUSTOM, updatedById: 'sa1' },
    });
    expect(await service.getFormula()).toEqual(CUSTOM);
    expect(config.findUnique).toHaveBeenCalledTimes(1);
  });
  it('setFormula từ chối hệ số không hợp lệ, không ghi', async () => {
    const { service, config } = make(null);
    await expect(
      service.setFormula({ ...CUSTOM, difficulty: { ...CUSTOM.difficulty, EASY: 101 } }, 'sa1'),
    ).rejects.toThrow();
    expect(config.upsert).not.toHaveBeenCalled();
  });
  it('peekFormula (đồng bộ): chưa nạp => mặc định và kích hoạt nạp nền; sau đó trả bản đã nạp', async () => {
    const { service, config } = make({ formula: CUSTOM });
    expect(service.peekFormula()).toEqual(DEFAULT_POINTS_FORMULA);
    await vi.advanceTimersByTimeAsync(0);
    expect(config.findUnique).toHaveBeenCalledTimes(1);
    expect(service.peekFormula()).toEqual(CUSTOM);
  });
  it('peekFormula: DB lỗi không ném ra ngoài và không dồn truy vấn (chỉ thử lại sau TTL)', async () => {
    const { service, config } = make(null);
    config.findUnique.mockRejectedValue(new Error('db down'));
    expect(service.peekFormula()).toEqual(DEFAULT_POINTS_FORMULA);
    await vi.advanceTimersByTimeAsync(0);
    service.peekFormula();
    service.peekFormula();
    expect(config.findUnique).toHaveBeenCalledTimes(1);
  });
});

describe('PointsService.pointsFor', () => {
  const tx = (typeKey: string | null, priorityName: string | null) => ({
    issueType: { findUnique: vi.fn(() => Promise.resolve({ key: typeKey })) },
    priority: {
      findUnique: vi.fn(() => Promise.resolve(priorityName ? { name: priorityName } : null)),
    },
  });

  it('Bug · Khó · High = 9; dùng bảng hệ số hiện hành', async () => {
    const { service } = make(null);
    expect(
      await service.pointsFor(tx('BUG', 'High') as never, {
        typeId: 't',
        difficulty: 'HARD',
        priorityId: 'p',
      }),
    ).toBe(9);
    const custom = make({ formula: CUSTOM });
    expect(
      await custom.service.pointsFor(tx('BUG', 'High') as never, {
        typeId: 't',
        difficulty: 'HARD',
        priorityId: 'p',
      }),
    ).toBe(5 * 3 * 1.5 + 0.5); // 22.5 → half-up 23
  });
  it('Epic => null; loại tuỳ chỉnh (key null) dùng gốc Task; không có ưu tiên => ×1, không tra bảng ưu tiên', async () => {
    const { service } = make(null);
    const epic = tx('EPIC', 'High');
    expect(
      await service.pointsFor(epic as never, {
        typeId: 't',
        difficulty: 'MEDIUM',
        priorityId: 'p',
      }),
    ).toBeNull();
    const custom = tx(null, null);
    expect(
      await service.pointsFor(custom as never, {
        typeId: 't',
        difficulty: 'MEDIUM',
        priorityId: null,
      }),
    ).toBe(4);
    expect(custom.priority.findUnique).not.toHaveBeenCalled();
  });
});

describe('PointsService.rollupEpics', () => {
  /** `epics`: id → storyPoints hiện tại (undefined = Epic không tồn tại/đã xoá); `sums`: tổng việc con theo epicId. */
  function tx(epics: Record<string, number | undefined>, sums: Record<string, number | null>) {
    const order: string[] = [];
    return {
      order,
      // Khoá dòng Epic: tagged template → (strings, id)
      $queryRaw: vi.fn((_s: TemplateStringsArray, id: string) => {
        order.push(`lock:${id}`);
        return Promise.resolve([]);
      }),
      issue: {
        findFirst: vi.fn(({ where }: { where: { id: string } }) =>
          Promise.resolve(epics[where.id] === undefined ? null : { storyPoints: epics[where.id] }),
        ),
        aggregate: vi.fn(({ where }: { where: { epicId: string } }) => {
          order.push(`sum:${where.epicId}`);
          return Promise.resolve({ _sum: { storyPoints: sums[where.epicId] ?? null } });
        }),
        updateMany: vi.fn(() => Promise.resolve({ count: 1 })),
      },
    };
  }

  it('đặt điểm Epic = tổng việc con chưa xoá và tăng version; trả id Epic đã đổi', async () => {
    const t = tx({ e1: 5 }, { e1: 12 });
    const changed = await make().service.rollupEpics(t as never, ['e1']);
    expect(t.issue.aggregate).toHaveBeenCalledWith({
      where: { epicId: 'e1', parentId: null, deletedAt: null }, // chỉ việc cấp trên: việc con đã nằm trong điểm việc cha
      _sum: { storyPoints: true },
    });
    expect(t.issue.updateMany).toHaveBeenCalledWith({
      where: { id: 'e1', deletedAt: null },
      data: { storyPoints: 12, version: { increment: 1 } },
    });
    expect(changed).toEqual(['e1']);
  });
  it('không còn việc con => 0 (không phải null)', async () => {
    const t = tx({ e1: 5 }, { e1: null });
    await make().service.rollupEpics(t as never, ['e1']);
    expect(t.issue.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { storyPoints: 0, version: { increment: 1 } } }),
    );
  });
  it('tổng không đổi => không ghi, không tăng version, không báo đã đổi', async () => {
    const t = tx({ e1: 12 }, { e1: 12 });
    expect(await make().service.rollupEpics(t as never, ['e1'])).toEqual([]);
    expect(t.issue.updateMany).not.toHaveBeenCalled();
  });
  it('Epic đã xoá/không tồn tại => bỏ qua; id trùng chỉ tính một lần; thứ tự khoá cố định (sắp theo id)', async () => {
    const t = tx({ eB: 1, eA: 1 }, { eA: 2, eB: 3 });
    const changed = await make().service.rollupEpics(t as never, ['eB', 'gone', 'eA', 'eB']);
    expect(changed).toEqual(['eA', 'eB']);
    expect(t.issue.aggregate).toHaveBeenCalledTimes(2);
  });
  it('khoá dòng Epic (FOR UPDATE) TRƯỚC khi cộng lại, theo thứ tự id — hai transaction cùng Epic xếp hàng, không ghi đè nhau', async () => {
    const t = tx({ eA: 1, eB: 1 }, { eA: 2, eB: 3 });
    await make().service.rollupEpics(t as never, ['eB', 'eA']);
    expect(t.order).toEqual(['lock:eA', 'sum:eA', 'lock:eB', 'sum:eB']);
    const sql = (t.$queryRaw.mock.calls[0] as unknown as [TemplateStringsArray])[0].join('?');
    expect(sql).toContain('FOR UPDATE');
  });
  it('danh sách rỗng => không truy vấn', async () => {
    const t = tx({}, {});
    expect(await make().service.rollupEpics(t as never, [])).toEqual([]);
    expect(t.issue.findFirst).not.toHaveBeenCalled();
  });
});

/** DB giả có trạng thái cho `rollupParents`: các hàng issue (kèm quan hệ cha/con) + thứ tự khoá/ghi. */
type PRow = {
  id: string;
  storyPoints: number | null;
  parentId?: string | null;
  epicId?: string | null;
  pointsManual?: boolean;
  typeKey?: string | null;
  difficulty?: 'EASY' | 'MEDIUM' | 'HARD' | 'VERY_HARD';
  priorityName?: string | null;
  deletedAt?: Date | null;
  version?: number;
};
const P_DEFAULTS: Required<Omit<PRow, 'id' | 'storyPoints'>> = {
  parentId: null,
  epicId: null,
  pointsManual: false,
  typeKey: 'TASK',
  difficulty: 'MEDIUM',
  priorityName: null,
  deletedAt: null,
  version: 1,
};
function parentTx(input: PRow[]) {
  const rows = new Map(input.map((r) => [r.id, { ...P_DEFAULTS, ...r }]));
  const order: string[] = [];
  const tx = {
    $queryRaw: vi.fn((_s: TemplateStringsArray, id: string) => {
      order.push(`lock:${id}`);
      return Promise.resolve([]);
    }),
    $executeRaw: vi.fn((_s: TemplateStringsArray, target: number, id: string) => {
      const r = rows.get(id)!;
      order.push(`raw:${id}`);
      Object.assign(r, { storyPoints: target, version: r.version + 1 });
      return Promise.resolve(1);
    }),
    issueType: {
      findUnique: vi.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve({ key: rows.get(where.id.replace('type:', ''))?.typeKey ?? null }),
      ),
    },
    priority: {
      findUnique: vi.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve({ name: rows.get(where.id.replace('prio:', ''))?.priorityName ?? null }),
      ),
    },
    issue: {
      findFirst: vi.fn(({ where }: { where: { id: string } }) => {
        const r = rows.get(where.id);
        if (!r || r.deletedAt) return Promise.resolve(null);
        return Promise.resolve({
          storyPoints: r.storyPoints,
          pointsManual: r.pointsManual,
          // pointsFor đọc loại/ưu tiên theo id: mã hoá "type:<id của chính hàng>" để fake tra lại đúng hàng
          typeId: `type:${r.id}`,
          difficulty: r.difficulty,
          priorityId: r.priorityName ? `prio:${r.id}` : null,
          parentId: r.parentId,
          epicId: r.epicId,
          type: { key: r.typeKey },
        });
      }),
      aggregate: vi.fn(({ where }: { where: { parentId: string } }) => {
        const kids = [...rows.values()].filter(
          (k) => k.parentId === where.parentId && !k.deletedAt,
        );
        return Promise.resolve({
          _sum: {
            storyPoints: kids.length ? kids.reduce((a, k) => a + (k.storyPoints ?? 0), 0) : null,
          },
          _count: { _all: kids.length },
        });
      }),
      updateMany: vi.fn(
        ({ where, data }: { where: { id: string }; data: { storyPoints: number } }) => {
          const r = rows.get(where.id)!;
          order.push(`write:${where.id}`);
          Object.assign(r, { storyPoints: data.storyPoints, version: r.version + 1 });
          return Promise.resolve({ count: 1 });
        },
      ),
    },
  };
  return { tx, rows, order };
}

describe('PointsService.rollupParents — điểm việc cha = tổng điểm việc con', () => {
  it('Task có hai sub-task 2 và 3 => Task = 5, tăng version; trả Epic của Task để cộng tiếp', async () => {
    const { tx, rows } = parentTx([
      { id: 't', storyPoints: 4, epicId: 'e1' },
      { id: 's1', storyPoints: 2, parentId: 't' },
      { id: 's2', storyPoints: 3, parentId: 't' },
    ]);
    const changed: string[] = [];
    const epics = await make().service.rollupParents(tx as never, ['t'], { changed });
    expect(rows.get('t')).toMatchObject({ storyPoints: 5, version: 2 });
    expect(changed).toEqual(['t']);
    expect(epics).toEqual(['e1']);
    expect(tx.issue.updateMany).toHaveBeenCalledWith({
      where: { id: 't', deletedAt: null },
      data: { storyPoints: 5, version: { increment: 1 } },
    });
  });
  it('tổng không đổi => không ghi, không tăng version, không trả Epic', async () => {
    const { tx, rows } = parentTx([
      { id: 't', storyPoints: 5, epicId: 'e1' },
      { id: 's1', storyPoints: 5, parentId: 't' },
    ]);
    expect(await make().service.rollupParents(tx as never, ['t'])).toEqual([]);
    expect(rows.get('t')!.version).toBe(1);
    expect(tx.issue.updateMany).not.toHaveBeenCalled();
  });
  it('việc con đã xoá không cộng; việc con chưa có điểm tính 0', async () => {
    const { tx, rows } = parentTx([
      { id: 't', storyPoints: 9 },
      { id: 's1', storyPoints: 2, parentId: 't' },
      { id: 's2', storyPoints: 7, parentId: 't', deletedAt: new Date() },
      { id: 's3', storyPoints: null, parentId: 't' },
    ]);
    await make().service.rollupParents(tx as never, ['t']);
    expect(rows.get('t')!.storyPoints).toBe(2);
  });
  it('xoá việc con cuối cùng => việc cha quay về điểm theo công thức (Task · Trung bình · không ưu tiên = 2×2×1 = 4)', async () => {
    const { tx, rows } = parentTx([{ id: 't', storyPoints: 5, typeKey: 'TASK' }]);
    await make().service.rollupParents(tx as never, ['t']);
    expect(rows.get('t')).toMatchObject({ storyPoints: 4, version: 2 });
  });
  it('hết việc con nhưng đã chỉnh tay => giữ nguyên điểm, không ghi', async () => {
    const { tx, rows } = parentTx([{ id: 't', storyPoints: 13, pointsManual: true }]);
    await make().service.rollupParents(tx as never, ['t']);
    expect(rows.get('t')).toMatchObject({ storyPoints: 13, version: 1 });
  });
  it('Epic và việc đã xoá/không tồn tại bị bỏ qua (Epic có quy tắc riêng)', async () => {
    const { tx, rows } = parentTx([
      { id: 'e', storyPoints: 0, typeKey: 'EPIC' },
      { id: 'k', storyPoints: 1, parentId: 'e' },
      { id: 'd', storyPoints: 3, deletedAt: new Date() },
    ]);
    expect(await make().service.rollupParents(tx as never, ['e', 'd', 'gone'])).toEqual([]);
    expect(rows.get('e')!.storyPoints).toBe(0);
    expect(tx.issue.aggregate).not.toHaveBeenCalled();
  });
  it('khoá dòng theo thứ tự id trước khi cộng; id trùng chỉ tính một lần', async () => {
    const { tx, order } = parentTx([
      { id: 'pB', storyPoints: 0 },
      { id: 'pA', storyPoints: 0 },
      { id: 'a', storyPoints: 1, parentId: 'pA' },
      { id: 'b', storyPoints: 2, parentId: 'pB' },
    ]);
    await make().service.rollupParents(tx as never, ['pB', 'pA', 'pB']);
    expect(order).toEqual(['lock:pA', 'write:pA', 'lock:pB', 'write:pB']);
  });
  it('chuỗi nhiều tầng: con → cha → ông, cha đổi thì ông được cộng lại ở vòng kế (truyền cả cha lẫn ông cũng đúng)', async () => {
    const mk = () =>
      parentTx([
        { id: 'a', storyPoints: 0, epicId: 'e1' }, // ông
        { id: 'b', storyPoints: 0, parentId: 'a' }, // cha
        { id: 'c', storyPoints: 6, parentId: 'b' }, // lá
      ]);
    const one = mk();
    const changed1: string[] = [];
    await make().service.rollupParents(one.tx as never, ['b'], { changed: changed1 });
    expect(one.rows.get('b')!.storyPoints).toBe(6);
    expect(one.rows.get('a')!.storyPoints).toBe(6);
    expect(changed1).toEqual(['b', 'a']);
    // truyền ông trước cha: vẫn ra kết quả đúng (ông được cộng lại sau khi cha đổi)
    const two = mk();
    await make().service.rollupParents(two.tx as never, ['a', 'b']);
    expect(two.rows.get('a')!.storyPoints).toBe(6);
    expect(two.rows.get('b')!.storyPoints).toBe(6);
  });
  it('keepUpdatedAt: ghi bằng SQL thô (không đổi updatedAt), vẫn tăng version', async () => {
    const { tx, rows } = parentTx([
      { id: 't', storyPoints: 0 },
      { id: 's', storyPoints: 3, parentId: 't' },
    ]);
    await make().service.rollupParents(tx as never, ['t'], { keepUpdatedAt: true });
    expect(tx.issue.updateMany).not.toHaveBeenCalled();
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    const sql = (tx.$executeRaw.mock.calls[0] as unknown as [TemplateStringsArray])[0].join('?');
    expect(sql).toContain('"version" = "version" + 1');
    expect(sql).not.toContain('updatedAt');
    expect(rows.get('t')).toMatchObject({ storyPoints: 3, version: 2 });
  });
});

describe('PointsService.explain', () => {
  it('Bug · Khó · High = 2×3×1.5 = 9; điểm chỉnh tay có chú thích', () => {
    const { service } = make(null);
    const row = {
      difficulty: 'HARD' as const,
      type: { key: 'BUG', name: 'Bug' },
      priority: { name: 'High' },
    };
    expect(service.explain(row)).toBe('Bug · Khó · High = 2×3×1.5 = 9');
    expect(service.explain(row, true)).toBe(
      'Đã chỉnh tay (theo công thức: Bug · Khó · High = 2×3×1.5 = 9)',
    );
  });
});

type Row = {
  id: string;
  typeId: string;
  difficulty: 'EASY' | 'MEDIUM' | 'HARD' | 'VERY_HARD';
  priorityId: string | null;
  storyPoints: number | null;
  projectId: string;
  pointsManual?: boolean;
  parentId?: string | null;
  epicId?: string | null;
};

const T0 = 'T0'; // `updatedAt` ban đầu; Prisma `updateMany` (mô phỏng @updatedAt) đổi thành 'BUMPED'

/** `$executeRaw` dạng tagged template: (strings, ...values). Hai câu: ghi lô việc (unnest) và ghi tổng Epic/việc cha. */
function makeExecuteRaw(
  rows: Array<Row & { pointsManual: boolean; version: number }>,
  epics: Record<string, { storyPoints: number; projectId: string }>,
  sqls: string[],
  beforeWrite?: (rows: Array<Row & { pointsManual: boolean; version: number }>) => void,
) {
  return vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
    const sql = strings.join('?');
    sqls.push(sql);
    if (sql.includes('unnest')) {
      beforeWrite?.(rows);
      const [ids, typeIds, diffs, prios, pts] = values as [
        string[],
        string[],
        string[],
        string[],
        number[],
      ];
      let count = 0;
      ids.forEach((id, i) => {
        const r = rows.find((x) => x.id === id);
        // đúng điều kiện WHERE của câu SQL
        if (
          !r ||
          r.pointsManual ||
          r.typeId !== typeIds[i] ||
          r.difficulty !== diffs[i] ||
          (r.priorityId ?? '') !== prios[i]
        )
          return;
        Object.assign(r, { storyPoints: pts[i], version: r.version + 1 });
        count++;
      });
      return Promise.resolve(count);
    }
    // Ghi tổng Epic hoặc điểm việc cha: (strings, total, id)
    const [total, id] = values as [number, string];
    const target = (epics[id] ?? rows.find((x) => x.id === id)) as unknown as { version: number };
    Object.assign(target, { storyPoints: total, version: target.version + 1 });
    return Promise.resolve(1);
  });
}

/**
 * DB giả có trạng thái: lọc theo `where` thật mà service gửi (dự án, chỉnh tay, Epic, id/cursor). Ghi qua `$executeRaw`
 * (cách recomputeAll ghi) áp ĐÚNG điều kiện của câu SQL (id + pointsManual + loại/độ khó/ưu tiên đã đọc) và KHÔNG đổi
 * `updatedAt`; ghi qua Prisma `updateMany` thì đổi `updatedAt` như `@updatedAt` — nên test bắt được việc dùng nhầm đường ghi.
 * `beforeWrite`: mô phỏng người dùng sửa việc GIỮA lúc recompute đọc và ghi.
 */
function makeRecompute(opts: {
  rows: Row[];
  formula?: unknown;
  epics?: Record<string, { storyPoints: number; projectId: string }>;
  beforeWrite?: (rows: Array<Row & { pointsManual: boolean; version: number }>) => void;
}) {
  const rows = opts.rows.map((r) => ({ pointsManual: false, version: 1, updatedAt: T0, ...r }));
  const epics = opts.epics ?? {};
  for (const e of Object.values(epics)) Object.assign(e, { updatedAt: T0, version: 1 });
  const sqls: string[] = [];
  const types = [
    { id: 't-task', key: 'TASK' },
    { id: 't-bug', key: 'BUG' },
    { id: 't-epic', key: 'EPIC' },
  ];
  const issue = {
    findMany: vi.fn(
      (a: {
        where: {
          projectId?: string;
          pointsManual?: boolean;
          deletedAt?: null;
          type?: { key: string };
          children?: { some?: unknown; none?: unknown };
        };
        cursor?: { id: string };
        take?: number;
      }) => {
        if (a.where.type?.key === 'EPIC')
          return Promise.resolve(
            Object.entries(epics).map(([id, e]) => ({ id, projectId: e.projectId })),
          );
        const hasKids = (id: string) => rows.some((k) => k.parentId === id);
        // bước cộng việc cha: mọi việc (không Epic) đang có việc con chưa xoá
        if (a.where.children?.some)
          return Promise.resolve(
            rows
              .filter((r) => r.typeId !== 't-epic' && hasKids(r.id))
              .map((r) => ({ id: r.id, projectId: r.projectId, parentId: r.parentId ?? null })),
          );
        let list = rows
          .filter((r) => r.projectId === a.where.projectId && r.pointsManual === false)
          .filter((r) => r.typeId !== 't-epic')
          // bước công thức loại việc cha (children: { none })
          .filter((r) => !a.where.children?.none || !hasKids(r.id))
          .sort((x, y) => x.id.localeCompare(y.id));
        if (a.cursor) list = list.filter((r) => r.id > a.cursor!.id);
        // bản chụp tại lúc đọc (người dùng sửa sau đó không làm đổi dữ liệu đã đọc)
        return Promise.resolve(list.slice(0, a.take).map((r) => ({ ...r })));
      },
    ),
    updateMany: vi.fn(
      (a: {
        where: { id: string | { in: string[] }; pointsManual?: boolean; deletedAt?: null };
        data: { storyPoints: number; version: { increment: number } };
      }) => {
        // Đường Prisma = @updatedAt tự đổi `updatedAt` (recomputeAll KHÔNG được đi đường này)
        if (typeof a.where.id === 'string') {
          Object.assign(epics[a.where.id]!, {
            storyPoints: a.data.storyPoints,
            updatedAt: 'BUMPED',
          });
          return Promise.resolve({ count: 1 });
        }
        const ids = a.where.id.in;
        let count = 0;
        for (const r of rows)
          if (ids.includes(r.id) && r.pointsManual === false) {
            Object.assign(r, {
              storyPoints: a.data.storyPoints,
              version: r.version + a.data.version.increment,
              updatedAt: 'BUMPED',
            });
            count++;
          }
        return Promise.resolve({ count });
      },
    ),
    findFirst: vi.fn(({ where }: { where: { id: string } }) => {
      if (epics[where.id]) return Promise.resolve({ storyPoints: epics[where.id]!.storyPoints });
      const r = rows.find((x) => x.id === where.id);
      if (!r) return Promise.resolve(null);
      return Promise.resolve({
        ...r,
        parentId: r.parentId ?? null,
        epicId: r.epicId ?? null,
        type: { key: types.find((t) => t.id === r.typeId)?.key ?? null },
      });
    }),
    aggregate: vi.fn(({ where }: { where: { epicId?: string; parentId?: string | null } }) => {
      // Epic: việc cấp trên (parentId rỗng) có epicId; việc cha: việc có parentId = cha
      const list = rows.filter((r) =>
        where.epicId !== undefined
          ? r.epicId === where.epicId && (r.parentId ?? null) === where.parentId
          : r.parentId === where.parentId,
      );
      return Promise.resolve({
        _sum: { storyPoints: list.reduce((a, r) => a + (r.storyPoints ?? 0), 0) || null },
        _count: { _all: list.length },
      });
    }),
  };
  const executeRaw = makeExecuteRaw(rows, epics, sqls, opts.beforeWrite);
  const prisma = {
    $executeRaw: executeRaw,
    pointsFormulaConfig: {
      findUnique: vi.fn(() => Promise.resolve(opts.formula ? { formula: opts.formula } : null)),
      upsert: vi.fn(() => Promise.resolve({})),
    },
    issueType: { findMany: vi.fn(() => Promise.resolve(types)) },
    priority: {
      findMany: vi.fn(() =>
        Promise.resolve([
          { id: 'pr-high', name: 'High' },
          { id: 'pr-med', name: 'Medium' },
        ]),
      ),
    },
    project: { findMany: vi.fn(() => Promise.resolve([{ id: 'p1' }, { id: 'p2' }])) },
    issue,
    $queryRaw: vi.fn(() => Promise.resolve([])),
    $transaction: vi.fn((fn: (tx: unknown) => unknown) =>
      fn({
        issue,
        $queryRaw: prisma.$queryRaw,
        $executeRaw: executeRaw,
        // pointsFor (việc cha hết việc con quay về công thức)
        issueType: {
          findUnique: vi.fn(({ where }: { where: { id: string } }) =>
            Promise.resolve(types.find((t) => t.id === where.id) ?? null),
          ),
        },
        priority: {
          findUnique: vi.fn(({ where }: { where: { id: string } }) =>
            Promise.resolve(
              [
                { id: 'pr-high', name: 'High' },
                { id: 'pr-med', name: 'Medium' },
              ].find((p) => p.id === where.id) ?? null,
            ),
          ),
        },
      }),
    ),
  };
  const events = { emit: vi.fn() };
  const service = new PointsService(prisma as never, events as never);
  return { service, rows, epics, issue, events, prisma, sqls };
}

const recRow = (id: string, over: Partial<Row> = {}): Row => ({
  id,
  typeId: 't-bug',
  difficulty: 'MEDIUM',
  priorityId: 'pr-high',
  storyPoints: null,
  projectId: 'p1',
  ...over,
});

describe('PointsService.recomputeAll — tính lại toàn hệ thống', () => {
  it('Bug·Trung bình·High => 6; việc chỉnh tay giữ nguyên; điểm cũ (80) bị tính lại; version chỉ tăng ở việc đổi', async () => {
    const { service, rows } = makeRecompute({
      rows: [
        recRow('a'), // null → 6
        recRow('b', { storyPoints: 80 }), // điểm nhập tay cũ (chưa đánh dấu chỉnh tay) → 6
        recRow('c', { storyPoints: 6 }), // đã đúng → không ghi
        recRow('d', { storyPoints: 80, pointsManual: true }), // chỉnh tay → giữ
      ],
    });
    const r = await service.recomputeAll();
    expect(r).toEqual({ updated: 2, epics: 0 });
    const pts = Object.fromEntries(rows.map((x) => [x.id, [x.storyPoints, x.version]]));
    expect(pts).toEqual({ a: [6, 2], b: [6, 2], c: [6, 1], d: [80, 1] });
  });

  it('idempotent: lần chạy thứ hai cập nhật 0 việc, không tăng version', async () => {
    const { service, rows } = makeRecompute({
      rows: [recRow('a'), recRow('b', { typeId: 't-task' })],
    });
    await service.recomputeAll();
    const versions = rows.map((x) => x.version);
    expect((await service.recomputeAll()).updated).toBe(0);
    expect(rows.map((x) => x.version)).toEqual(versions);
  });

  it('không đụng Epic ở bước việc (where loại Epic + pointsManual=false); dùng bảng hệ số MỚI đọc từ DB', async () => {
    const custom = { ...DEFAULT_POINTS_FORMULA, base: { ...DEFAULT_POINTS_FORMULA.base, BUG: 5 } };
    const { service, issue, rows } = makeRecompute({ rows: [recRow('a')], formula: custom });
    await service.recomputeAll();
    const rowQuery = issue.findMany.mock.calls.find(
      (c) => (c[0].where as { projectId?: string }).projectId === 'p1',
    )![0];
    expect(rowQuery.where).toMatchObject({
      pointsManual: false,
      NOT: { type: { key: 'EPIC' } },
    });
    expect(rows[0]!.storyPoints).toBe(5 * 2 * 1.5); // 15
  });

  it('lô 500 việc theo dự án: 1200 việc => ba lần đọc, tất cả được tính', async () => {
    const many = Array.from({ length: 1200 }, (_, i) => recRow(`i${String(i).padStart(4, '0')}`));
    const { service, issue, rows } = makeRecompute({ rows: many });
    const r = await service.recomputeAll();
    expect(r.updated).toBe(1200);
    expect(rows.every((x) => x.storyPoints === 6)).toBe(true);
    const reads = issue.findMany.mock.calls.filter((c) => (c[0] as { take?: number }).take === 500);
    expect(
      reads.filter((c) => (c[0].where as { projectId: string }).projectId === 'p1'),
    ).toHaveLength(3);
  });

  it('ghi bằng MỘT câu SQL thô cho cả lô: ràng pointsManual + đầu vào đã đọc; KHÔNG chạm updatedAt và không đi đường Prisma updateMany', async () => {
    const { service, issue, sqls, rows } = makeRecompute({
      rows: [recRow('a'), recRow('b'), recRow('c', { typeId: 't-task', priorityId: 'pr-med' })],
    });
    await service.recomputeAll();
    const batch = sqls.filter((q) => q.includes('unnest'));
    expect(batch).toHaveLength(1);
    expect(batch[0]).toContain('NOT i."pointsManual"');
    for (const col of ['"typeId"', '"difficulty"', '"priorityId"']) expect(batch[0]).toContain(col);
    expect(batch[0]).toContain('"version" = i."version" + 1');
    expect(batch[0]).not.toContain('updatedAt');
    expect(issue.updateMany).not.toHaveBeenCalled();
    expect(rows.map((r) => r.storyPoints)).toEqual([6, 6, 4]);
    expect(rows.every((r) => r.updatedAt === 'T0')).toBe(true);
  });

  it('race: người dùng đổi loại/độ khó/ưu tiên giữa lúc đọc và ghi => việc đó bị BỎ QUA (không đè), việc khác vẫn ghi', async () => {
    const { service, rows } = makeRecompute({
      rows: [recRow('a'), recRow('b'), recRow('c'), recRow('d')],
      beforeWrite: (rs) => {
        rs[0]!.difficulty = 'HARD'; // a: đổi độ khó
        rs[1]!.priorityId = 'pr-med'; // b: đổi ưu tiên
        rs[2]!.typeId = 't-task'; // c: đổi loại
        // d giữ nguyên
      },
    });
    const r = await service.recomputeAll();
    expect(r.updated).toBe(1);
    expect(rows.map((x) => x.storyPoints)).toEqual([null, null, null, 6]);
    expect(rows.map((x) => x.version)).toEqual([1, 1, 1, 2]);
  });

  it('race: việc vừa được chỉnh tay giữa lúc đọc và ghi không bị đè', async () => {
    const { service, rows } = makeRecompute({
      rows: [recRow('a'), recRow('b')],
      beforeWrite: (rs) => {
        rs[0]!.pointsManual = true;
        rs[0]!.storyPoints = 42;
      },
    });
    const r = await service.recomputeAll();
    expect(r.updated).toBe(1);
    expect(rows[0]!.storyPoints).toBe(42);
    expect(rows[1]!.storyPoints).toBe(6);
  });

  it('báo client nạp lại ở MỨC DỰ ÁN (project.ranks_rebalanced) cho dự án có việc đổi; không phát ISSUE_UPDATED từng việc', async () => {
    const { service, events } = makeRecompute({
      rows: [recRow('a'), recRow('b', { projectId: 'p2', storyPoints: 6 })],
    });
    await service.recomputeAll();
    expect(events.emit.mock.calls).toEqual([['project.ranks_rebalanced', { projectId: 'p1' }]]);
  });

  it('Epic: cộng lại tổng việc con sau cùng, tăng version Epic; Epic đúng tổng thì không ghi', async () => {
    const children = [
      { ...recRow('a'), epicId: 'e1' },
      { ...recRow('b', { typeId: 't-task', priorityId: 'pr-med' }), epicId: 'e1' },
    ] as unknown as Row[];
    const { service, epics, issue, sqls } = makeRecompute({
      rows: children,
      epics: { e1: { storyPoints: 99, projectId: 'p1' }, e2: { storyPoints: 0, projectId: 'p1' } },
    });
    const r = await service.recomputeAll();
    expect(epics.e1!.storyPoints).toBe(10); // 6 + 4
    expect(epics.e2!.storyPoints).toBe(0);
    expect(r.epics).toBe(1);
    // tổng Epic ghi bằng SQL thô: tăng version, KHÔNG đổi updatedAt, không qua Prisma updateMany
    expect(issue.updateMany).not.toHaveBeenCalled();
    const epicSql = sqls.filter((q) => !q.includes('unnest'));
    expect(epicSql).toHaveLength(1);
    expect(epicSql[0]).toContain('"version" = "version" + 1');
    expect(epicSql[0]).not.toContain('updatedAt');
    expect(epics.e1).toMatchObject({ version: 2, updatedAt: 'T0' });
    expect(epics.e2).toMatchObject({ version: 1, updatedAt: 'T0' });
  });

  it('lần đọc bảng hệ số ĐANG BAY (ra bản cũ) khi SA lưu: recompute dùng bản MỚI và cache không bị bản cũ ghi đè', async () => {
    const OLD = DEFAULT_POINTS_FORMULA;
    const NEW = { ...DEFAULT_POINTS_FORMULA, base: { ...DEFAULT_POINTS_FORMULA.base, BUG: 5 } };
    const { service, prisma, rows } = makeRecompute({ rows: [recRow('a')] });
    let releaseOld!: () => void;
    prisma.pointsFormulaConfig.findUnique
      // lần đọc nền (từ toDto) đã bắt đầu, đọc ra bản CŨ nhưng về trễ
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            releaseOld = () => resolve({ formula: OLD });
          }),
      )
      .mockImplementation(() => Promise.resolve({ formula: NEW }));
    service.peekFormula(); // khởi động lần đọc nền (cache trống)
    await service.setFormula(NEW, 'sa1'); // SA lưu bản mới trong lúc lần đọc cũ còn bay
    await service.recomputeAll();
    expect(rows[0]!.storyPoints).toBe(5 * 2 * 1.5); // Bug (5) × MEDIUM (2) × High (1.5) = 15, không phải 6
    releaseOld(); // lần đọc cũ về sau cùng
    await Promise.resolve();
    await Promise.resolve();
    expect(await service.getFormula()).toEqual(NEW);
    expect(service.peekFormula()).toEqual(NEW);
  });

  it('gọi đồng thời không chạy song song: lần sau chạy lại ĐÚNG MỘT lần sau lần đang chạy', async () => {
    const { service, prisma } = makeRecompute({ rows: [recRow('a')] });
    const [a, b, c] = [service.recomputeAll(), service.recomputeAll(), service.recomputeAll()];
    expect(b).toBe(a);
    expect(c).toBe(a);
    await a;
    // đọc bảng hệ số: một lần cho lần đầu + một lần cho lần chạy lại
    expect(prisma.pointsFormulaConfig.findUnique).toHaveBeenCalledTimes(2);
  });
});

describe('PointsService.recomputeAll — việc cha có việc con', () => {
  const family = () => [
    // Task cha (điểm cũ 99, thuộc Epic e1) và hai việc con (cũng mang epicId e1: không được cộng thêm vào Epic)
    recRow('pt', { typeId: 't-task', priorityId: 'pr-med', storyPoints: 99, epicId: 'e1' }),
    recRow('c1', { parentId: 'pt', epicId: 'e1' }), // Bug · TB · High = 6
    recRow('c2', { parentId: 'pt', epicId: 'e1', typeId: 't-task', priorityId: 'pr-med' }), // 4
  ];
  const epics = () => ({ e1: { storyPoints: 0, projectId: 'p1' } });

  it('việc cha = tổng việc con (không theo công thức); Epic đếm việc cha một lần, không đếm lại việc con', async () => {
    const { service, rows, epics: e } = makeRecompute({ rows: family(), epics: epics() });
    const r = await service.recomputeAll();
    expect(rows.map((x) => x.storyPoints)).toEqual([10, 6, 4]);
    expect(e.e1!.storyPoints).toBe(10); // 10 (cha) — không phải 20
    expect(r).toEqual({ updated: 3, epics: 1 }); // 2 việc con + 1 việc cha
  });
  it('không đổi updatedAt của việc cha, tăng version đúng một lần; việc cha cũng không bị công thức ghi trước', async () => {
    const { service, rows, sqls, issue } = makeRecompute({ rows: family(), epics: epics() });
    await service.recomputeAll();
    expect(rows[0]).toMatchObject({ storyPoints: 10, version: 2, updatedAt: 'T0' });
    expect(issue.updateMany).not.toHaveBeenCalled();
    // câu SQL lô công thức không chứa việc cha (chỉ hai việc con)
    expect(sqls.filter((q) => q.includes('unnest'))).toHaveLength(1);
  });
  it('idempotent: lần chạy thứ hai không đổi gì', async () => {
    const { service, rows } = makeRecompute({ rows: family(), epics: epics() });
    await service.recomputeAll();
    const v = rows.map((x) => x.version);
    expect(await service.recomputeAll()).toEqual({ updated: 0, epics: 0 });
    expect(rows.map((x) => x.version)).toEqual(v);
  });
  it('chuỗi cha → ông: tầng thấp trước nên ông ra tổng đúng ngay lần chạy đầu', async () => {
    const { service, rows } = makeRecompute({
      rows: [
        recRow('a', { typeId: 't-task', priorityId: 'pr-med', storyPoints: 1 }), // ông
        recRow('b', { typeId: 't-task', priorityId: 'pr-med', storyPoints: 1, parentId: 'a' }), // cha
        recRow('c', { parentId: 'b' }), // lá: 6
      ],
    });
    await service.recomputeAll();
    expect(rows.map((x) => x.storyPoints)).toEqual([6, 6, 6]);
  });
  it('báo client nạp lại dự án khi chỉ có việc cha đổi', async () => {
    const { service, events } = makeRecompute({
      rows: [
        recRow('pt', { typeId: 't-task', storyPoints: 0 }),
        recRow('c1', { parentId: 'pt', storyPoints: 6 }), // đã đúng công thức
      ],
    });
    await service.recomputeAll();
    expect(events.emit.mock.calls).toEqual([['project.ranks_rebalanced', { projectId: 'p1' }]]);
  });
});
