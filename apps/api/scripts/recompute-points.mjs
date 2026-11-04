/**
 * Tirapro — tính lại điểm MỌI việc theo bảng hệ số (Loại × Độ khó × Ưu tiên) rồi cộng lại điểm mọi Epic.
 * Chạy MỘT lần sau `prisma migrate deploy` (deploy.sh) để việc cũ nhận điểm theo công thức — kể cả điểm nhập tay cũ
 * như 80 (việc cũ đều `pointsManual = false`). Idempotent: chỉ ghi việc có điểm KHÁC công thức, chạy lại cập nhật 0 việc.
 *
 * Cùng thuật toán với `PointsService.recomputeAll` (API chạy nền khi SA lưu bảng hệ số):
 *  - theo từng dự án, lô 500 việc; bỏ việc chỉnh tay (`pointsManual`) và Epic; việc đổi được tăng `version`;
 *  - không ghi lịch sử hoạt động từng việc;
 *  - Epic = tổng điểm việc con chưa xoá (kể cả sub-task), ghi khi khác và tăng `version`.
 * Không phát sự kiện realtime (script chạy lúc triển khai, chưa có ai mở trang).
 * Ghi bằng SQL thô và KHÔNG đổi `updatedAt` (SLA / "cập nhật gần đây" dựa vào nó; đây là tính lại của hệ thống, không phải
 * người dùng sửa). WHERE lặp lại đầu vào đã tính (loại, độ khó, ưu tiên) + `pointsManual = false` nên việc vừa bị người dùng
 * sửa giữa lúc đọc và ghi bị bỏ qua thay vì bị ghi đè.
 *
 *   pnpm --filter @tirapro/api run points:recompute
 *
 * Cần DATABASE_URL và đã build @tirapro/types + @tirapro/shared. In đúng MỘT dòng kết quả:
 *   recomputed N issues, M epics
 */
import { PrismaClient } from '@prisma/client';
import { DEFAULT_POINTS_FORMULA, computePoints, pointsFormulaSchema } from '@tirapro/shared';

const BATCH = 500;
const prisma = new PrismaClient();

async function loadFormula() {
  const row = await prisma.pointsFormulaConfig.findUnique({ where: { id: 'default' } });
  if (!row) return DEFAULT_POINTS_FORMULA;
  const parsed = pointsFormulaSchema.safeParse(row.formula);
  if (!parsed.success) {
    console.error('PointsFormulaConfig.formula không hợp lệ — dùng bảng mặc định');
    return DEFAULT_POINTS_FORMULA;
  }
  return parsed.data;
}

try {
  const formula = await loadFormula();
  const [types, priorities, projects] = await Promise.all([
    prisma.issueType.findMany({ select: { id: true, key: true } }),
    prisma.priority.findMany({ select: { id: true, name: true } }),
    prisma.project.findMany({ select: { id: true } }),
  ]);
  const typeKey = new Map(types.map((t) => [t.id, t.key]));
  const priorityName = new Map(priorities.map((p) => [p.id, p.name]));

  let issues = 0;
  for (const { id: projectId } of projects) {
    let cursor;
    for (;;) {
      // Cả việc đã xoá mềm: khôi phục về không bị lệch điểm (tổng Epic vẫn loại việc đã xoá).
      const rows = await prisma.issue.findMany({
        where: { projectId, pointsManual: false, NOT: { type: { key: 'EPIC' } } },
        select: { id: true, typeId: true, difficulty: true, priorityId: true, storyPoints: true },
        orderBy: { id: 'asc' },
        take: BATCH,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      if (rows.length === 0) break;
      cursor = rows[rows.length - 1].id;
      const changes = [];
      for (const r of rows) {
        const pts = computePoints(
          formula,
          typeKey.get(r.typeId) ?? null,
          r.difficulty,
          r.priorityId ? (priorityName.get(r.priorityId) ?? null) : null,
        );
        if (pts === null || pts === r.storyPoints) continue;
        changes.push({ ...r, pts });
      }
      if (changes.length > 0) {
        // Ưu tiên rỗng mã hoá '' (so với COALESCE(priorityId, '')).
        issues += await prisma.$executeRaw`
          UPDATE "Issue" AS i
          SET "storyPoints" = v.pts, "version" = i."version" + 1
          FROM unnest(
            ${changes.map((c) => c.id)}::text[],
            ${changes.map((c) => c.typeId)}::text[],
            ${changes.map((c) => c.difficulty)}::text[],
            ${changes.map((c) => c.priorityId ?? '')}::text[],
            ${changes.map((c) => c.pts)}::float8[]
          ) AS v(id, type_id, difficulty, priority_id, pts)
          WHERE i."id" = v.id
            AND NOT i."pointsManual"
            AND i."typeId" = v.type_id
            AND i."difficulty"::text = v.difficulty
            AND COALESCE(i."priorityId", '') = v.priority_id`;
      }
      if (rows.length < BATCH) break;
    }
  }

  // Epic sau cùng: tổng điểm việc con chưa xoá (kể cả sub-task). Khoá dòng Epic như luồng sửa việc.
  const epicRows = await prisma.issue.findMany({
    where: { deletedAt: null, type: { key: 'EPIC' } },
    select: { id: true },
    orderBy: { id: 'asc' },
  });
  let epics = 0;
  for (const { id } of epicRows) {
    const changed = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Issue" WHERE "id" = ${id} FOR UPDATE`;
      const epic = await tx.issue.findFirst({
        where: { id, deletedAt: null },
        select: { storyPoints: true },
      });
      if (!epic) return false;
      const sum = await tx.issue.aggregate({
        where: { epicId: id, deletedAt: null },
        _sum: { storyPoints: true },
      });
      const total = sum._sum.storyPoints ?? 0;
      if (epic.storyPoints === total) return false;
      // SQL thô: không đổi updatedAt của Epic.
      await tx.$executeRaw`UPDATE "Issue" SET "storyPoints" = ${total}::float8, "version" = "version" + 1 WHERE "id" = ${id} AND "deletedAt" IS NULL`;
      return true;
    });
    if (changed) epics++;
  }

  console.log(`recomputed ${issues} issues, ${epics} epics`);
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
