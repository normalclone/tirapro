import { describe, expect, it } from 'vitest';
import { DEFAULT_POINTS_FORMULA } from '@tirapro/shared';
import {
  DEFAULT_DRAFT,
  coefError,
  draftErrors,
  draftToFormula,
  fieldKey,
  isDraftDirty,
  toDraft,
} from './pointsFormulaForm';

describe('bảng hệ số điểm: kiểm tra từng ô (> 0, ≤ 100)', () => {
  it('bản mặc định hợp lệ và khớp bảng hệ số mặc định của máy chủ', () => {
    expect(draftErrors(DEFAULT_DRAFT)).toEqual({});
    expect(draftToFormula(DEFAULT_DRAFT)).toEqual(DEFAULT_POINTS_FORMULA);
  });
  it('0, số âm, rỗng, chữ, lớn hơn 100 đều bị từ chối kèm lời lỗi tiếng Việt', () => {
    expect(coefError('0')).toBe('Phải lớn hơn 0');
    expect(coefError('-2')).toBe('Phải lớn hơn 0');
    expect(coefError('')).toBe('Nhập hệ số');
    expect(coefError('abc')).toBe('Phải là một số');
    expect(coefError('101')).toBe('Tối đa 100');
  });
  it('nhận số lẻ và dấu phẩy thập phân ("1,5" = 1.5)', () => {
    expect(coefError('1.5')).toBeNull();
    expect(coefError('1,5')).toBeNull();
    expect(coefError('0.25')).toBeNull();
  });
  it('một ô sai → báo đúng ô đó và KHÔNG dựng được bảng để lưu', () => {
    const d = { ...DEFAULT_DRAFT, [fieldKey('difficulty', 'HARD')]: '0' };
    expect(Object.keys(draftErrors(d))).toEqual(['difficulty.HARD']);
    expect(draftToFormula(d)).toBeNull();
  });
  it('dựng bảng từ bản nháp đã sửa (chuỗi → số)', () => {
    const d = { ...DEFAULT_DRAFT, [fieldKey('priority', 'High')]: '1,75' };
    expect(draftToFormula(d)?.priority.High).toBe(1.75);
  });
  it('isDraftDirty: so theo giá trị đã lưu, bỏ qua khoảng trắng; sửa một ô là bẩn', () => {
    expect(isDraftDirty(DEFAULT_DRAFT, DEFAULT_POINTS_FORMULA)).toBe(false);
    expect(
      isDraftDirty({ ...DEFAULT_DRAFT, [fieldKey('base', 'BUG')]: ' 2 ' }, DEFAULT_POINTS_FORMULA),
    ).toBe(false);
    expect(
      isDraftDirty({ ...DEFAULT_DRAFT, [fieldKey('base', 'BUG')]: '3' }, DEFAULT_POINTS_FORMULA),
    ).toBe(true);
    expect(toDraft(DEFAULT_POINTS_FORMULA)[fieldKey('priority', 'Highest')]).toBe('2');
  });
});
