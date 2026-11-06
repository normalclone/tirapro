/**
 * Tirapro — chạy MỘT lần TRƯỚC KHI triển khai "dự án công khai chỉ xem" (Organization Member không còn vai trò Developer mặc định).
 * Với mỗi dự án công khai còn sống, mỗi Organization Member chưa có ProjectMembership mà có hoạt động trong dự án (là người báo cáo /
 * được giao / bình luận / log giờ / tham gia việc của dự án) → tạo ProjectMembership vai trò Developer. In danh sách; `--dry-run`
 * không ghi. Idempotent (chạy lại: 0 người).
 *
 *   pnpm --filter @tirapro/api run public-members:materialize -- --dry-run
 *   pnpm --filter @tirapro/api run public-members:materialize
 *
 * Cần DATABASE_URL.
 */
import { PrismaClient } from '@prisma/client';
import { selectToMaterialize } from './lib/materialize-members.mjs';

const dryRun = process.argv.includes('--dry-run');
const prisma = new PrismaClient();
let total = 0;
try {
  const developer = await prisma.role.findFirst({
    where: { name: 'Developer', scope: 'PROJECT', organizationId: null, isSystem: true },
    select: { id: true },
  });
  if (!developer) throw new Error('Thiếu vai trò hệ thống Developer (chạy db:seed:roles)');

  const projects = await prisma.project.findMany({
    where: { isPrivate: false, deletedAt: null },
    select: { id: true, key: true, name: true, organizationId: true },
    orderBy: { key: 'asc' },
  });
  for (const p of projects) {
    const issueWhere = { projectId: p.id };
    const [reporters, assignees, commenters, loggers, participants, existing, memberRows] =
      await Promise.all([
        prisma.issue.findMany({
          where: { ...issueWhere, reporterId: { not: null } },
          distinct: ['reporterId'],
          select: { reporterId: true },
        }),
        prisma.issue.findMany({
          where: { ...issueWhere, assigneeId: { not: null } },
          distinct: ['assigneeId'],
          select: { assigneeId: true },
        }),
        prisma.comment.findMany({
          where: { issue: issueWhere, authorId: { not: null } },
          distinct: ['authorId'],
          select: { authorId: true },
        }),
        prisma.workLog.findMany({
          where: { issue: issueWhere },
          distinct: ['authorId'],
          select: { authorId: true },
        }),
        prisma.issueParticipant.findMany({
          where: { issue: issueWhere },
          distinct: ['userId'],
          select: { userId: true },
        }),
        prisma.projectMembership.findMany({ where: { projectId: p.id }, select: { userId: true } }),
        prisma.organizationMembership.findMany({
          where: {
            organizationId: p.organizationId,
            user: { status: 'ACTIVE' },
            roles: {
              some: {
                role: { name: 'Organization Member', organizationId: null, isSystem: true },
              },
            },
          },
          select: { userId: true, user: { select: { displayName: true, email: true } } },
        }),
      ]);
    const activeUserIds = [
      ...reporters.map((r) => r.reporterId),
      ...assignees.map((r) => r.assigneeId),
      ...commenters.map((r) => r.authorId),
      ...loggers.map((r) => r.authorId),
      ...participants.map((r) => r.userId),
    ].filter(Boolean);
    const toAdd = selectToMaterialize({
      activeUserIds,
      memberOnlyIds: memberRows.map((m) => m.userId),
      existingIds: existing.map((m) => m.userId),
    });
    if (toAdd.length === 0) continue;
    const who = new Map(memberRows.map((m) => [m.userId, m.user]));
    console.log(`${p.key} (${p.name}): ${toAdd.length} người`);
    for (const id of toAdd) console.log(`  - ${who.get(id)?.displayName} <${who.get(id)?.email}>`);
    total += toAdd.length;
    if (dryRun) continue;
    await prisma.$transaction(async (tx) => {
      for (const userId of toAdd) {
        const m = await tx.projectMembership.upsert({
          where: { projectId_userId: { projectId: p.id, userId } },
          create: { projectId: p.id, userId, roleId: developer.id },
          update: {},
          select: { id: true },
        });
        await tx.projectMembershipRole.upsert({
          where: { membershipId_roleId: { membershipId: m.id, roleId: developer.id } },
          create: { membershipId: m.id, roleId: developer.id, direct: true },
          update: {},
        });
      }
    });
  }
} finally {
  await prisma.$disconnect();
}
console.log(
  dryRun
    ? `\n[dry-run] sẽ thêm ${total} thành viên dự án (vai trò Developer). Chạy lại không kèm --dry-run để ghi.`
    : `\nĐã thêm ${total} thành viên dự án (vai trò Developer).`,
);
