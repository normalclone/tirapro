import { describe, expect, it } from 'vitest';
import type { IssueDto } from '@tirapro/types';
import { applyQuickFilters, QUICK_FILTERS, type QuickFilterId } from './useQuickFilters';

const iss = (id: string, o: Record<string, unknown> = {}) =>
  ({
    id,
    assigneeId: null,
    reporterId: null,
    createdById: null,
    dueDate: null,
    type: { key: 'TASK' },
    status: { category: 'TODO' },
    ...o,
  }) as unknown as IssueDto;
const on = (...ids: QuickFilterId[]) => new Set<QuickFilterId>(ids);
const ids = (l: IssueDto[]) => l.map((i) => i.id);

describe('applyQuickFilters — Chỉ Bug / Tôi báo cáo', () => {
  const list = [
    iss('bug1', { type: { key: 'BUG' }, reporterId: 'me' }),
    iss('bug2', { type: { key: 'BUG' }, reporterId: 'other' }),
    iss('task1', { reporterId: 'me' }),
    iss('task2', { createdById: 'me' }),
    iss('custom', { type: { key: null } }),
  ];
  it('không bật chip nào => giữ nguyên', () =>
    expect(applyQuickFilters(list, on(), 'me')).toBe(list));
  it('Chỉ Bug', () =>
    expect(ids(applyQuickFilters(list, on('bug'), 'me'))).toEqual(['bug1', 'bug2']));
  it('Tôi báo cáo: reporterId hoặc createdById', () =>
    expect(ids(applyQuickFilters(list, on('reported'), 'me'))).toEqual(['bug1', 'task1', 'task2']));
  it('bật cả hai => giao của hai điều kiện', () =>
    expect(ids(applyQuickFilters(list, on('bug', 'reported'), 'me'))).toEqual(['bug1']));
  it('khách chưa đăng nhập (userId undefined) + Tôi báo cáo => rỗng', () =>
    expect(applyQuickFilters(list, on('reported'), undefined)).toEqual([]));
});
it('QUICK_FILTERS: id duy nhất, có nhãn và gợi ý', () => {
  expect(new Set(QUICK_FILTERS.map((f) => f.id)).size).toBe(QUICK_FILTERS.length);
  expect(QUICK_FILTERS.map((f) => f.id)).toEqual(expect.arrayContaining(['bug', 'reported']));
  for (const f of QUICK_FILTERS) {
    expect(f.label).toBeTruthy();
    expect(f.hint).toBeTruthy();
  }
});
