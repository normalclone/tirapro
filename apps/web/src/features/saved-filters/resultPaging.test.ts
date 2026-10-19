import { describe, expect, it } from 'vitest';
import type { IssueDto } from '@tirapro/types';
import {
  RESULTS_PAGE_SIZE,
  appendResults,
  pageOfIndex,
  resultCountLabel,
  toResultSet,
} from './resultPaging';

const iss = (id: string) => ({ id }) as IssueDto;
const env = (ids: string[], pageInfo: unknown) =>
  ({ data: ids.map(iss), pageInfo }) as Parameters<typeof toResultSet>[0];

describe('toResultSet (WO-I3)', () => {
  it('còn trang kế → hasMore + nextCursor', () => {
    const r = toResultSet(env(['a'], { hasNextPage: true, endCursor: 'c1', limit: 100 }));
    expect(r).toMatchObject({ hasMore: true, nextCursor: 'c1' });
    expect(r.items.map((i) => i.id)).toEqual(['a']);
  });
  it('hết / thiếu cursor / pageInfo kiểu khác → không còn', () => {
    expect(toResultSet(env([], { hasNextPage: false, endCursor: null, limit: 100 })).hasMore).toBe(
      false,
    );
    expect(toResultSet(env([], { hasNextPage: true, endCursor: null, limit: 100 })).hasMore).toBe(
      false,
    );
    expect(
      toResultSet(env([], { page: 1, pageSize: 10, totalItems: 3, totalPages: 1 })).hasMore,
    ).toBe(false);
  });
});

describe('appendResults / resultCountLabel', () => {
  it('nối trang kế, bỏ trùng, lấy cursor mới', () => {
    const base = { items: [iss('a'), iss('b')], hasMore: true, nextCursor: 'c1' };
    const next = { items: [iss('b'), iss('c')], hasMore: false, nextCursor: null };
    const m = appendResults(base, next);
    expect(m.items.map((i) => i.id)).toEqual(['a', 'b', 'c']);
    expect(m).toMatchObject({ hasMore: false, nextCursor: null });
  });
  it('nhãn đếm: không coi số bị cắt là tổng', () => {
    expect(resultCountLabel(100, true)).toBe('100 công việc đầu tiên');
    expect(resultCountLabel(37, false)).toBe('37 công việc');
  });
});

describe('pageOfIndex — trang (1-based) chứa dòng thứ i của kết quả đã nạp', () => {
  it('25 dòng/trang', () => {
    expect(RESULTS_PAGE_SIZE).toBe(25);
    expect(pageOfIndex(0)).toBe(1);
    expect(pageOfIndex(24)).toBe(1);
    expect(pageOfIndex(25)).toBe(2);
    expect(pageOfIndex(99)).toBe(4);
  });
  it('chỉ số âm → trang 1', () => expect(pageOfIndex(-1)).toBe(1));
});
