/**
 * Tirapro — CHỈ ĐỌC: liệt kê người lệch giữa Quản trị hệ thống (`User.isSystemAdmin`) và Quản trị tổ chức (vai trò có quyền
 * `organization:admin`). Chạy sau khi triển khai "một vai trò Quản trị". Thoát mã 1 nếu có người lệch.
 *
 *   pnpm --filter @tirapro/api run admins:check
 *
 * Cần DATABASE_URL.
 */
import { PrismaClient } from '@prisma/client';
import { findAdminMismatches } from './lib/admin-mismatch.mjs';

const prisma = new PrismaClient();
let bad = [];
try {
  const rows = await prisma.user.findMany({
    where: {
      OR: [
        { isSystemAdmin: true },
        {
          organizationMemberships: {
            some: {
              roles: {
                some: {
                  role: {
                    permissions: { some: { permission: { key: 'organization:admin' } } },
                  },
                },
              },
            },
          },
        },
      ],
    },
    select: {
      id: true,
      email: true,
      displayName: true,
      status: true,
      isSystemAdmin: true,
      organizationMemberships: {
        where: {
          roles: {
            some: {
              role: { permissions: { some: { permission: { key: 'organization:admin' } } } },
            },
          },
        },
        select: { organizationId: true },
      },
    },
  });
  const users = rows.map(({ organizationMemberships, ...u }) => ({
    ...u,
    adminOrganizations: organizationMemberships.map((m) => m.organizationId),
  }));
  bad = findAdminMismatches(users);
  for (const u of bad) {
    const what =
      u.kind === 'FLAG_WITHOUT_ROLE'
        ? 'là Quản trị hệ thống nhưng KHÔNG là Quản trị tổ chức nào'
        : `là Quản trị tổ chức (${u.adminOrganizations.length} tổ chức) nhưng CHƯA là Quản trị hệ thống`;
    console.log(`${u.displayName} <${u.email}>: ${what}`);
  }
} finally {
  await prisma.$disconnect();
}
if (bad.length) {
  console.log(
    `\nLệch ở ${bad.length} tài khoản — bật/tắt "Quản trị" ở Quản trị › Tài khoản để đồng bộ.`,
  );
  process.exit(1);
}
console.log('OK, hai cờ khớp');
