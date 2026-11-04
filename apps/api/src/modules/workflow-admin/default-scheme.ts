import type { Prisma } from '@prisma/client';
import type { WorkflowDefaultKey } from '@tirapro/types';
import { DEFAULT_SCHEME, DEFAULT_WORKFLOWS, expandWorkflowTransitions } from '@tirapro/shared';

/**
 * Ba quy trình mặc định của từng tổ chức. Nhận diện bằng dấu ổn định `sourceTemplateId = tirapro-default:<KEY>` (đổi tên
 * không sinh bản trùng); quy trình chung chưa có dấu mà trùng tên chính xác được nhận và đóng dấu. Quy trình khác không bị đụng.
 */
const DEFAULT_MARKER_PREFIX = 'tirapro-default:';
const DEFAULT_KEYS = Object.keys(DEFAULT_WORKFLOWS) as WorkflowDefaultKey[];

export interface EnsureDefaultSchemeResult {
  createdWorkflows: string[];
  defaultIdByKey: Map<WorkflowDefaultKey, string>;
  createdSchemeRows: number;
}

/**
 * Bảo đảm tổ chức có ba quy trình mặc định + một dòng cấu hình cho MỌI loại việc (dòng đã có luôn thắng).
 * Idempotent; dùng cho script chuyển đổi và khi tạo tổ chức mới.
 */
export async function ensureDefaultScheme(
  tx: Prisma.TransactionClient,
  organizationId: string,
): Promise<EnsureDefaultSchemeResult> {
  // 1. Ba quy trình mặc định (theo tên chính xác, chung của tổ chức).
  const createdWorkflows: string[] = [];
  const defaultIdByKey = new Map<WorkflowDefaultKey, string>();
  for (const key of DEFAULT_KEYS) {
    const def = DEFAULT_WORKFLOWS[key];
    const marker = `${DEFAULT_MARKER_PREFIX}${key}`;
    const shared = { organizationId, projectId: null, isTemplate: false } as const;
    const found =
      (await tx.workflow.findFirst({
        where: { ...shared, sourceTemplateId: marker },
        select: { id: true },
      })) ??
      (await tx.workflow.findFirst({
        where: { ...shared, name: def.name, sourceTemplateId: null },
        select: { id: true },
      }));
    if (found) {
      await tx.workflow.updateMany({
        where: { id: found.id, sourceTemplateId: null },
        data: { sourceTemplateId: marker },
      });
      defaultIdByKey.set(key, found.id);
      continue;
    }
    const wf = await tx.workflow.create({
      data: {
        organizationId,
        name: def.name,
        isTemplate: false,
        sourceTemplateId: marker,
        statuses: {
          create: def.statuses.map((s, i) => ({
            name: s.name,
            category: s.category,
            order: i,
            isInitial: s.isInitial,
          })),
        },
      },
      select: { id: true, statuses: { select: { id: true, name: true } } },
    });
    const idByName = new Map(wf.statuses.map((s) => [s.name, s.id]));
    // Chỉ qua expandWorkflowTransitions: không bao giờ ghi '*OPEN' thô.
    const transitions = expandWorkflowTransitions(def).map((t, i) => ({
      workflowId: wf.id,
      name: t.name,
      fromStatusId: t.from === null ? null : (idByName.get(t.from) ?? null),
      toStatusId: idByName.get(t.to)!,
      order: i,
    }));
    await tx.workflowTransition.createMany({ data: transitions });
    defaultIdByKey.set(key, wf.id);
    createdWorkflows.push(def.name);
  }

  // 2. Dòng cấu hình cho mọi loại việc — dòng đã có luôn thắng.
  const types = await tx.issueType.findMany({
    where: { organizationId },
    select: { id: true, key: true, name: true },
  });
  const existingScheme = await tx.organizationWorkflowScheme.findMany({
    where: { organizationId },
    select: { issueTypeId: true },
  });
  const have = new Set(existingScheme.map((r) => r.issueTypeId));
  const missing = types.filter((t) => !have.has(t.id));
  if (missing.length > 0)
    await tx.organizationWorkflowScheme.createMany({
      data: missing.map((t) => ({
        organizationId,
        issueTypeId: t.id,
        workflowId: defaultIdByKey.get(DEFAULT_SCHEME[t.key ?? 'CUSTOM'])!,
      })),
      skipDuplicates: true,
    });
  return { createdWorkflows, defaultIdByKey, createdSchemeRows: missing.length };
}
