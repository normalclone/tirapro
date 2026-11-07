import { describe, expect, it } from 'vitest';
import type { CustomFieldDefinition } from './api';
import { displayCustomFieldValue, isCustomFieldEmpty } from './displayValue';

const def = (type: CustomFieldDefinition['type']): CustomFieldDefinition => ({
  id: 'f1',
  name: 'F',
  type,
  isRequired: false,
  options: [
    { id: 'o1', value: 'Cao' },
    { id: 'o2', value: 'Thấp' },
  ],
});

describe('displayCustomFieldValue', () => {
  it('chưa có giá trị => null (UI hiện dấu —)', () => {
    expect(displayCustomFieldValue(def('TEXT'), null)).toBeNull();
    expect(displayCustomFieldValue(def('TEXT'), '')).toBeNull();
    expect(displayCustomFieldValue(def('MULTI_SELECT'), [])).toBeNull();
  });
  it('select/multi-select hiện tên lựa chọn, không phải id', () => {
    expect(displayCustomFieldValue(def('SELECT'), 'o1')).toBe('Cao');
    expect(displayCustomFieldValue(def('MULTI_SELECT'), ['o1', 'o2'])).toBe('Cao, Thấp');
  });
  it('checkbox, số, văn bản', () => {
    expect(displayCustomFieldValue(def('CHECKBOX'), true)).toBe('Có');
    expect(displayCustomFieldValue(def('CHECKBOX'), false)).toBe('Không');
    expect(displayCustomFieldValue(def('NUMBER'), 0)).toBe('0');
    expect(displayCustomFieldValue(def('TEXT'), 'abc')).toBe('abc');
  });
});

describe('isCustomFieldEmpty (TIRA-BUG-34)', () => {
  it('TEXT/NUMBER/SELECT: trống khi null hoặc chuỗi rỗng', () => {
    expect(isCustomFieldEmpty(def('TEXT'), null)).toBe(true);
    expect(isCustomFieldEmpty(def('TEXT'), '')).toBe(true);
    expect(isCustomFieldEmpty(def('TEXT'), 'x')).toBe(false);
    expect(isCustomFieldEmpty(def('NUMBER'), 0)).toBe(false);
  });
  it('MULTI_SELECT: trống khi mảng rỗng', () => {
    expect(isCustomFieldEmpty(def('MULTI_SELECT'), [])).toBe(true);
    expect(isCustomFieldEmpty(def('MULTI_SELECT'), ['o1'])).toBe(false);
  });
  it('CHECKBOX: trống khi chưa tick (khác true)', () => {
    expect(isCustomFieldEmpty(def('CHECKBOX'), null)).toBe(true);
    expect(isCustomFieldEmpty(def('CHECKBOX'), false)).toBe(true);
    expect(isCustomFieldEmpty(def('CHECKBOX'), true)).toBe(false);
  });
});
