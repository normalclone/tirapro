import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { BusinessRuleException, NotFoundAppException } from '../../common/exceptions/app.exception';
import { ProjectAccessService } from '../rbac/project-access.service';
import type { CreateProgramInput, UpdateProgramInput } from './programs.schemas';

/** `visible` = điều kiện hiển thị dự án của người xem (`{}` = thấy hết): dự án riêng tư không thấy không hiện trong nhóm. */
const programSelect = (visible: Prisma.ProjectWhereInput) =>
  ({
    id: true,
    workspaceId: true,
    name: true,
    description: true,
    color: true,
    startDate: true,
    targetDate: true,
    createdAt: true,
    projects: {
      where: { project: { deletedAt: null, ...visible } },
      orderBy: { project: { name: 'asc' as const } },
      select: { project: { select: { id: true, key: true, name: true, isArchived: true } } },
    },
  }) satisfies Prisma.ProgramSelect;

/**
 * Nhóm dự án — của RIÊNG từng người (`Program.ownerId` = người tạo). Mỗi người tự xếp dự án vào nhóm của mình; không ai
 * thấy hay sửa nhóm của người khác: mọi đường đọc/ghi đều lọc theo `ownerId = người gọi`, nhóm của người khác trả 404
 * (như không tồn tại). Quan hệ nhiều–nhiều với dự án (`ProjectProgram`): một dự án thuộc được nhiều nhóm — của nhiều người
 * khác nhau, mỗi liên kết thuộc về nhóm của chủ nhóm. Xoá nhóm = hard delete; liên kết của nó biến theo (cascade).
 */
@Injectable()
export class ProgramsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProjectAccessService,
  ) {}

  /** Điều kiện hiển thị dự án của người xem (`{}` = thấy hết). */
  private visibleFor(workspaceId: string, viewerId: string): Promise<Prisma.ProjectWhereInput> {
    return this.access.visibleWhere(viewerId, workspaceId);
  }

  /** Nhóm của `ownerId` (không ai khác). */
  async list(workspaceId: string, ownerId: string) {
    const rows = await this.prisma.program.findMany({
      where: { workspaceId, ownerId },
      orderBy: [{ name: 'asc' }],
      select: programSelect(await this.visibleFor(workspaceId, ownerId)),
    });
    return rows.map((p) => this.toDto(p));
  }

  async get(workspaceId: string, id: string, ownerId: string) {
    const p = await this.prisma.program.findFirst({
      where: { id, workspaceId, ownerId },
      select: programSelect(await this.visibleFor(workspaceId, ownerId)),
    });
    if (!p) throw new NotFoundAppException('Nhóm');
    return this.toDto(p);
  }

  /** Tạo nhóm CỦA NGƯỜI GỌI (không nhận chủ từ body). Mọi thành viên đều tạo được nhóm của riêng mình. */
  async create(workspaceId: string, dto: CreateProgramInput, ownerId: string) {
    const name = dto.name.trim();
    await this.assertNameFree(workspaceId, ownerId, name);
    const created = await this.prisma.program.create({
      data: {
        workspaceId,
        ownerId,
        name,
        description: dto.description?.trim() || null,
        color: dto.color ?? null,
        startDate: toDate(dto.startDate),
        targetDate: toDate(dto.targetDate),
      },
      select: { id: true },
    });
    if (dto.projectIds?.length)
      await this.setGroupProjects(workspaceId, created.id, dto.projectIds, ownerId);
    return this.get(workspaceId, created.id, ownerId);
  }

  async update(workspaceId: string, id: string, dto: UpdateProgramInput, ownerId: string) {
    await this.require(workspaceId, id, ownerId);
    const data: Prisma.ProgramUpdateInput = {};
    if (dto.name !== undefined && dto.name !== null) {
      const name = dto.name.trim();
      if (!name) throw new BusinessRuleException('Tên nhóm bắt buộc');
      await this.assertNameFree(workspaceId, ownerId, name, id);
      data.name = name;
    }
    if (dto.description !== undefined) data.description = dto.description?.trim() || null;
    if (dto.color !== undefined) data.color = dto.color ?? null;
    if (dto.startDate !== undefined) data.startDate = toDate(dto.startDate);
    if (dto.targetDate !== undefined) data.targetDate = toDate(dto.targetDate);
    await this.prisma.program.update({ where: { id }, data });
    if (dto.projectIds !== undefined)
      await this.setGroupProjects(workspaceId, id, dto.projectIds, ownerId);
    return this.get(workspaceId, id, ownerId);
  }

  async remove(workspaceId: string, id: string, ownerId: string) {
    await this.require(workspaceId, id, ownerId);
    await this.prisma.program.delete({ where: { id } }); // ProjectProgram của nhóm xoá theo (cascade)
    return { success: true };
  }

  /**
   * Đặt lại TOÀN BỘ tập dự án của MỘT nhóm của người gọi (trong phạm vi người gọi thấy): ngoài danh sách → gỡ khỏi nhóm
   * (không đụng nhóm khác). Dự án riêng tư người gọi không thấy không gắn được (cùng lỗi với dự án ngoài tổ chức) và cũng
   * không bị gỡ nhầm khi người gọi gửi lại danh sách chỉ gồm phần họ thấy.
   */
  private async setGroupProjects(
    workspaceId: string,
    id: string,
    projectIds: string[],
    ownerId: string,
  ) {
    const visible = await this.visibleFor(workspaceId, ownerId);
    const ids = [...new Set(projectIds)];
    if (ids.length > 0) {
      const found = await this.prisma.project.findMany({
        where: { id: { in: ids }, workspaceId, deletedAt: null, ...visible },
        select: { id: true },
      });
      if (found.length !== ids.length)
        throw new BusinessRuleException(
          'Một số dự án không thuộc tổ chức này — hãy bỏ chọn những dự án đó',
        );
    }
    await this.prisma.$transaction([
      // Chỉ gỡ dự án người gọi thấy (và còn sống); dự án ẩn không bị gỡ nhầm.
      this.prisma.projectProgram.deleteMany({
        where: {
          programId: id,
          project: { workspaceId, deletedAt: null, ...visible },
          ...(ids.length ? { projectId: { notIn: ids } } : {}),
        },
      }),
      ...(ids.length
        ? [
            this.prisma.projectProgram.createMany({
              data: ids.map((projectId) => ({ projectId, programId: id })),
              skipDuplicates: true,
            }),
          ]
        : []),
    ]);
  }

  /**
   * Đặt lại TOÀN BỘ các nhóm CỦA NGƯỜI GỌI cho MỘT dự án (popover "Nhóm" ở danh sách dự án): bất kỳ dự án nào người gọi
   * xem được, không cần quyền quản trị. Chỉ động tới liên kết thuộc nhóm của chính người gọi — nhóm/liên kết của người
   * khác không bị xem, không bị gỡ. Chỉ gán nhóm CỦA NGƯỜI GỌI; nhóm lạ (của người khác, của tổ chức khác, không tồn tại)
   * báo lỗi chung. Nhóm là phân loại cá nhân nên đổi nhóm vẫn được khi dự án đã lưu trữ. Trả nhóm mới của người gọi cho dự án.
   */
  async setForProject(
    workspaceId: string,
    projectId: string,
    programIds: string[],
    viewerId: string,
  ) {
    await this.access.assertCanSee(viewerId, workspaceId, projectId);
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, workspaceId, deletedAt: null },
      select: { id: true },
    });
    if (!project) throw new NotFoundAppException('Dự án');
    const ids = [...new Set(programIds)];
    if (ids.length > 0) {
      const found = await this.prisma.program.count({
        where: { id: { in: ids }, workspaceId, ownerId: viewerId },
      });
      if (found !== ids.length)
        throw new BusinessRuleException(
          'Một số nhóm không phải của bạn — hãy bỏ chọn những nhóm đó',
        );
    }
    await this.prisma.$transaction([
      this.prisma.projectProgram.deleteMany({
        where: {
          projectId,
          program: { ownerId: viewerId, workspaceId },
          ...(ids.length ? { programId: { notIn: ids } } : {}),
        },
      }),
      ...(ids.length
        ? [
            this.prisma.projectProgram.createMany({
              data: ids.map((programId) => ({ projectId, programId })),
              skipDuplicates: true,
            }),
          ]
        : []),
    ]);
    const links = await this.prisma.projectProgram.findMany({
      where: { projectId, program: { ownerId: viewerId, workspaceId } },
      orderBy: { program: { name: 'asc' } },
      select: { program: { select: { id: true, name: true, color: true } } },
    });
    return { projectId, programs: links.map((l) => l.program) };
  }

  // ───────────────────────── helpers ─────────────────────────

  /** Nhóm phải là của người gọi — nhóm của người khác trả 404 như không tồn tại. */
  private async require(workspaceId: string, id: string, ownerId: string) {
    const p = await this.prisma.program.findFirst({
      where: { id, workspaceId, ownerId },
      select: { id: true, name: true },
    });
    if (!p) throw new NotFoundAppException('Nhóm');
    return p;
  }

  /** Tên nhóm duy nhất TRONG các nhóm của cùng một người (người khác đặt trùng tên vẫn được). */
  private async assertNameFree(
    workspaceId: string,
    ownerId: string,
    name: string,
    excludeId?: string,
  ) {
    const clash = await this.prisma.program.findFirst({
      where: { workspaceId, ownerId, name, ...(excludeId ? { NOT: { id: excludeId } } : {}) },
      select: { id: true },
    });
    if (clash) throw new BusinessRuleException('Bạn đã có một nhóm cùng tên');
  }

  private toDto(p: {
    id: string;
    workspaceId: string;
    name: string;
    description: string | null;
    color: string | null;
    startDate: Date | null;
    targetDate: Date | null;
    createdAt: Date;
    projects: { project: { id: string; key: string; name: string; isArchived: boolean } }[];
  }) {
    return {
      id: p.id,
      workspaceId: p.workspaceId,
      name: p.name,
      description: p.description,
      color: p.color,
      startDate: p.startDate?.toISOString() ?? null,
      targetDate: p.targetDate?.toISOString() ?? null,
      projects: p.projects.map((l) => l.project),
      projectCount: p.projects.length,
      createdAt: p.createdAt.toISOString(),
    };
  }
}

function toDate(v: string | null | undefined): Date | null {
  if (v === undefined || v === null) return null;
  const s = v.trim();
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}
