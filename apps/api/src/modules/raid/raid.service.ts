import { Injectable } from '@nestjs/common';
import type { Prisma, RaidKind, RaidStatus } from '@prisma/client';
import { PERMISSIONS } from '@tirapro/types';
import { assertCanManageInProject } from '../../common/project-manage';
import { requireProjectId } from '../../common/project-required';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { ForbiddenAppException, NotFoundAppException } from '../../common/exceptions/app.exception';
import { assertProjectWritable } from '../../common/project-writable';
import { RbacService } from '../rbac/rbac.service';
import { ProjectAccessService } from '../rbac/project-access.service';
import type { CreateRaidInput, UpdateRaidInput } from './raid.schemas';

const OWNER_SELECT = { id: true, displayName: true, email: true, avatarUrl: true } as const;

const RAID_SELECT = {
  id: true,
  organizationId: true,
  projectId: true,
  kind: true,
  title: true,
  description: true,
  probability: true,
  impact: true,
  status: true,
  ownerId: true,
  mitigation: true,
  dueDate: true,
  createdAt: true,
  updatedAt: true,
  owner: { select: OWNER_SELECT },
  owners: { select: { user: { select: OWNER_SELECT } }, orderBy: { createdAt: 'asc' } },
  project: { select: { id: true, key: true, name: true } },
} satisfies Prisma.RaidItemSelect;

type RaidRow = Prisma.RaidItemGetPayload<{ select: typeof RAID_SELECT }>;

/** Mức rủi ro theo điểm = xác suất × ảnh hưởng (1..25). */
export type RaidLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export function raidLevel(score: number): { level: RaidLevel; levelLabel: string } {
  if (score >= 20) return { level: 'CRITICAL', levelLabel: 'Nghiêm trọng' };
  if (score >= 13) return { level: 'HIGH', levelLabel: 'Cao' };
  if (score >= 7) return { level: 'MEDIUM', levelLabel: 'Trung bình' };
  return { level: 'LOW', levelLabel: 'Thấp' };
}

type RaidActor = { id: string; isSystemAdmin: boolean };

interface RaidListFilter {
  kind?: string;
  status?: string;
  projectId?: string;
  ownerId?: string;
}

/**
 * SỔ RỦI RO RAID — Risk / Assumption / Issue / Dependency.
 * Mỗi mục trả kèm `score` = probability × impact và mức tương ứng
 * (Thấp 1–6, Trung bình 7–12, Cao 13–19, Nghiêm trọng 20–25).
 */
@Injectable()
export class RaidService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rbac: RbacService,
    private readonly access: ProjectAccessService,
  ) {}

  /**
   * Điều kiện hiển thị mục RAID cho người xem: mục luôn thuộc một dự án nên chỉ hiện khi người xem thấy dự án đó
   * (dự án riêng tư → thành viên/admin). Admin → `{}` (không lọc).
   */
  private async scopeFor(
    organizationId: string,
    viewerId: string,
  ): Promise<Prisma.RaidItemWhereInput> {
    const visible = await this.access.visibleWhere(viewerId, organizationId);
    if (Object.keys(visible).length === 0) return {};
    return { project: visible };
  }

  async list(organizationId: string, filter: RaidListFilter, viewerId: string) {
    const where: Prisma.RaidItemWhereInput = {
      organizationId,
      ...(await this.scopeFor(organizationId, viewerId)),
    };
    if (filter.kind) where.kind = filter.kind as RaidKind;
    if (filter.status) where.status = filter.status as RaidStatus;
    if (filter.projectId) where.projectId = filter.projectId;
    // Người phụ trách nằm trong `owners` (nhiều người) hoặc là người chính cũ — `AND` để không đè `OR` của scope.
    if (filter.ownerId)
      where.AND = [
        { OR: [{ ownerId: filter.ownerId }, { owners: { some: { userId: filter.ownerId } } }] },
      ];

    const rows = await this.prisma.raidItem.findMany({
      where,
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      select: RAID_SELECT,
    });
    // Sắp theo điểm giảm dần: mục nguy hiểm nhất nằm trên cùng.
    return rows.map((r) => this.toDto(r)).sort((a, b) => b.score - a.score);
  }

  async get(organizationId: string, id: string, viewerId: string) {
    const row = await this.prisma.raidItem.findFirst({
      where: { id, organizationId, ...(await this.scopeFor(organizationId, viewerId)) },
      select: RAID_SELECT,
    });
    if (!row) throw new NotFoundAppException('Mục rủi ro');
    return this.toDto(row);
  }

  async create(organizationId: string, dto: CreateRaidInput, actingUserId: string) {
    const projectId = await this.resolveProject(
      organizationId,
      requireProjectId(dto.projectId, 'mục rủi ro'),
      actingUserId,
    );
    await assertProjectWritable(this.prisma, projectId);
    const ownerIds = await this.resolveOwners(organizationId, dto);

    const created = await this.prisma.raidItem.create({
      data: {
        organizationId,
        projectId,
        ownerId: ownerIds[0] ?? null,
        owners: { create: ownerIds.map((userId) => ({ userId })) },
        createdById: actingUserId,
        kind: dto.kind ?? 'RISK',
        title: dto.title.trim(),
        description: dto.description ?? null,
        probability: dto.probability ?? 3,
        impact: dto.impact ?? 3,
        status: dto.status ?? 'OPEN',
        mitigation: dto.mitigation ?? null,
        dueDate: this.parseDate(dto.dueDate ?? null),
      },
      select: { id: true },
    });
    return this.get(organizationId, created.id, actingUserId);
  }

  async update(organizationId: string, id: string, dto: UpdateRaidInput, actor: RaidActor) {
    const item = await this.requireItem(organizationId, id, actor.id);
    await assertProjectWritable(this.prisma, item.projectId);
    const data: Prisma.RaidItemUpdateInput = {};

    if (dto.title !== undefined && dto.title !== null) {
      const title = dto.title.trim();
      if (!title) throw new ForbiddenAppException('Tiêu đề bắt buộc');
      data.title = title;
    }
    if (dto.kind !== undefined && dto.kind !== null) data.kind = dto.kind;
    if (dto.status !== undefined && dto.status !== null) data.status = dto.status;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.mitigation !== undefined) data.mitigation = dto.mitigation;
    if (dto.probability !== undefined && dto.probability !== null)
      data.probability = dto.probability;
    if (dto.impact !== undefined && dto.impact !== null) data.impact = dto.impact;
    if (dto.dueDate !== undefined) data.dueDate = this.parseDate(dto.dueDate ?? null);
    if (dto.projectId !== undefined) {
      const projectId = await this.resolveProject(
        organizationId,
        requireProjectId(dto.projectId, 'mục rủi ro'),
        actor.id,
      );
      if (projectId !== item.projectId) {
        // Guard chỉ tính quyền ở dự án HIỆN TẠI của mục → phải kiểm thêm quyền Ở ĐÍCH.
        await this.assertCanManageRisk(organizationId, actor, projectId);
        await assertProjectWritable(this.prisma, projectId);
      }
      data.project = { connect: { id: projectId } };
    }
    if (dto.ownerIds !== undefined || dto.ownerId !== undefined) {
      const ownerIds = await this.resolveOwners(organizationId, dto);
      data.owner = ownerIds[0] ? { connect: { id: ownerIds[0] } } : { disconnect: true };
      data.owners = {
        deleteMany: {},
        create: ownerIds.map((userId) => ({ userId })),
      };
    }

    await this.prisma.raidItem.update({ where: { id }, data });
    return this.get(organizationId, id, actor.id);
  }

  async remove(organizationId: string, id: string, viewerId: string) {
    const item = await this.requireItem(organizationId, id, viewerId);
    await assertProjectWritable(this.prisma, item.projectId);
    await this.prisma.raidItem.delete({ where: { id } });
    return { success: true };
  }

  // ───────────────────────── helpers ─────────────────────────

  private async requireItem(organizationId: string, id: string, viewerId: string) {
    const row = await this.prisma.raidItem.findFirst({
      where: { id, organizationId, ...(await this.scopeFor(organizationId, viewerId)) },
      select: { id: true, projectId: true },
    });
    if (!row) throw new NotFoundAppException('Mục rủi ro');
    return row;
  }

  private async assertCanManageRisk(
    organizationId: string,
    actor: RaidActor,
    projectId: string,
  ): Promise<void> {
    if (actor.isSystemAdmin) return;
    // `risk:manage` ở dự án đích HOẶC quản trị chính dự án đó.
    await assertCanManageInProject(
      this.rbac,
      actor.id,
      organizationId,
      projectId,
      PERMISSIONS.RISK_MANAGE,
      'rủi ro',
    );
  }

  private parseDate(value: string | null): Date | null {
    if (!value) return null;
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) throw new ForbiddenAppException('Hạn xử lý không hợp lệ');
    return d;
  }

  private async resolveProject(
    organizationId: string,
    projectId: string,
    viewerId: string,
  ): Promise<string> {
    const visible = await this.access.visibleWhere(viewerId, organizationId);
    const p = await this.prisma.project.findFirst({
      where: { id: projectId, organizationId, deletedAt: null, ...visible },
      select: { id: true },
    });
    if (!p) throw new NotFoundAppException('Dự án');
    return p.id;
  }

  /**
   * Danh sách người phụ trách (người đầu = chính): `ownerIds` nếu có, không thì `ownerId` cũ. Khử trùng lặp, giữ thứ tự;
   * mọi người phải là thành viên tổ chức.
   */
  private async resolveOwners(
    organizationId: string,
    dto: { ownerIds?: string[]; ownerId?: string | null },
  ): Promise<string[]> {
    const wanted = dto.ownerIds ?? (dto.ownerId ? [dto.ownerId] : []);
    const ids = [...new Set(wanted)];
    if (ids.length === 0) return [];
    const members = await this.prisma.organizationMembership.findMany({
      where: { organizationId, userId: { in: ids } },
      select: { userId: true },
    });
    const ok = new Set(members.map((m) => m.userId));
    if (ids.some((id) => !ok.has(id)))
      throw new ForbiddenAppException(
        'Có người phụ trách không thuộc tổ chức này — hãy chọn lại từ danh sách thành viên',
      );
    return ids;
  }

  /** Mọi người phụ trách, người CHÍNH (`ownerId`) đứng đầu; dữ liệu cũ chưa có bảng nối thì rơi về `owner`. */
  private ownersOf(r: RaidRow) {
    const list = r.owners.map((o) => o.user);
    if (list.length === 0) return r.owner ? [r.owner] : [];
    return [...list].sort((a, b) => Number(b.id === r.ownerId) - Number(a.id === r.ownerId));
  }

  private toDto(r: RaidRow) {
    const score = r.probability * r.impact;
    const { level, levelLabel } = raidLevel(score);
    return {
      id: r.id,
      organizationId: r.organizationId,
      projectId: r.projectId,
      project: r.project,
      kind: r.kind,
      title: r.title,
      description: r.description,
      probability: r.probability,
      impact: r.impact,
      status: r.status,
      // `owner` = người phụ trách chính (tương thích ngược); `owners` = toàn bộ (kể cả người chính).
      owner: r.owner,
      owners: this.ownersOf(r),
      mitigation: r.mitigation,
      dueDate: r.dueDate ? r.dueDate.toISOString() : null,
      score,
      level,
      levelLabel,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  }
}
