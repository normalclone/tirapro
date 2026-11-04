import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const router = readFileSync(join(__dirname, 'router.tsx'), 'utf8');

/** Đổi tên Workspace -> Organization: đường dẫn cũ của quản trị hệ thống vẫn dẫn vào trang mới (dấu trang đã lưu). */
describe('/admin/workspaces cũ chuyển sang /admin/organizations', () => {
  it('route con của /admin: trang mới tại `organizations`, đường cũ `workspaces` chuyển hướng (replace)', () => {
    expect(router).toMatch(/path: 'organizations', element: <AdminOrganizationsPage \/>/);
    expect(router).toMatch(
      /path: 'workspaces', element: <Navigate to="\/admin\/organizations" replace \/>/,
    );
  });
});
