import { describe, expect, it } from 'vitest';
import type { CustomFieldDefinition } from './api';
import { displayCustomFieldValue } from './displayValue';

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
