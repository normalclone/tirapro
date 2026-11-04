import { Injectable } from '@nestjs/common';
import {
  DEFAULT_ISSUE_TYPES,
  DEFAULT_LINK_TYPES,
  DEFAULT_PRIORITIES,
  DEFAULT_RESOLUTIONS,
  DEFAULT_SEVERITIES,
  DEFAULT_WORKFLOW_TEMPLATES,
} from '@tirapro/types';
import type { Prisma, PrismaClient } from '@prisma/client';
import { ensureDefaultScheme } from '../workflow-admin/default-scheme';

type Tx = Prisma.TransactionClient | PrismaClient;

/**
 * Bootstrap config cho tổ chức mới: clone DEFAULT_* (issue types, priorities, severities,
 * resolutions, link types) + tạo workflow templates. Dùng khi register / tạo organization.
 * (Cùng nguồn catalog với prisma/seed.ts.)
 */
@Injectable()
export class OrganizationBootstrapService {
  async bootstrap(tx: Tx, organizationId: string): Promise<void> {
    for (const t of DEFAULT_ISSUE_TYPES) {
      await tx.issueType.create({
        data: {
          organizationId,
          name: t.name,
          key: t.key,
          color: t.color,
          hierarchyLevel: t.hierarchyLevel,
          isSubtask: !!t.isSubtask,
          isSystem: true,
        },
      });
    }
    // Quy trình theo loại việc: tổ chức mới có sẵn 3 quy trình mặc định + dòng cấu hình cho từng loại việc vừa tạo,
    // để dự án đầu tiên tạo việc ngay được (không thì loại việc nào cũng "không có quy trình").
    await ensureDefaultScheme(tx, organizationId);
    for (const p of DEFAULT_PRIORITIES) {
      await tx.priority.create({
        data: {
          organizationId,
          name: p.name,
          iconKey: p.iconKey,
          color: p.color,
          rank: p.rank,
          isDefault: !!p.isDefault,
          isSystem: true,
        },
      });
    }
    for (const s of DEFAULT_SEVERITIES) {
      await tx.severity.create({
        data: {
          organizationId,
          name: s.name,
          description: s.description,
          color: s.color,
          rank: s.rank,
          isDefault: !!s.isDefault,
          isSystem: true,
        },
      });
    }
    for (const r of DEFAULT_RESOLUTIONS) {
      await tx.resolution.create({
        data: {
          organizationId,
          name: r.name,
          description: r.description,
          rank: r.rank,
          isDefault: !!r.isDefault,
          isSystem: true,
        },
      });
    }
    for (const l of DEFAULT_LINK_TYPES) {
      await tx.linkType.create({
        data: {
          organizationId,
          name: l.name,
          outwardName: l.outwardName,
          inwardName: l.inwardName,
          isSystem: true,
        },
      });
    }
    for (const tpl of DEFAULT_WORKFLOW_TEMPLATES) {
      const wf = await tx.workflow.create({
        data: {
          organizationId,
          projectId: null,
          isTemplate: true,
          isDefault: !!tpl.isDefault,
          name: tpl.name,
          description: tpl.description,
        },
      });
      const statusByName = new Map<string, string>();
      for (const st of tpl.statuses) {
        const row = await tx.status.create({
          data: {
            workflowId: wf.id,
            name: st.name,
            category: st.category,
            color: st.color,
            order: st.order,
            isInitial: !!st.isInitial,
          },
        });
        statusByName.set(st.name, row.id);
      }
      let order = 0;
      for (const tr of tpl.transitions) {
        await tx.workflowTransition.create({
          data: {
            workflowId: wf.id,
            name: tr.name,
            fromStatusId: tr.from ? (statusByName.get(tr.from) ?? null) : null,
            toStatusId: statusByName.get(tr.to)!,
            order: order++,
          },
        });
      }
    }
  }
}
