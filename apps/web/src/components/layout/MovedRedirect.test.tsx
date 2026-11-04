// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

const toast = vi.hoisted(() => ({ info: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

import { LEGACY_ROUTES } from '@/lib/legacyRoutes';
import { MovedRedirect } from './MovedRedirect';

function Where() {
  const l = useLocation();
  return <output data-testid="where">{l.pathname + l.search}</output>;
}

afterEach(() => {
  cleanup();
  toast.info.mockReset();
});

function go(from: string) {
  const r = LEGACY_ROUTES.find((x) => x.from === from)!;
  render(
    <MemoryRouter initialEntries={[`/${from}`]}>
      <Routes>
        <Route path={`/${from}`} element={<MovedRedirect to={r.to} message={r.message} />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('MovedRedirect', () => {
  it('/manage/goals → /projects và báo đúng một lần', () => {
    go('manage/goals');
    expect(screen.getByTestId('where').textContent).toBe('/projects');
    expect(toast.info).toHaveBeenCalledTimes(1);
    expect(toast.info.mock.calls[0]![0]).toMatch(/Mục tiêu giờ nằm trong từng dự án/);
  });
  it('/manage/resources → /members?tab=resources', () => {
    go('manage/resources');
    expect(screen.getByTestId('where').textContent).toBe('/members?tab=resources');
  });
  it('/manage (gốc) → Dự án theo nhóm, không báo gì; /manage/portfolio → cùng đích, có báo', () => {
    go('manage');
    expect(screen.getByTestId('where').textContent).toBe('/projects?view=groups');
    expect(toast.info).not.toHaveBeenCalled();
    cleanup();
    go('manage/portfolio');
    expect(screen.getByTestId('where').textContent).toBe('/projects?view=groups');
    expect(toast.info).toHaveBeenCalledTimes(1);
  });
  it('mọi liên kết cũ đến được đích một bước (không chuyển tiếp lần hai)', () => {
    for (const r of LEGACY_ROUTES) {
      cleanup();
      go(r.from);
      expect(screen.getByTestId('where').textContent, r.from).toBe(r.to);
    }
  });
});
