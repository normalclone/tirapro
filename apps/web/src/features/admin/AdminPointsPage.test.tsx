import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_POINTS_FORMULA } from '@tirapro/shared';
import { keys } from '@/lib/queryKeys';

vi.mock('@/stores/auth', () => {
  const state: Record<string, unknown> = {
    user: { id: 'u', isSystemAdmin: true },
    permissions: [],
  };
  const useAuth = Object.assign(<T,>(sel: (s: Record<string, unknown>) => T) => sel(state), {
    setState: () => undefined,
    getState: () => state,
  });
  return { useAuth };
});
import { AdminPointsPage, POINTS_SAVED_TOAST } from './AdminPointsPage';

const src = (rel: string) => readFileSync(join(__dirname, rel), 'utf8');

function html(loaded = true) {
  const qc = new QueryClient();
  if (loaded) qc.setQueryData(keys.admin.pointsFormula, DEFAULT_POINTS_FORMULA);
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <AdminPointsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('trang Quản trị → Cách tính điểm', () => {
  it('tiêu đề "Cách tính điểm" và ba bảng nhỏ: điểm gốc / độ khó / ưu tiên, mỗi ô có tên truy cập', () => {
    const h = html();
    expect(h).toContain('Cách tính điểm');
    for (const t of ['Điểm gốc theo loại', 'Hệ số độ khó', 'Hệ số ưu tiên']) expect(h).toContain(t);
    expect(h).toContain('aria-label="Điểm gốc theo loại: Bug"');
    expect(h).toContain('aria-label="Hệ số độ khó: Rất khó"');
    expect(h).toContain('aria-label="Hệ số ưu tiên: High"');
  });
  it('dòng ví dụ sống mặc định "Bug · Khó · High": ra 9 theo bảng hiện hành', () => {
    expect(html()).toContain('Bug · Khó · High = 2×3×1.5 = 9');
  });
  it('chưa sửa gì thì nút Lưu bị khoá; có nút Khôi phục mặc định', () => {
    const h = html();
    expect(h).toMatch(/<button[^>]*disabled=""[^>]*>Lưu bảng hệ số<\/button>/);
    expect(h).toContain('Khôi phục mặc định');
  });
  it('chưa tải xong: vẫn có tiêu đề (đúng một h1) và khung chờ, không có ô nhập', () => {
    const h = html(false);
    expect(h).toContain('Cách tính điểm');
    expect(h).not.toContain('<input');
  });
  it('toast sau khi lưu đúng lời yêu cầu', () => {
    expect(POINTS_SAVED_TOAST).toBe('Đã lưu — đang tính lại điểm toàn hệ thống');
    expect(src('AdminPointsPage.tsx')).toContain('toast.success(POINTS_SAVED_TOAST)');
  });
  it('nối vào menu quản trị + route /admin/points; chỉ lưu khi bảng hợp lệ (draftToFormula)', () => {
    expect(readFileSync(join(__dirname, '../../app/router.tsx'), 'utf8')).toContain(
      "path: 'points', element: <AdminPointsPage />",
    );
    expect(readFileSync(join(__dirname, '../../components/layout/navItems.tsx'), 'utf8')).toContain(
      "to: '/admin/points'",
    );
    const s = src('AdminPointsPage.tsx');
    expect(s).toContain('if (!formula) return;');
    expect(s).toContain('canSave = dirty && !!formula');
  });
});
