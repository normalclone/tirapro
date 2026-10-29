import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../../../infra/prisma/prisma.service';

/** Nguồn của ImportJob tạo bởi import Jira (khớp `source` khi tạo job). */
const JIRA_SOURCE = 'JIRA_CLOUD' as const;

/** Job import Jira đã tạo cho `analyzeId` trong workspace (nếu có). Dùng được cả trong transaction. */
export async function findImportJobByAnalyzeId(
  db: Pick<Prisma.TransactionClient, 'importJob'>,
  workspaceId: string,
  analyzeId: string,
): Promise<{ id: string } | null> {
  return db.importJob.findFirst({
    where: {
      workspaceId,
      source: JIRA_SOURCE,
      config: { path: ['analyzeId'], equals: analyzeId },
    },
    select: { id: true },
  });
}

/**
 * CLAIM Ở DB (cơ chế chính chống chạy trùng): trong MỘT transaction, lấy `pg_advisory_xact_lock` theo analyzeId rồi
 * "đã có job cho analyzeId này chưa?" → trả job đó (`created:false`), chưa có → tạo luôn (`created:true`).
 * Khoá advisory tuần tự hoá mọi request cùng analyzeId (kể cả nhiều node) nên đúng MỘT ImportJob được tạo, và request
 * thử lại (phản hồi đầu bị mất) nhận lại đúng job cũ. Không cần migration/unique index.
 */
export async function claimImportJob(
  prisma: Pick<PrismaService, '$transaction'>,
  workspaceId: string,
  analyzeId: string,
  data: Prisma.ImportJobUncheckedCreateInput,
): Promise<{ id: string; created: boolean }> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`tirapro:jira-import:${analyzeId}`}, 0))`;
    const existing = await findImportJobByAnalyzeId(tx, workspaceId, analyzeId);
    if (existing) return { id: existing.id, created: false };
    const job = await tx.importJob.create({ data, select: { id: true } });
    return { id: job.id, created: true };
  });
}
