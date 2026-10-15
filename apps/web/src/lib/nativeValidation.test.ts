import { describe, expect, it } from 'vitest';
import { viValidationMessage } from './nativeValidation';

const ok = {
  valueMissing: false,
  typeMismatch: false,
  tooShort: false,
  tooLong: false,
  rangeUnderflow: false,
  rangeOverflow: false,
  patternMismatch: false,
  stepMismatch: false,
  badInput: false,
};

describe('viValidationMessage', () => {
  it('thiếu giá trị', () => {
    expect(viValidationMessage({ ...ok, valueMissing: true }, { type: 'text' })).toBe(
      'Vui lòng điền trường này.',
    );
    expect(viValidationMessage({ ...ok, valueMissing: true }, { type: 'select-one' })).toBe(
      'Vui lòng chọn một mục.',
    );
  });
  it('email sai', () => {
    expect(viValidationMessage({ ...ok, typeMismatch: true }, { type: 'email' })).toBe(
      'Email chưa đúng định dạng (ví dụ: ten@congty.com).',
    );
  });
  it('quá ngắn / quá dài / ngoài khoảng', () => {
    expect(viValidationMessage({ ...ok, tooShort: true }, { type: 'password', minLength: 8 })).toBe(
      'Cần ít nhất 8 ký tự.',
    );
    expect(viValidationMessage({ ...ok, tooLong: true }, { type: 'text', maxLength: 120 })).toBe(
      'Tối đa 120 ký tự.',
    );
    expect(viValidationMessage({ ...ok, rangeUnderflow: true }, { type: 'number', min: '1' })).toBe(
      'Giá trị phải từ 1 trở lên.',
    );
  });
  it('các loại còn lại', () => {
    expect(viValidationMessage({ ...ok, valueMissing: true }, { type: 'checkbox' })).toBe(
      'Vui lòng tích ô này để tiếp tục.',
    );
    expect(viValidationMessage({ ...ok, valueMissing: true }, { type: 'radio' })).toBe(
      'Vui lòng chọn một mục.',
    );
    expect(viValidationMessage({ ...ok, typeMismatch: true }, { type: 'url' })).toBe(
      'Địa chỉ web chưa đúng (bắt đầu bằng https://).',
    );
    expect(viValidationMessage({ ...ok, rangeOverflow: true }, { type: 'number', max: '10' })).toBe(
      'Giá trị không được lớn hơn 10.',
    );
    expect(viValidationMessage({ ...ok, badInput: true }, { type: 'number' })).toBe(
      'Hãy nhập một số.',
    );
    expect(viValidationMessage({ ...ok, stepMismatch: true }, { type: 'number' })).toBe(
      'Giá trị chưa hợp lệ.',
    );
    expect(viValidationMessage({ ...ok, patternMismatch: true }, { type: 'text' })).toBe(
      'Định dạng chưa đúng.',
    );
  });
  it('hợp lệ → rỗng (không đè thông điệp của trình duyệt)', () => {
    expect(viValidationMessage(ok, { type: 'text' })).toBe('');
  });
});
