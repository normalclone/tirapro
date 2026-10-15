import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import type { IssueDto } from '@tirapro/types';
import { keys } from '@/lib/queryKeys';

const get = vi.fn();
vi.mock('@/lib/api', () => ({ api: { get: (...a: unknown[]) => get(...a) as unknown } }));

import { fetchAllProjectIssues, ISSUE_LIST_HARD_CAP, type IssueListMeta } from './api';

const mk = (from: number, n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `i${from + i}` }) as unknown as IssueDto);

/** Trả trang theo cursor: mỗi trang 100 việc, tổng `total`. */
function serve(total: number) {
  get.mockImplementation((url: string) => {
    const q = new URLSearchParams(url.split('?')[1]);
    const start = q.get('cursor') ? Number(q.get('cursor')!.slice(1)) + 1 : 0;
    const n = Math.min(100, total - start);
    const data = mk(start, n);
    const hasNextPage = start + n < total;
    return Promise.resolve({
      data: {
        data,
        pageInfo: {
          hasNextPage,
          endCursor: data.length ? data[data.length - 1]!.id : null,
          limit: 100,
        },
      },
    });
  });
}

describe('fetchAllProjectIssues', () => {
  beforeEach(() => {
    get.mockReset();
  });

  it('đi theo cursor, gom đủ 250 việc, không cắt', async () => {
    serve(250);
    const qc = new QueryClient();
    const list = await fetchAllProjectIssues(qc, 'p1');
    expect(list).toHaveLength(250);
    expect(get).toHaveBeenCalledTimes(3);
    expect(get.mock.calls[1]![0]).toContain('cursor=i99');
    expect(qc.getQueryData<IssueListMeta>(keys.issues.byProjectMeta('p1'))).toEqual({
      truncated: false,
      loaded: 250,
    });
  });

  it('chạm HARD_CAP thì dừng và đánh dấu truncated', async () => {
    serve(ISSUE_LIST_HARD_CAP + 500);
    const qc = new QueryClient();
    const list = await fetchAllProjectIssues(qc, 'p1');
    expect(list).toHaveLength(ISSUE_LIST_HARD_CAP);
    expect(qc.getQueryData<IssueListMeta>(keys.issues.byProjectMeta('p1'))?.truncated).toBe(true);
  });

  it('đúng bằng HARD_CAP và hết dữ liệu → không truncated', async () => {
    serve(ISSUE_LIST_HARD_CAP);
    const qc = new QueryClient();
    await fetchAllProjectIssues(qc, 'p1');
    expect(qc.getQueryData<IssueListMeta>(keys.issues.byProjectMeta('p1'))?.truncated).toBe(false);
  });
});
