/**
 * Tirapro — nạp danh mục quyền + vai trò HỆ THỐNG cho DB mới (không nạp dữ liệu demo).
 * DB sạch chưa có vai trò thì đăng ký/tạo workspace lỗi 500 "System role chưa được seed".
 * Chỉ THÊM (quyền, vai trò, quyền còn thiếu của vai trò) — không gỡ gì, chạy lại trên DB thật an toàn.
 * Khác `db:seed`: lệnh đó làm mới (xoá) workspace demo, không dùng cho dữ liệu thật.
 *
 *   pnpm --filter @tirapro/api run db:seed:roles [-- --dry-run]
 *
 * Cần DATABASE_URL và đã build @tirapro/types (`pnpm --filter @tirapro/types build`).
 */
import { PrismaClient } from '@prisma/client';
import {
  PERMISSION_CATALOG,
  SYSTEM_ROLES,
  SYSTEM_ROLE_META,
  SYSTEM_ROLE_PERMISSIONS,
  SYSTEM_ROLE_SCOPE,
} from '@tirapro/types';

const dryRun = process.argv.includes('--dry-run');
const prisma = new PrismaClient();
let addedPerms = 0;
let addedRoles = 0;
let addedGrants = 0;
try {
  const existing = new Set(
    (await prisma.permission.findMany({ select: { key: true } })).map((p) => p.key),
  );
  for (const def of PERMISSION_CATALOG) {
    if (existing.has(def.key)) continue;
    addedPerms++;
    if (!dryRun) {
      await prisma.permission.create({
        data: { key: def.key, description: def.description, scope: def.scope },
      });
    }
  }
  const permByKey = new Map(
    (await prisma.permission.findMany({ select: { id: true, key: true } })).map((p) => [
      p.key,
      p.id,
    ]),
  );

  for (const name of Object.values(SYSTEM_ROLES)) {
    const scope = SYSTEM_ROLE_SCOPE[name];
    let role = await prisma.role.findFirst({
      where: { workspaceId: null, isSystem: true, name, scope },
      select: { id: true, permissions: { select: { permission: { select: { key: true } } } } },
    });
    if (!role) {
      addedRoles++;
      console.log(`+ vai trò ${name}`);
      if (dryRun) {
        addedGrants += SYSTEM_ROLE_PERMISSIONS[name].length;
        continue;
      }
      const meta = SYSTEM_ROLE_META[name];
      const created = await prisma.role.create({
        data: { name, scope, isSystem: true, description: meta.description, color: meta.color },
        select: { id: true },
      });
      role = { id: created.id, permissions: [] };
    }
    const has = new Set(role.permissions.map((p) => p.permission.key));
    const missing = SYSTEM_ROLE_PERMISSIONS[name].filter((k) => !has.has(k) && permByKey.has(k));
    addedGrants += missing.length;
    if (missing.length && !dryRun) {
      await prisma.rolePermission.createMany({
        data: missing.map((k) => ({ roleId: role.id, permissionId: permByKey.get(k) })),
        skipDuplicates: true,
      });
    }
  }
} finally {
  await prisma.$disconnect();
}
console.log(
  `${dryRun ? '[dry-run] sẽ thêm' : 'Đã thêm'}: ${addedPerms} quyền, ${addedRoles} vai trò, ${addedGrants} lượt gán quyền.`,
);
