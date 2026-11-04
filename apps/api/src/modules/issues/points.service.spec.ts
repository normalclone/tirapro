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
      where: { epicId: 'e1', deletedAt: null },
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
