import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_POINTS_FORMULA, type PointsFormula } from '@tirapro/shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AdminConsoleController } from './admin-console.controller';
import { putPointsFormulaSchema } from './admin-console.schemas';

const SA = { id: 'sa1', isSystemAdmin: true } as never;
const USER = { id: 'u1', isSystemAdmin: false } as never;
const CUSTOM: PointsFormula = {
  ...DEFAULT_POINTS_FORMULA,
  base: { ...DEFAULT_POINTS_FORMULA.base, BUG: 5 },
};

function make(recompute: () => Promise<unknown> = () => Promise.resolve({ updated: 3, epics: 1 })) {
  const points = {
    getFormula: vi.fn(() => Promise.resolve(DEFAULT_POINTS_FORMULA)),
    setFormula: vi.fn((f: PointsFormula) => Promise.resolve(f)),
    recomputeAll: vi.fn(recompute),
  };
  const audit = { record: vi.fn(() => Promise.resolve()) };
  const ctrl = new AdminConsoleController(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    points as never,
    audit as never,
  );
  return { ctrl, points, audit };
}

describe('GET/PUT /admin/points-formula — Cách tính điểm', () => {
  it('người không phải SA: GET và PUT đều 403, không ghi/kiểm toán/tính lại gì', async () => {
    const { ctrl, points, audit } = make();
    await expect(ctrl.pointsFormula(USER)).rejects.toMatchObject({ status: 403 });
    await expect(ctrl.putPointsFormula(USER, CUSTOM)).rejects.toMatchObject({ status: 403 });
    expect(points.setFormula).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
    expect(points.recomputeAll).not.toHaveBeenCalled();
  });

  it('SA: GET trả bảng hệ số hiện hành', async () => {
    const { ctrl } = make();
    expect(await ctrl.pointsFormula(SA)).toEqual(DEFAULT_POINTS_FORMULA);
  });

  it('SA: PUT lưu bảng, ghi MỘT dòng kiểm toán points.formula_changed (bảng cũ/mới), rồi tính lại điểm', async () => {
    const { ctrl, points, audit } = make();
    const out = await ctrl.putPointsFormula(SA, CUSTOM);
    expect(out).toEqual(CUSTOM);
    expect(points.setFormula).toHaveBeenCalledWith(CUSTOM, 'sa1');
    expect(audit.record).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'sa1',
        action: 'points.formula_changed',
        entityType: 'PointsFormulaConfig',
        workspaceId: null,
        meta: { before: DEFAULT_POINTS_FORMULA, after: CUSTOM },
      }),
    );
    expect(points.recomputeAll).toHaveBeenCalledTimes(1);
    // lưu trước, kiểm toán sau, tính lại sau cùng
    expect(points.setFormula.mock.invocationCallOrder[0]).toBeLessThan(
      audit.record.mock.invocationCallOrder[0]!,
    );
    expect(audit.record.mock.invocationCallOrder[0]).toBeLessThan(
      points.recomputeAll.mock.invocationCallOrder[0]!,
    );
  });

  it('tính lại chạy NỀN: PUT trả về ngay dù recomputeAll chưa xong, và lỗi nền không làm hỏng yêu cầu', async () => {
    const pending = make(() => new Promise(() => undefined));
    await expect(pending.ctrl.putPointsFormula(SA, CUSTOM)).resolves.toEqual(CUSTOM);
    const failing = make(() => Promise.reject(new Error('db down')));
    await expect(failing.ctrl.putPointsFormula(SA, CUSTOM)).resolves.toEqual(CUSTOM);
    await Promise.resolve();
    expect(failing.points.recomputeAll).toHaveBeenCalledTimes(1);
  });

  it('body: mỗi hệ số phải > 0 và ≤ 100, đủ khoá', () => {
    const pipe = new ZodValidationPipe(putPointsFormulaSchema);
    const run = (b: unknown) => () => pipe.transform(b, { type: 'body' });
    expect(run(CUSTOM)).not.toThrow();
    expect(run({ ...CUSTOM, base: { ...CUSTOM.base, BUG: 0 } })).toThrow();
    expect(run({ ...CUSTOM, difficulty: { ...CUSTOM.difficulty, HARD: 101 } })).toThrow();
    expect(run({ ...CUSTOM, priority: { Lowest: 1 } })).toThrow();
  });
});
