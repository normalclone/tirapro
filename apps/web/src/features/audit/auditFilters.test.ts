import { describe, expect, it } from 'vitest';
import { parseDayInput, toAuditQuery } from './auditFilters';

describe('toAuditQuery', () => {
  it('bỏ các trường rỗng', () => {
    expect(toAuditQuery({ action: '', actorId: '', from: '', to: '' })).toEqual({});
  });

  it('giữ loại sự kiện + người thực hiện', () => {
    expect(toAuditQuery({ action: 'role.created', actorId: 'u1', from: '', to: '' })).toEqual({
      action: 'role.created',
      actorId: 'u1',
    });
  });

  it('from = 00:00:00.000 đầu ngày, to = 23:59:59.999 cuối ngày (giờ địa phương) dạng ISO', () => {
    const q = toAuditQuery({ action: '', actorId: '', from: '01/10/2026', to: '31/10/2026' });
    expect(q.from).toBe(new Date(2026, 9, 1, 0, 0, 0, 0).toISOString());
    expect(q.to).toBe(new Date(2026, 9, 31, 23, 59, 59, 999).toISOString());
  });

  it('nhận cả dạng yyyy-MM-dd của ô chọn ngày; ngày không hợp lệ bị bỏ', () => {
    const q = toAuditQuery({ action: '', actorId: '', from: '2026-10-01', to: '31/02/2026' });
    expect(q.from).toBe(new Date(2026, 9, 1, 0, 0, 0, 0).toISOString());
    expect(q.to).toBeUndefined();
  });
});

describe('parseDayInput', () => {
  it('dd/MM/yyyy và yyyy-MM-dd cho cùng một ngày; sai định dạng → null', () => {
    expect(parseDayInput('05/03/2026')).toEqual({ y: 2026, m: 3, d: 5 });
    expect(parseDayInput('2026-03-05')).toEqual({ y: 2026, m: 3, d: 5 });
    expect(parseDayInput('5-3-26')).toBeNull();
    expect(parseDayInput('')).toBeNull();
  });
});
