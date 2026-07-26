import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { BusinessRuleException, NotFoundAppException } from '../../common/exceptions/app.exception';
import type {
  CreateClientInput, UpdateClientInput, CreateContractInput, UpdateContractInput,
} from './clients.schemas';

const CONTRACT_SELECT = {
  id: true, clientId: true, projectId: true, name: true, code: true, value: true, currency: true,
  startDate: true, endDate: true, note: true, createdAt: true,
  project: { select: { id: true, key: true, name: true } },
} satisfies Prisma.ContractSelect;

const CLIENT_SELECT = {
  id: true, workspaceId: true, name: true, contactName: true, email: true, phone: true, note: true, createdAt: true,
  projects: {
    where: { deletedAt: null },
    orderBy: { name: 'asc' as const },
    select: { id: true, key: true, name: true, isArchived: true },
  },
  contracts: { orderBy: { createdAt: 'desc' as const }, select: CONTRACT_SELECT },
} satisfies Prisma.ClientSelect;

type ContractRow = {
  id: string; clientId: string; projectId: string | null; name: string; code: string | null;
  value: number | null; currency: string; startDate: Date | null; endDate: Date | null;
  note: string | null; createdAt: Date;
  project: { id: string; key: string; name: string } | null;
};

/**
 * Khách hàng & hợp đồng — phần "phía cầu" của danh mục dự án.
 * Hợp đồng luôn thuộc một khách hàng; có thể (tuỳ chọn) gắn vào một dự án.
 * Xoá khách hàng: hợp đồng cascade, Project.clientId về null (FK SET NULL).
 */
@Injectable()
export class ClientsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(workspaceId: string) {
    const rows = await this.prisma.client.findMany({
      where: { workspaceId },
      orderBy: { name: 'asc' },
      select: CLIENT_SELECT,
    });
    return rows.map((c) => this.toDto(c));
  }

  async get(workspaceId: string, id: string) {
    const c = await this.prisma.client.findFirst({ where: { id, workspaceId }, select: CLIENT_SELECT });
    if (!c) throw new NotFoundAppException('Khách hàng');
    return this.toDto(c);
  }

  async create(workspaceId: string, dto: CreateClientInput) {
    const name = dto.name.trim();
    await this.assertNameFree(workspaceId, name);
    const created = await this.prisma.client.create({
      data: {
        workspaceId,
        name,
        contactName: blankToNull(dto.contactName),
        email: blankToNull(dto.email),
        phone: blankToNull(dto.phone),
        note: blankToNull(dto.note),
      },
      select: { id: true },
    });
    if (dto.projectIds?.length) await this.setProjects(workspaceId, created.id, dto.projectIds);
    return this.get(workspaceId, created.id);
  }

  async update(workspaceId: string, id: string, dto: UpdateClientInput) {
    await this.require(workspaceId, id);
    const data: Prisma.ClientUpdateInput = {};
    if (dto.name !== undefined && dto.name !== null) {
      const name = dto.name.trim();
      if (!name) throw new BusinessRuleException('Tên khách hàng bắt buộc');
      await this.assertNameFree(workspaceId, name, id);
      data.name = name;
    }
    if (dto.contactName !== undefined) data.contactName = blankToNull(dto.contactName);
    if (dto.email !== undefined) data.email = blankToNull(dto.email);
    if (dto.phone !== undefined) data.phone = blankToNull(dto.phone);
    if (dto.note !== undefined) data.note = blankToNull(dto.note);

    await this.prisma.client.update({ where: { id }, data });
    if (dto.projectIds !== undefined) await this.setProjects(workspaceId, id, dto.projectIds);
    return this.get(workspaceId, id);
  }

  async remove(workspaceId: string, id: string) {
    await this.require(workspaceId, id);
    await this.prisma.client.delete({ where: { id } }); // contracts cascade, Project.clientId → null
    return { success: true };
  }

  /** Đặt lại TOÀN BỘ tập dự án của khách hàng (ngoài danh sách → gỡ liên kết). */
  async setProjects(workspaceId: string, id: string, projectIds: string[]) {
    await this.require(workspaceId, id);
    const ids = await this.validateProjects(workspaceId, projectIds);
    await this.prisma.$transaction([
      this.prisma.project.updateMany({
        where: { workspaceId, clientId: id, ...(ids.length ? { id: { notIn: ids } } : {}) },
        data: { clientId: null },
      }),
      ...(ids.length
        ? [this.prisma.project.updateMany({ where: { workspaceId, id: { in: ids } }, data: { clientId: id } })]
        : []),
    ]);
    return this.get(workspaceId, id);
  }

  // ───────────────────────── hợp đồng ─────────────────────────

  async listContracts(workspaceId: string, clientId: string) {
    await this.require(workspaceId, clientId);
    const rows = await this.prisma.contract.findMany({
      where: { clientId },
      orderBy: { createdAt: 'desc' },
      select: CONTRACT_SELECT,
    });
    return rows.map((c) => this.toContractDto(c));
  }

  async createContract(workspaceId: string, clientId: string, dto: CreateContractInput) {
    await this.require(workspaceId, clientId);
    const projectId = await this.resolveProject(workspaceId, dto.projectId ?? null);
    const created = await this.prisma.contract.create({
      data: {
        clientId,
        projectId,
        name: dto.name.trim(),
        code: blankToNull(dto.code),
        value: dto.value ?? null,
        currency: dto.currency?.trim().toUpperCase() || 'VND',
        startDate: toDate(dto.startDate),
        endDate: toDate(dto.endDate),
        note: blankToNull(dto.note),
      },
      select: CONTRACT_SELECT,
    });
    return this.toContractDto(created);
  }

  async updateContract(workspaceId: string, clientId: string, contractId: string, dto: UpdateContractInput) {
    await this.requireContract(workspaceId, clientId, contractId);
    const data: Prisma.ContractUpdateInput = {};
    if (dto.name !== undefined && dto.name !== null) {
      const name = dto.name.trim();
      if (!name) throw new BusinessRuleException('Tên hợp đồng bắt buộc');
      data.name = name;
    }
    if (dto.code !== undefined) data.code = blankToNull(dto.code);
    if (dto.value !== undefined) data.value = dto.value ?? null;
    if (dto.currency !== undefined) data.currency = dto.currency?.trim().toUpperCase() || 'VND';
    if (dto.startDate !== undefined) data.startDate = toDate(dto.startDate);
    if (dto.endDate !== undefined) data.endDate = toDate(dto.endDate);
    if (dto.note !== undefined) data.note = blankToNull(dto.note);
    if (dto.projectId !== undefined) {
      const projectId = await this.resolveProject(workspaceId, dto.projectId ?? null);
      data.project = projectId ? { connect: { id: projectId } } : { disconnect: true };
    }
    const updated = await this.prisma.contract.update({ where: { id: contractId }, data, select: CONTRACT_SELECT });
    return this.toContractDto(updated);
  }

  async removeContract(workspaceId: string, clientId: string, contractId: string) {
    await this.requireContract(workspaceId, clientId, contractId);
    await this.prisma.contract.delete({ where: { id: contractId } });
    return { success: true };
  }

  // ───────────────────────── helpers ─────────────────────────

  private async require(workspaceId: string, id: string) {
    const c = await this.prisma.client.findFirst({ where: { id, workspaceId }, select: { id: true } });
    if (!c) throw new NotFoundAppException('Khách hàng');
    return c;
  }

  private async requireContract(workspaceId: string, clientId: string, contractId: string) {
    await this.require(workspaceId, clientId);
    const c = await this.prisma.contract.findFirst({ where: { id: contractId, clientId }, select: { id: true } });
    if (!c) throw new NotFoundAppException('Hợp đồng');
    return c;
  }

  private async assertNameFree(workspaceId: string, name: string, excludeId?: string) {
    const clash = await this.prisma.client.findFirst({
      where: { workspaceId, name, ...(excludeId ? { NOT: { id: excludeId } } : {}) },
      select: { id: true },
    });
    if (clash) throw new BusinessRuleException('Tên khách hàng đã tồn tại');
  }

  private async validateProjects(workspaceId: string, projectIds: string[]): Promise<string[]> {
    const ids = [...new Set(projectIds)];
    if (ids.length === 0) return [];
    const found = await this.prisma.project.findMany({
      where: { id: { in: ids }, workspaceId, deletedAt: null },
      select: { id: true },
    });
    if (found.length !== ids.length) throw new BusinessRuleException('Một số dự án không thuộc workspace này');
    return ids;
  }

  private async resolveProject(workspaceId: string, projectId: string | null): Promise<string | null> {
    if (!projectId) return null;
    const [id] = await this.validateProjects(workspaceId, [projectId]);
    return id ?? null;
  }

  private toContractDto(c: ContractRow) {
    return {
      id: c.id,
      clientId: c.clientId,
      name: c.name,
      code: c.code,
      value: c.value,
      currency: c.currency,
      startDate: c.startDate?.toISOString() ?? null,
      endDate: c.endDate?.toISOString() ?? null,
      note: c.note,
      project: c.project,
      createdAt: c.createdAt.toISOString(),
    };
  }

  private toDto(c: {
    id: string; workspaceId: string; name: string; contactName: string | null; email: string | null;
    phone: string | null; note: string | null; createdAt: Date;
    projects: { id: string; key: string; name: string; isArchived: boolean }[];
    contracts: ContractRow[];
  }) {
    const contracts = c.contracts.map((x) => this.toContractDto(x));
    // Tổng giá trị chỉ cộng các hợp đồng cùng tiền tệ chiếm đa số → tránh cộng nhầm VND với USD.
    const byCurrency = new Map<string, number>();
    for (const ct of contracts) {
      if (ct.value == null) continue;
      byCurrency.set(ct.currency, (byCurrency.get(ct.currency) ?? 0) + ct.value);
    }
    return {
      id: c.id,
      workspaceId: c.workspaceId,
      name: c.name,
      contactName: c.contactName,
      email: c.email,
      phone: c.phone,
      note: c.note,
      projects: c.projects,
      projectCount: c.projects.length,
      contracts,
      contractCount: contracts.length,
      /** Tổng giá trị hợp đồng, tách theo từng loại tiền tệ. */
      contractTotals: [...byCurrency.entries()].map(([currency, value]) => ({ currency, value })),
      createdAt: c.createdAt.toISOString(),
    };
  }
}

function blankToNull(v: string | null | undefined): string | null {
  if (v === undefined || v === null) return null;
  const s = v.trim();
  return s ? s : null;
}

function toDate(v: string | null | undefined): Date | null {
  if (v === undefined || v === null) return null;
  const s = v.trim();
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}
