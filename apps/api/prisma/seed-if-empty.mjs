// Nạp dữ liệu demo CHỈ khi DB rỗng (chưa có Tổ chức nào).
// Dùng cho hosting free tier (không có preDeployCommand / Shell): chạy trong startCommand,
// migrate/db:raw idempotent chạy mỗi lần khởi động, còn seed chỉ chạy 1 lần ở lần boot đầu.
import { spawnSync } from 'node:child_process';

const { PrismaClient } = await import('@prisma/client');
const prisma = new PrismaClient();
let count = 0;
try {
  count = await prisma.organization.count();
} catch (e) {
  console.error('seed-if-empty: không đếm được organization:', e?.message);
}
await prisma.$disconnect();

if (count > 0) {
  console.log(`seed-if-empty: đã có ${count} tổ chức → bỏ qua seed.`);
  process.exit(0);
}

console.log('seed-if-empty: DB rỗng → nạp dữ liệu demo…');
const r = spawnSync('pnpm', ['exec', 'tsx', 'prisma/seed.ts'], { stdio: 'inherit', shell: true });
process.exit(r.status ?? 0);
