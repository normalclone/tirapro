import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { assertParityDatabase } from '../../common/testing/parity-db-guard';
import type { PrismaService } from '../../infra/prisma/prisma.service';
import { WorkflowAdminService } from './workflow-admin.service';

/**
 * Danh sách quy trình ẩn quy trình của dự án đã xoá mềm — TRÊN POSTGRES THẬT, OPT-IN (không chạy trong `pnpm test`).
 * Spec thường mock Prisma nên không chứng minh được điều kiện quan hệ `project.deletedAt` lọc đúng.
 *
 * Chạy: `PARITY_DATABASE_URL=postgresql://…/xxx_scratch?schema=public pnpm --filter @tirapro/api test:parity`.
 * Mọi hàng mang TAG và được dọn ở `afterAll`.
 */
const DB_URL = process.env.PARITY_DATABASE_URL;
if (DB_URL) assertParityDatabase(DB_URL);

describe.skipIf(!DB_URL)(
  'danh sách quy trình ẩn quy trình của dự án trong thùng rác ↔ Postgres thật',
  () => {
    const TAG = `wft${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const id = (n: string) => `${TAG}-${n}`;
    const WS = id('ws');
    const USER = id('u');
    let prisma: PrismaClient;
    let svc: WorkflowAdminService;

    const names = async (filter: Parameters<WorkflowAdminService['listWorkflows']>[1] = {}) =>
      (await svc.listWorkflows(WS, filter, USER)).map((w) => w.name).sort();

    beforeAll(async () => {
      prisma = new PrismaClient({ datasources: { db: { url: DB_URL! } } });
      await prisma.user.create({
        data: { id: USER, email: `${USER}@wf.test`, displayName: USER, isSystemAdmin: true },
      });
      await prisma.workspace.create({ data: { id: WS, name: TAG, slug: TAG, ownerId: USER } });
      for (const [pid, deleted] of [
        ['live', false],
        ['trashed', true],
      ] as const) {
        await prisma.project.create({
          data: {
            id: id(pid),
            workspaceId: WS,
            key: pid === 'live' ? 'LV' : 'TR',
            name: pid,
            deletedAt: deleted ? new Date() : null,
          },
        });
        await prisma.workflow.create({
          data: { id: id(`wf-${pid}`), workspaceId: WS, projectId: id(pid), name: `wf-${pid}` },
        });
      }
      await prisma.workflow.create({
        data: { id: id('wf-tpl'), workspaceId: WS, name: 'wf-tpl', isTemplate: true },
      });
      svc = new WorkflowAdminService(
        prisma as unknown as PrismaService,
        { visibleWhere: () => Promise.resolve({}) } as never,
      );
    }, 60_000);

    afterAll(async () => {
      if (!prisma) return;
      await prisma.workflow.deleteMany({ where: { workspaceId: WS } });
      await prisma.project.deleteMany({ where: { workspaceId: WS } });
      await prisma.workspace.deleteMany({ where: { id: WS } });
      await prisma.user.deleteMany({ where: { id: USER } });
      await prisma.$disconnect();
    }, 60_000);

    it('mặc định: không có quy trình của dự án trong thùng rác; mẫu và dự án sống vẫn có', async () => {
      expect(await names()).toEqual(['wf-live', 'wf-tpl']);
    });

    it('?includeTrashed=1: liệt kê cả quy trình của dự án trong thùng rác', async () => {
      expect(await names({ includeTrashed: true })).toEqual(['wf-live', 'wf-tpl', 'wf-trashed']);
    });

    it('khôi phục dự án (deletedAt = null) thì quy trình hiện lại', async () => {
      await prisma.project.update({ where: { id: id('trashed') }, data: { deletedAt: null } });
      expect(await names()).toEqual(['wf-live', 'wf-tpl', 'wf-trashed']);
      await prisma.project.update({
        where: { id: id('trashed') },
        data: { deletedAt: new Date() },
      });
      expect(await names()).toEqual(['wf-live', 'wf-tpl']);
    });

    it('lọc theo mẫu (isTemplate) không bị ảnh hưởng', async () => {
      expect(await names({ isTemplate: true })).toEqual(['wf-tpl']);
    });
  },
);
