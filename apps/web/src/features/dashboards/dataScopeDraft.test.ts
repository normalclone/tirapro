import { describe, expect, it } from 'vitest';
import { isDirty, toDashboardBody, type DashboardDraft } from './layoutOps';

const base: DashboardDraft = {
  name: 'Bảng',
  description: '',
  scope: 'PRIVATE',
  projectId: '',
  teamId: '',
  widgets: [],
};

describe('phạm vi dữ liệu trong bản nháp (L6)', () => {
  it('chưa đổi phạm vi → body KHÔNG có trường phạm vi dữ liệu (máy chủ giữ nguyên, không 422 với nhóm đã xoá)', () => {
    const body = toDashboardBody(base);
    expect(body).not.toHaveProperty('dataScope');
    expect(body).not.toHaveProperty('scopeProjectId');
    expect(body).not.toHaveProperty('scopeProgramId');
  });

  it('đã đổi → gửi đúng phạm vi + chỉ id của phạm vi đó', () => {
    expect(
      toDashboardBody({
        ...base,
        dataScope: { dataScope: 'GROUP', scopeProjectId: 'old', scopeProgramId: 'g1' },
      }),
    ).toMatchObject({ dataScope: 'GROUP', scopeProgramId: 'g1' });
    const org = toDashboardBody({
      ...base,
      dataScope: { dataScope: 'ORG', scopeProjectId: '', scopeProgramId: '' },
    });
    expect(org.dataScope).toBe('ORG');
    expect(org).not.toHaveProperty('scopeProgramId');
  });

  it('đổi phạm vi là thay đổi chưa lưu', () => {
    expect(isDirty(base, base)).toBe(false);
    expect(
      isDirty(base, {
        ...base,
        dataScope: { dataScope: 'ORG', scopeProjectId: '', scopeProgramId: '' },
      }),
    ).toBe(true);
  });
});
