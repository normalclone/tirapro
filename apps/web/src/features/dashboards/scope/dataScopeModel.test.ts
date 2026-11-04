import { describe, expect, it } from 'vitest';
import { findDashboardTemplate } from '@tirapro/shared';
import {
  dataScopeIssue,
  initialScopeFor,
  sameScope,
  scopeValueOf,
  toScopeFields,
  type DataScopeValue,
} from './dataScopeModel';

const v = (over: Partial<DataScopeValue>): DataScopeValue => ({
  dataScope: 'PROJECT',
  scopeProjectId: '',
  scopeProgramId: '',
  ...over,
});

describe('dataScopeModel', () => {
  it('chưa chọn đích thì báo thiếu; ORG luôn hợp lệ', () => {
    expect(dataScopeIssue(v({}))).toBe('Chọn dự án');
    expect(dataScopeIssue(v({ dataScope: 'GROUP' }))).toBe('Chọn nhóm dự án');
    expect(dataScopeIssue(v({ scopeProjectId: 'p' }))).toBeNull();
    expect(dataScopeIssue(v({ dataScope: 'ORG' }))).toBeNull();
  });
  it('toScopeFields chỉ gửi id của phạm vi đang chọn (không mang id cũ của phạm vi khác)', () => {
    expect(toScopeFields(v({ scopeProjectId: 'p', scopeProgramId: 'g' }))).toEqual({
      dataScope: 'PROJECT',
      scopeProjectId: 'p',
    });
    expect(
      toScopeFields(v({ dataScope: 'GROUP', scopeProjectId: 'p', scopeProgramId: 'g' })),
    ).toEqual({
      dataScope: 'GROUP',
      scopeProgramId: 'g',
    });
    expect(toScopeFields(v({ dataScope: 'ORG', scopeProjectId: 'p' }))).toEqual({
      dataScope: 'ORG',
    });
  });
  it('sameScope so đúng id của phạm vi; bỏ qua id thừa', () => {
    expect(
      sameScope(v({ scopeProjectId: 'p' }), v({ scopeProjectId: 'p', scopeProgramId: 'x' })),
    ).toBe(true);
    expect(sameScope(v({ scopeProjectId: 'p' }), v({ scopeProjectId: 'q' }))).toBe(false);
    expect(sameScope(v({ dataScope: 'ORG' }), v({}))).toBe(false);
  });
  it('scopeValueOf đổi null → chuỗi rỗng', () => {
    expect(
      scopeValueOf({ dataScope: 'GROUP', scopeProjectId: null, scopeProgramId: null }),
    ).toEqual({
      dataScope: 'GROUP',
      scopeProjectId: '',
      scopeProgramId: '',
    });
  });
  it('initialScopeFor: phạm vi gợi ý của mẫu; ORG bị khoá với người không phải admin → phạm vi dùng được đầu tiên', () => {
    const pm = findDashboardTemplate('project-overview')!;
    expect(initialScopeFor(pm, false).dataScope).toBe('PROJECT');
    const org = findDashboardTemplate('org-manager')!;
    expect(initialScopeFor(org, false).dataScope).toBe('GROUP');
    expect(initialScopeFor({ ...org, defaultScope: 'ORG' }, false).dataScope).toBe('GROUP');
    expect(initialScopeFor({ ...org, defaultScope: 'ORG' }, true).dataScope).toBe('ORG');
  });
});
