import { Injectable } from '@nestjs/common';
import type { Prisma, RaidKind, RaidStatus } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { ForbiddenAppException, NotFoundAppException } from '../../common/exceptions/app.exception';
import type { CreateRaidInput, UpdateRaidInput } from './raid.schemas';

const OWNER_SELECT = { id: true, displayName: true, email: true, avatarUrl: true } as const;

const RAID_SELECT = {
  id: true,
  workspaceId: true,
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
  constructor(private readonly prisma: PrismaService) {}

  async list(workspaceId: string, filter: RaidListFilter) {
    const where: Prisma.RaidItemWhereInput = { workspaceId };
    if (filter.kind) where.kind = filter.kind as RaidKind;
    if (filter.status) where.status = filter.status as RaidStatus;
    if (filter.projectId) where.projectId = filter.projectId;
    if (filter.ownerId) where.ownerId = filter.ownerId;

    const rows = await this.prisma.raidItem.findMany({
      where,
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      select: RAID_SELECT,
    });
    // Sắp theo điểm giảm dần: mục nguy hiểm nhất nằm trên cùng.
    return rows.map((r) => this.toDto(r)).sort((a, b) => b.score - a.score);
  }

  async get(workspaceId: string, id: string) {
    const row = await this.prisma.raidItem.findFirst({ where: { id, workspaceId }, select: RAID_SELECT });
    if (!row) throw new NotFoundAppException('Mục rủi ro');
    return this.toDto(row);
  }

  async create(workspaceId: string, dto: CreateRaidInput, actingUserId: string) {
    const projectId = await this.resolveProject(workspaceId, dto.projectId ?? null);
    const ownerId = await this.resolveOwner(workspaceId, dto.ownerId ?? null);

    const created = await this.prisma.raidItem.create({
      data: {
        workspaceId,
        projectId,
        ownerId,
        createdById: actingUserId,
        kind: (dto.kind ?? 'RISK') as RaidKind,
        title: dto.title.trim(),
        description: dto.description ?? null,
        probability: dto.probability ?? 3,
        impact: dto.impact ?? 3,
        status: (dto.status ?? 'OPEN') as RaidStatus,
        mitigation: dto.mitigation ?? null,
        dueDate: this.parseDate(dto.dueDate ?? null),
      },
      select: { id: true },
    });
    return this.get(workspaceId, created.id);
  }

  async update(workspaceId: string, id: string, dto: UpdateRaidInput) {
    await this.requireItem(workspaceId, id);
    const data: Prisma.RaidItemUpdateInput = {};

    if (dto.title !== undefined && dto.title !== null) {
      const title = dto.title.trim();
      if (!title) throw new ForbiddenAppException('Tiêu đề bắt buộc');
      data.title = title;
    }
    if (dto.kind !== undefined && dto.kind !== null) data.kind = dto.kind as RaidKind;
    if (dto.status !== undefined && dto.status !== null) data.status = dto.status as RaidStatus;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.mitigation !== undefined) data.mitigation = dto.mitigation;
    if (dto.probability !== undefined && dto.probability !== null) data.probability = dto.probability;
    if (dto.impact !== undefined && dto.impact !== null) data.impact = dto.impact;
    if (dto.dueDate !== undefined) data.dueDate = this.parseDate(dto.dueDate ?? null);
    if (dto.projectId !== undefined) {
      const projectId = await this.resolveProject(workspaceId, dto.projectId ?? null);
      data.project = projectId ? { connect: { id: projectId } } : { disconnect: true };
    }
    if (dto.ownerId !== undefined) {
      const ownerId = await this.resolveOwner(workspaceId, dto.ownerId ?? null);
      data.owner = ownerId ? { connect: { id: ownerId } } : { disconnect: true };
    }

    await this.prisma.raidItem.update({ where: { id }, data });
    return this.get(workspaceId, id);
  }

  async remove(workspaceId: string, id: string) {
    await this.requireItem(workspaceId, id);
    await this.prisma.raidItem.delete({ where: { id } });
    return { success: true };
  }

  // ───────────────────────── helpers ─────────────────────────

  private async requireItem(workspaceId: string, id: string) {
    const row = await this.prisma.raidItem.findFirst({ where: { id, workspaceId }, select: { id: true } });
    if (!row) throw new NotFoundAppException('Mục rủi ro');
    return row;
  }

  private parseDate(value: string | null): Date | null {
    if (!value) return null;
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) throw new ForbiddenAppException('Hạn xử lý không hợp lệ');
    return d;
  }

  private async resolveProject(workspaceId: string, projectId: string | null): Promise<string | null> {
    if (!projectId) return null;
    const p = await this.prisma.project.findFirst({
      where: { id: projectId, workspaceId, deletedAt: null },
      select: { id: true },
    });
    if (!p) throw new NotFoundAppException('Dự án');
    return p.id;
  }

  private async resolveOwner(workspaceId: string, ownerId: string | null): Promise<string | null> {
    if (!ownerId) return null;
    const m = await this.prisma.workspaceMembership.findFirst({
      where: { workspaceId, userId: ownerId },
      select: { userId: true },
    });
    if (!m) throw new ForbiddenAppException('Chủ sở hữu không thuộc không gian làm việc này — hãy chọn một thành viên khác');
    return m.userId;
  }

  private toDto(r: RaidRow) {
    const score = r.probability * r.impact;
    const { level, levelLabel } = raidLevel(score);
    return {
      id: r.id,
      workspaceId: r.workspaceId,
      projectId: r.projectId,
      project: r.project,
      kind: r.kind,
      title: r.title,
      description: r.description,
      probability: r.probability,
      impact: r.impact,
      status: r.status,
      owner: r.owner,
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
