import { describe, expect, it } from 'vitest';
import { isConfigHidden, isDraftComplete, toKeyResultInput, type DraftKr } from './krDraft';

const base: DraftKr = {
  rowKey: 'k1',
  id: 'k1',
  name: ' Khách ',
  unit: 'NUMBER',
  startValue: 6,
  targetValue: 0,
  currentValue: 4,
  source: 'MANUAL',
  sourceConfig: null,
  unitLabel: ' khách ',
  originalSource: 'MANUAL',
  originalCurrent: 4,
};

describe('toKeyResultInput', () => {
  it('KR nhập tay không sửa số: KHÔNG gửi currentValue (tránh ghi đè số mới của người khác)', () => {
    const out = toKeyResultInput(base);
    expect(out).not.toHaveProperty('currentValue');
    expect(out).not.toHaveProperty('expectedCurrentValue');
    expect(out).toMatchObject({
      id: 'k1',
      name: 'Khách',
      unitLabel: 'khách',
      source: 'MANUAL',
      sourceConfig: null,
    });
  });

  it('KR nhập tay có sửa số: gửi currentValue kèm expectedCurrentValue = số lúc mở form', () => {
    expect(toKeyResultInput({ ...base, currentValue: 2 })).toMatchObject({
      currentValue: 2,
      expectedCurrentValue: 4,
    });
  });

  it('KR mới (chưa có id): luôn gửi currentValue, không có expectedCurrentValue', () => {
    const out = toKeyResultInput({
      ...base,
      id: undefined,
      originalCurrent: undefined,
      originalSource: undefined,
    });
    expect(out.currentValue).toBe(4);
    expect(out).not.toHaveProperty('expectedCurrentValue');
  });

  it('KR tự đo: không gửi currentValue; gửi source + cấu hình', () => {
    const out = toKeyResultInput({
      ...base,
      source: 'OPEN_BUGS',
      sourceConfig: { projectId: 'p1' },
      originalSource: 'OPEN_BUGS',
    });
    expect(out).not.toHaveProperty('currentValue');
    expect(out).toMatchObject({ source: 'OPEN_BUGS', sourceConfig: { projectId: 'p1' } });
  });

  it('cấu hình bị che và không đổi nguồn: không gửi source/sourceConfig (BE giữ nguyên)', () => {
    const out = toKeyResultInput({
      ...base,
      source: 'ISSUE_COUNT_JQL',
      sourceConfig: null,
      originalSource: 'ISSUE_COUNT_JQL',
      configHidden: true,
    });
    expect(out).not.toHaveProperty('source');
    expect(out).not.toHaveProperty('sourceConfig');
    expect(
      isDraftComplete({
        ...base,
        source: 'ISSUE_COUNT_JQL',
        sourceConfig: null,
        originalSource: 'ISSUE_COUNT_JQL',
        configHidden: true,
      }),
    ).toBe(true);
  });

  it('đổi nguồn của KR bị che → gửi cấu hình mới và đòi đủ cấu hình', () => {
    const d: DraftKr = {
      ...base,
      source: 'SPRINT_COMPLETION',
      sourceConfig: { projectId: '' },
      originalSource: 'ISSUE_COUNT_JQL',
      configHidden: true,
    };
    expect(isDraftComplete(d)).toBe(false);
    expect(toKeyResultInput({ ...d, sourceConfig: { projectId: 'p1' } })).toMatchObject({
      source: 'SPRINT_COMPLETION',
      sourceConfig: { projectId: 'p1' },
    });
  });

  it('chuyển TỰ ĐO → NHẬP TAY: gửi currentValue (không kèm expected) để số hiện đang thấy thành điểm check-in đầu', () => {
    const out = toKeyResultInput({
      ...base,
      source: 'MANUAL',
      originalSource: 'OPEN_BUGS',
      currentValue: 7,
      originalCurrent: 7,
    });
    expect(out).toMatchObject({ currentValue: 7, source: 'MANUAL', sourceConfig: null });
    expect(out).not.toHaveProperty('expectedCurrentValue');
  });
});

describe('isConfigHidden', () => {
  it('tự đo mà không có cấu hình = bị che; nhập tay / có cấu hình = không', () => {
    expect(isConfigHidden({ source: 'ISSUE_COUNT_JQL', sourceConfig: null })).toBe(true);
    expect(isConfigHidden({ source: 'OPEN_BUGS', sourceConfig: {} })).toBe(false);
    expect(isConfigHidden({ source: 'MANUAL', sourceConfig: null })).toBe(false);
  });
});
