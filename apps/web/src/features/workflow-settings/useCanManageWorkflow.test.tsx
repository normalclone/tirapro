// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ApiModule from '@/lib/api';

const h = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/lib/api', async (orig) => {
  const real = await orig<typeof ApiModule>();
  return {
    ...real,
    api: { get: h.get, post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
  };
});

import { useAuth } from '@/stores/auth';
import { useCanManageWorkflow } from './useCanManageWorkflow';

function Probe({ projectId }: { projectId: string | null }) {
  const ok = useCanManageWorkflow({ projectId });
  return <span data-testid="can">{String(ok)}</span>;
}

function setup(opts: {
  projectId: string | null;
  organizationAdmin?: boolean;
  projectPerms?: Record<string, string[]>;
}) {
  act(() => {
    useAuth.setState({
      status: 'authed',
      user: { id: 'u', isSystemAdmin: false } as never,
      permissions: opts.organizationAdmin ? (['organization:admin'] as never) : [],
    });
  });
  h.get.mockImplementation((url: string) => {
    const m = /^\/projects\/([^/]+)\/permissions\/me$/.exec(url);
    if (m)
      return Promise.resolve({
        data: { projectId: m[1], permissions: opts.projectPerms?.[m[1]!] ?? [] },
      });
    return Promise.resolve({ data: [] }); // danh sách dự án: không lưu trữ
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <Probe projectId={opts.projectId} />
    </QueryClientProvider>,
  );
}

beforeEach(() => h.get.mockReset());
afterEach(cleanup);

describe('useCanManageWorkflow: ai sửa được quy trình trong giao diện', () => {
  it('Quản trị dự án sửa được quy trình do chính dự án đó sở hữu', async () => {
    setup({ projectId: 'A', projectPerms: { A: ['project:admin'] } });
    await waitFor(() => expect(screen.getByTestId('can').textContent).toBe('true'));
  });
  it('Quản trị dự án A không sửa được quy trình của dự án B', async () => {
    setup({ projectId: 'B', projectPerms: { A: ['project:admin'], B: ['project:view'] } });
    await waitFor(() => expect(h.get).toHaveBeenCalled());
    expect(screen.getByTestId('can').textContent).toBe('false');
  });
  it('quy trình chung của tổ chức: Quản trị dự án không sửa được, Quản trị chung sửa được', () => {
    setup({ projectId: null, projectPerms: { A: ['project:admin'] } });
    expect(screen.getByTestId('can').textContent).toBe('false');
    cleanup();
    setup({ projectId: null, organizationAdmin: true });
    expect(screen.getByTestId('can').textContent).toBe('true');
  });
});
