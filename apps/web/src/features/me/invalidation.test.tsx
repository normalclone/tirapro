// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type * as ApiModule from '@/lib/api';
import { useRetractIssue } from '@/features/issue-edit/api';
import { keys } from '@/lib/queryKeys';

vi.mock('@/lib/api', async (orig) => {
  const real = await orig<typeof ApiModule>();
  return { ...real, api: { post: vi.fn().mockResolvedValue({ data: {} }) } };
});

describe('trang Của tôi nạp lại khi việc bị xoá/thu hồi ở nơi khác', () => {
  it('xoá/thu hồi việc làm cũ cùng nhóm với "Việc của tôi"/"Bug tôi báo" của trang chủ', async () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, 'invalidateQueries');
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useRetractIssue(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ id: 'i1', key: 'AAA-1', projectId: 'p1' });
    });
    const invalidated = spy.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey));
    expect(invalidated).toContain(JSON.stringify(keys.dashboard.myIssues));
    expect(invalidated).toContain(JSON.stringify(keys.meOverview));
  });
});
