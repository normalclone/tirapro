import { describe, expect, it, vi } from 'vitest';
const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/lib/api', () => ({ api: { get } }));
import { fetchSprintIssues } from './api';

const page = (ids: string[], next: string | null) => ({
  data: {
    success: true,
    data: ids.map((id) => ({ id, key: id })),
    pageInfo: { hasNextPage: next !== null, endCursor: next },
    meta: {},
  },
});

describe('fetchSprintIssues', () => {
  it('lọc theo sprint ngay ở máy chủ và đi theo cursor đến hết', async () => {
    get.mockResolvedValueOnce(page(['a', 'b'], 'c1')).mockResolvedValueOnce(page(['c'], null));
    const r = await fetchSprintIssues('p1', 's1');
    expect(r.issues.map((i) => i.id)).toEqual(['a', 'b', 'c']);
    expect(r.truncated).toBe(false);
    const urls = get.mock.calls.map((c) => c[0]);
    expect(urls[0]).toContain('projectId=p1');
    expect(urls[0]).toContain('sprintId=s1');
    expect(urls[0]).not.toContain('cursor=');
    expect(urls[1]).toContain('cursor=c1');
  });

  it('chạm trần → cắt và báo truncated (không im lặng thiếu việc)', async () => {
    get.mockReset();
    get.mockResolvedValueOnce(page(['a', 'b'], 'c1')).mockResolvedValueOnce(page(['c', 'd'], 'c2'));
    const r = await fetchSprintIssues('p1', 's1', 3);
    expect(r.issues).toHaveLength(4);
    expect(r.truncated).toBe(true);
    expect(get).toHaveBeenCalledTimes(2);
  });
});
