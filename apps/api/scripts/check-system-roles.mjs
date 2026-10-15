/**
 * Tirapro — so khớp bộ quyền của vai trò HỆ THỐNG trong DB với SYSTEM_ROLE_PERMISSIONS (packages/types, nguồn sự thật).
 * Dùng ở checklist triển khai / CI: DB chỉ được seed khi rỗng và migration chỉ THÊM quyền, nên bộ quyền thực có thể
 * lệch hằng số sau khi đổi code. Thoát mã 1 nếu lệch (in `+thiếu` = có trong code nhưng chưa có ở DB, `-thừa` ngược lại).
 *
 *   pnpm --filter @tirapro/api db:check-roles
 *
 * Cần DATABASE_URL và đã build @tirapro/types (`pnpm --filter @tirapro/types build`).
 */
import { PrismaClient } from '@prisma/client';
import { SYSTEM_ROLES, SYSTEM_ROLE_PERMISSIONS, SYSTEM_ROLE_SCOPE } from '@tirapro/types';

const prisma = new PrismaClient();
let diff = 0;
try {
  for (const name of Object.values(SYSTEM_ROLES)) {
    const role = await prisma.role.findFirst({
      where: { workspaceId: null, isSystem: true, name, scope: SYSTEM_ROLE_SCOPE[name] },
      select: { permissions: { select: { permission: { select: { key: true } } } } },
    });
    if (!role) {
      console.log(`${name}: THIẾU vai trò trong DB (chạy db:seed?)`);
      diff++;
      continue;
    }
    const actual = new Set(role.permissions.map((p) => p.permission.key));
    const expected = new Set(SYSTEM_ROLE_PERMISSIONS[name]);
    const missing = [...expected].filter((k) => !actual.has(k));
    const extra = [...actual].filter((k) => !expected.has(k));
    if (missing.length || extra.length) {
      diff++;
      console.log(
        `${name}: ${[...missing.map((k) => `+${k}`), ...extra.map((k) => `-${k}`)].join(' ')}`,
      );
    }
  }
} finally {
  await prisma.$disconnect();
}
if (diff) {
  console.log(`\nLệch ở ${diff} vai trò hệ thống.`);
  process.exit(1);
}
console.log('OK, không lệch');
