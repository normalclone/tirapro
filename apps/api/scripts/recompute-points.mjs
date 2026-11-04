/**
 * Tirapro — tính lại điểm MỌI việc theo bảng hệ số (Loại × Độ khó × Ưu tiên) rồi cộng lại điểm mọi Epic.
 * Chạy MỘT lần sau `prisma migrate deploy` (deploy.sh) để việc cũ nhận điểm theo công thức — kể cả điểm nhập tay cũ
 * như 80 (việc cũ đều `pointsManual = false`). Idempotent: chỉ ghi việc có điểm KHÁC công thức, chạy lại cập nhật 0 việc.
 *
 * Cùng thuật toán với `PointsService.recomputeAll` (API chạy nền khi SA lưu bảng hệ số):
 *  - theo từng dự án, lô 500 việc; bỏ việc chỉnh tay (`pointsManual`), Epic và việc CHA (có việc con chưa xoá); việc đổi
 *    được tăng `version`;
 *  - không ghi lịch sử hoạt động từng việc;
 *  - việc cha = tổng điểm việc con chưa xoá (tầng thấp trước, cộng ngược lên chuỗi cha → ông); hết việc con thì theo công
 *    thức trừ khi chỉnh tay; ghi khi khác và tăng `version`;
 *  - việc cha có việc con: bỏ cờ `pointsManual` (cha thuần);
 *  - Epic = tổng điểm việc CẤP TRÊN (không cha, hoặc cha đã xoá mềm) thuộc Epic, chưa xoá; ghi khi khác và tăng `version`;
 *  - sửa dữ liệu cũ: sprint của việc con = sprint của việc cha còn sống (tăng `version`, không đổi `updatedAt`).
 * Không phát sự kiện realtime (script chạy lúc triển khai, chưa có ai mở trang).
 * Ghi bằng SQL thô và KHÔNG đổi `updatedAt` (SLA / "cập nhật gần đây" dựa vào nó; đây là tính lại của hệ thống, không phải
 * người dùng sửa). WHERE lặp lại đầu vào đã tính (loại, độ khó, ưu tiên) + `pointsManual = false` nên việc vừa bị người dùng
 * sửa giữa lúc đọc và ghi bị bỏ qua thay vì bị ghi đè.
 *
 *   pnpm --filter @tirapro/api run points:recompute
 *
 * Cần DATABASE_URL và đã build @tirapro/types + @tirapro/shared. In đúng MỘT dòng kết quả:
 *   recomputed N issues, M epics, S child sprints synced
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

  // Việc con theo sprint của việc cha (sửa dữ liệu cũ, idempotent): đặt sprint của việc con = sprint của cha còn sống khi khác;
  // lặp theo tầng (cha → con → cháu). Tăng `version` (OCC) nhưng KHÔNG đổi `updatedAt`.
  let sprintSynced = 0;
  for (let round = 0; round < 20; round++) {
    const n = await prisma.$executeRaw`
      UPDATE "Issue" AS c
      SET "sprintId" = p."sprintId", "version" = c."version" + 1
      FROM "Issue" AS p
      WHERE c."parentId" = p."id"
        AND c."deletedAt" IS NULL
        AND p."deletedAt" IS NULL
        AND c."sprintId" IS DISTINCT FROM p."sprintId"`;
    if (n === 0) break;
    sprintSynced += n;
  }

  let issues = 0;
  for (const { id: projectId } of projects) {
    let cursor;
    for (;;) {
      // Cả việc đã xoá mềm: khôi phục về không bị lệch điểm (tổng Epic vẫn loại việc đã xoá).
      const rows = await prisma.issue.findMany({
        where: {
          projectId,
          pointsManual: false,
          NOT: { type: { key: 'EPIC' } },
          children: { none: { deletedAt: null } }, // việc cha lấy tổng việc con ở bước sau
        },
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

  // Việc cha (có việc con chưa xoá): tổng điểm việc con, tầng thấp trước; khoá dòng như luồng sửa việc.
  const parentRows = await prisma.issue.findMany({
    where: {
      deletedAt: null,
      children: { some: { deletedAt: null } },
      NOT: { type: { key: 'EPIC' } },
    },
    select: { id: true, parentId: true },
    orderBy: { id: 'asc' },
  });
  const parentOf = new Map(parentRows.map((r) => [r.id, r.parentId]));
  const depthOf = (id) => {
    let d = 0;
    for (let cur = parentOf.get(id); cur && parentOf.has(cur) && d < 20; cur = parentOf.get(cur))
      d++;
    return d;
  };
  // Mỗi lô chỉ chứa việc CÙNG độ sâu, sâu nhất trước (con → cha → ông) để thứ tự khoá không đảo.
  const byDepth = new Map();
  for (const r of parentRows) {
    const d = depthOf(r.id);
    byDepth.set(d, [...(byDepth.get(d) ?? []), r.id]);
  }
  const parentBatches = [];
  for (const d of [...byDepth.keys()].sort((a, b) => b - a))
    for (let i = 0; i < byDepth.get(d).length; i += 100)
      parentBatches.push(byDepth.get(d).slice(i, i + 100));
  const changedParents = new Set();
  const touchParent = async (tx, startIds) => {
    // Cộng ngược lên chuỗi: cha đổi thì cha của nó ở vòng kế (cùng thuật toán PointsService.rollupParents).
    let level = [...new Set(startIds)].sort();
    for (let depth = 0; level.length > 0 && depth < 20; depth++) {
      const next = new Set();
      for (const id of level) {
        await tx.$queryRaw`SELECT "id" FROM "Issue" WHERE "id" = ${id} FOR UPDATE`;
        const p = await tx.issue.findFirst({
          where: { id, deletedAt: null },
          select: {
            storyPoints: true,
            pointsManual: true,
            typeId: true,
            difficulty: true,
            priorityId: true,
            parentId: true,
          },
        });
        if (!p || typeKey.get(p.typeId) === 'EPIC') continue;
        const kids = await tx.issue.aggregate({
          where: { parentId: id, deletedAt: null },
          _sum: { storyPoints: true },
          _count: { _all: true },
        });
        let target;
        const hasKids = kids._count._all > 0;
        if (hasKids) target = kids._sum.storyPoints ?? 0;
        else if (p.pointsManual) continue;
        else
          target = computePoints(
            formula,
            typeKey.get(p.typeId) ?? null,
            p.difficulty,
            p.priorityId ? (priorityName.get(p.priorityId) ?? null) : null,
          );
        // Có việc con => cha thuần: bỏ cờ chỉnh tay (kể cả khi tổng khớp sẵn).
        const clearManual = hasKids && p.pointsManual;
        if (target === null || (p.storyPoints === target && !clearManual)) continue;
        // SQL thô: không đổi updatedAt.
        await tx.$executeRaw`UPDATE "Issue" SET "storyPoints" = ${target}::float8, "pointsManual" = false, "version" = "version" + 1 WHERE "id" = ${id} AND "deletedAt" IS NULL`;
        changedParents.add(id);
        if (p.parentId) next.add(p.parentId);
      }
      level = [...next].sort();
    }
  };
  for (const ids of parentBatches) await prisma.$transaction((tx) => touchParent(tx, ids));
  issues += changedParents.size;

  // Epic sau cùng: tổng điểm việc cấp trên (không cha, hoặc cha đã xoá mềm) chưa xoá. Khoá dòng Epic như luồng sửa việc.
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
        where: {
          epicId: id,
          deletedAt: null,
          OR: [{ parentId: null }, { parent: { deletedAt: { not: null } } }],
        },
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

  console.log(`recomputed ${issues} issues, ${epics} epics, ${sprintSynced} child sprints synced`);
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
