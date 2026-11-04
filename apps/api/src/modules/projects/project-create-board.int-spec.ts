import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { assertParityDatabase } from '../../common/testing/parity-db-guard';
import type { PrismaService } from '../../infra/prisma/prisma.service';
import { OrganizationBootstrapService } from '../organizations/organization-bootstrap.service';
import { WorkflowResolver } from '../workflow-admin/workflow-resolver.service';
import { ProjectsService } from './projects.service';

/**
 * TẠO TỔ CHỨC + DỰ ÁN TRÊN POSTGRES THẬT — OPT-IN (`PARITY_DATABASE_URL=…_scratch pnpm --filter @tirapro/api test:parity`).
 * Chứng minh: tổ chức mới có sẵn quy trình mặc định + cấu hình theo loại việc, và bảng của dự án mới có cột cho MỌI
 * trạng thái của quy trình theo loại việc (không thì việc Bug/Epic mới tạo không hiện trên bảng).
 */
const DB_URL = process.env.PARITY_DATABASE_URL;
if (DB_URL) assertParityDatabase(DB_URL);

const TAG = `pc${Date.now().toString(36)}`;
const WS = `${TAG}-ws`;
const USER = `${TAG}-u`;

describe.skipIf(!DB_URL)('Tổ chức/dự án mới ↔ Postgres thật', () => {
  let prisma: PrismaClient;
  let projects: ProjectsService;

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: DB_URL! } } });
    projects = new ProjectsService(
      prisma as unknown as PrismaService,
      {} as never,
      {} as never,
      {
        visibleWhere: () => Promise.resolve({}),
        onVisibilityChanged: () => Promise.resolve(),
        onMembersChanged: () => Promise.resolve(),
      } as never,
      { record: () => Promise.resolve() } as never,
      undefined,
      new WorkflowResolver(),
    );
    await prisma.user.create({
      data: { id: USER, email: `${USER}@pc.test`, displayName: 'PC' },
    });
    await prisma.organization.create({ data: { id: WS, name: WS, slug: WS, ownerId: USER } });
    await prisma.$transaction((tx) => new OrganizationBootstrapService().bootstrap(tx, WS));
  });

  afterAll(async () => {
    if (!prisma) return;
    // Dọn sạch để spec khác (đếm mọi tổ chức trong DB) không thấy dấu vết: dự án → cấu hình → quy trình → tổ chức.
    await prisma.project.deleteMany({ where: { organizationId: WS } });
    await prisma.organizationWorkflowScheme.deleteMany({ where: { organizationId: WS } });
    await prisma.workflow.deleteMany({ where: { organizationId: WS } });
    await prisma.organization.deleteMany({ where: { id: WS } });
    await prisma.user.deleteMany({ where: { id: USER } });
    await prisma.$disconnect();
  });

  it('tổ chức mới: có 3 quy trình mặc định và dòng cấu hình cho MỌI loại việc', async () => {
    const [types, scheme, defaults] = await Promise.all([
      prisma.issueType.findMany({ where: { organizationId: WS }, select: { id: true } }),
      prisma.organizationWorkflowScheme.findMany({
        where: { organizationId: WS },
        select: { issueTypeId: true, workflowId: true },
      }),
      prisma.workflow.findMany({
        where: { organizationId: WS, sourceTemplateId: { startsWith: 'tirapro-default:' } },
        select: { name: true },
      }),
    ]);
    expect(types.length).toBeGreaterThan(0);
    expect(new Set(scheme.map((s) => s.issueTypeId))).toEqual(new Set(types.map((t) => t.id)));
    expect(defaults.map((d) => d.name).sort()).toEqual([
      'Bug Workflow',
      'Epic Workflow',
      'Standard Workflow',
    ]);
  });

  it('dự án mới: mọi trạng thái của quy trình từng loại việc (Task/Bug/Epic) đều nằm trên một cột của bảng', async () => {
    const created = await projects.create(WS, USER, {
      key: 'PCA',
      name: 'PCA',
      type: 'SCRUM',
    } as never);
    const scheme = await prisma.organizationWorkflowScheme.findMany({
      where: { organizationId: WS, issueType: { key: { in: ['TASK', 'BUG', 'EPIC'] } } },
      select: { workflowId: true },
    });
    const flowIds = [...new Set(scheme.map((s) => s.workflowId))];
    expect(flowIds.length).toBe(3);
    const required = await prisma.status.findMany({
      where: { workflowId: { in: flowIds } },
      select: { id: true, name: true },
    });
    const board = await prisma.board.findFirstOrThrow({
      where: { projectId: created.id },
      select: { columns: { select: { name: true, statuses: { select: { statusId: true } } } } },
    });
    const onBoard = new Set(board.columns.flatMap((c) => c.statuses.map((s) => s.statusId)));
    expect(required.filter((s) => !onBoard.has(s.id)).map((s) => s.name)).toEqual([]);
    // Không còn cột "ma" chỉ chứa trạng thái của bản chép mẫu cũ.
    const legacy = await prisma.status.findMany({
      where: { workflow: { projectId: created.id } },
      select: { id: true },
    });
    const legacyIds = new Set(legacy.map((s) => s.id));
    for (const c of board.columns)
      expect(c.statuses.some((s) => !legacyIds.has(s.statusId))).toBe(true);
  });
});
