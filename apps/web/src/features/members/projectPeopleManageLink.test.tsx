// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as ApiModule from '@/lib/api';

const h = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/lib/api', async (orig) => {
  const real = await orig<typeof ApiModule>();
  return { ...real, api: { get: h.get } };
});
// Chỉ dự án p1 là Project Admin.
vi.mock('@/features/projects/permissions', () => ({
  useCan: (id?: string) => () => id === 'p1',
}));

import { ProjectPeopleView } from './ProjectPeopleView';

afterEach(cleanup);

describe('Trang Thành viên (người thường): lối tắt "Quản lý"', () => {
  it('chỉ hiện ở dự án mình là Project Admin, dẫn tới Cấu hình › Thành viên', async () => {
    h.get.mockImplementation((url: string) =>
      Promise.resolve({
        data:
          url === '/projects'
            ? [
                { id: 'p1', key: 'AAA', name: 'Alpha', archivedAt: null },
                { id: 'p2', key: 'BBB', name: 'Beta', archivedAt: null },
              ]
            : [],
      }),
    );
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <ProjectPeopleView />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const link = await screen.findByRole('link', { name: 'Quản lý thành viên dự án Alpha' });
    expect(link.getAttribute('href')).toBe('/p/AAA/config/members');
    expect(screen.queryByRole('link', { name: /Beta/ })).toBeNull();
  });
});
