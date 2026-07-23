/**
 * Làm giàu demo data (idempotent, KHÔNG xoá gì) — chạy trực tiếp trên DB hiện có.
 * Bù cho việc seed.ts bỏ qua demo-data khi workspace đã tồn tại.
 *   tsx prisma/enrich-demo.ts   (cần DATABASE_URL trong env)
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const DAY = 86_400_000;

async function main() {
  const ws = await prisma.workspace.findFirst({ orderBy: { createdAt: 'asc' } });
  if (!ws) throw new Error('Không tìm thấy workspace');
  const project = await prisma.project.findFirst({ where: { key: 'DEMO', workspaceId: ws.id } });
  if (!project) throw new Error('Không tìm thấy project DEMO');

  const admin = await prisma.user.findFirst({ where: { email: 'admin@projira.dev' } });
  const users = await prisma.user.findMany({ where: { workspaceMemberships: { some: { workspaceId: ws.id } } } }).catch(() => []);
  const everyUser = users.length ? users : await prisma.user.findMany({ take: 3 });
  const adminId = admin?.id ?? everyUser[0].id;
  const others = everyUser.filter((u) => u.id !== adminId);
  const devId = others[0]?.id ?? adminId;
  const reporterId = others[1]?.id ?? devId;

  const issues = await prisma.issue.findMany({ where: { projectId: project.id, deletedAt: null }, orderBy: { number: 'asc' } });
  console.log(`ws=${ws.id} project=${project.id} users=${everyUser.length} issues=${issues.length}`);

  // 1. Active sprint endDate (+14d) để burndown trải nhiều ngày
  const active = await prisma.sprint.findFirst({ where: { projectId: project.id, state: 'ACTIVE', deletedAt: null } });
  if (active) {
    const start = active.startDate ?? new Date();
    await prisma.sprint.update({ where: { id: active.id }, data: { startDate: start, endDate: new Date(start.getTime() + 14 * DAY) } });
    console.log('  ✓ active sprint endDate +14d');
  }

  // 2. CLOSED "Sprint 0" + 2 snapshots (velocity)
  let closed = await prisma.sprint.findFirst({ where: { projectId: project.id, name: 'Sprint 0' } });
  if (!closed) {
    closed = await prisma.sprint.create({
      data: {
        projectId: project.id, name: 'Sprint 0', state: 'CLOSED', sequence: 0,
        startDate: new Date(Date.now() - 21 * DAY), endDate: new Date(Date.now() - 7 * DAY), completeDate: new Date(Date.now() - 7 * DAY),
      },
    });
  }
  for (const snap of [
    { kind: 'START' as const, snapshotAt: new Date(Date.now() - 21 * DAY), committedPoints: 21, completedPoints: 0, remainingPoints: 21, committedCount: 6, completedCount: 0 },
    { kind: 'CLOSE' as const, snapshotAt: new Date(Date.now() - 7 * DAY), committedPoints: 21, completedPoints: 18, remainingPoints: 3, committedCount: 6, completedCount: 5 },
  ]) {
    const exists = await prisma.sprintSnapshot.findFirst({ where: { sprintId: closed.id, kind: snap.kind } });
    if (!exists) await prisma.sprintSnapshot.create({ data: { sprintId: closed.id, ...snap } });
  }
  console.log('  ✓ closed sprint + snapshots');

  // 3. Gán issue (rotate) — đảm bảo admin có >=2
  const rotation = [adminId, devId, adminId, reporterId];
  const half = Math.ceil(issues.length / 2);
  for (let i = 0; i < half; i++) {
    await prisma.issue.update({ where: { id: issues[i].id }, data: { assigneeId: rotation[i % rotation.length] } });
  }
  console.log(`  ✓ gán ${half} issue`);

  // 4. Labels + gắn vào issue
  const labelSpecs = [{ name: 'backend', color: '#2563eb' }, { name: 'frontend', color: '#16a34a' }, { name: 'urgent', color: '#dc2626' }];
  const labelIds: string[] = [];
  for (const spec of labelSpecs) {
    let label = await prisma.label.findFirst({ where: { projectId: project.id, name: spec.name } });
    if (!label) label = await prisma.label.create({ data: { projectId: project.id, ...spec } });
    labelIds.push(label.id);
  }
  for (let i = 0; i < Math.min(3, issues.length); i++) {
    const labelId = labelIds[i % labelIds.length];
    const exists = await prisma.issueLabel.findFirst({ where: { issueId: issues[i].id, labelId } });
    if (!exists) await prisma.issueLabel.create({ data: { issueId: issues[i].id, labelId } });
  }
  console.log('  ✓ 3 labels + gắn');

  // 5. Notifications cho admin (bell)
  const notifs = [
    { type: 'ISSUE_ASSIGNED' as const, issue: issues[0] },
    { type: 'COMMENT_ADDED' as const, issue: issues[1] ?? issues[0] },
    { type: 'STATUS_CHANGED' as const, issue: issues[2] ?? issues[0] },
  ];
  for (const n of notifs) {
    const exists = await prisma.notification.findFirst({ where: { recipientId: adminId, type: n.type, issueId: n.issue.id } });
    if (!exists) {
      await prisma.notification.create({
        data: { recipientId: adminId, workspaceId: ws.id, type: n.type, issueId: n.issue.id, actorId: devId, payload: { key: n.issue.key, summary: n.issue.summary }, readAt: null },
      });
    }
  }
  console.log('  ✓ 3 notifications (admin)');

  // 6. Guide TOUR board-intro
  const guideKey = 'board-intro';
  const guideExists = await prisma.guide.findFirst({ where: { workspaceId: ws.id, key: guideKey } });
  if (!guideExists) {
    await prisma.guide.create({
      data: {
        workspaceId: ws.id, type: 'TOUR', key: guideKey, screen: '/p/:key/board',
        title: 'Giới thiệu bảng', description: 'Tham quan nhanh màn Bảng', isPublished: true, order: 0, audience: [],
        content: {
          steps: [
            { selector: '[data-tour="topbar-context"]', title: 'Thanh trên', body: 'Ngữ cảnh & hành động nhanh ở đây.', order: 0 },
            { selector: '[data-tour="board-ai"]', title: 'Tạo issue bằng AI', body: 'Mô tả yêu cầu, AI sẽ phân rã thành issue.', order: 1 },
            { selector: '[data-tour="board-backlog"]', title: 'Backlog', body: 'Lập kế hoạch sprint trong Backlog.', order: 2 },
          ],
        },
      },
    });
  }
  console.log('  ✓ guide board-intro');

  // 7. Đặt 1-2 issue vào triage PENDING để demo Triage inbox
  for (let i = 0; i < Math.min(2, issues.length); i++) {
    await prisma.issue.update({ where: { id: issues[issues.length - 1 - i].id }, data: { triageState: 'PENDING', occurrenceCount: i === 0 ? 3 : 1 } });
  }
  console.log('  ✓ 2 issue PENDING triage');

  console.log('✅ enrich xong');
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => void prisma.$disconnect());
