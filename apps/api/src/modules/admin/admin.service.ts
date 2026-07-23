import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { BusinessRuleException, NotFoundAppException } from '../../common/exceptions/app.exception';
import { offsetPage } from '../../common/dto/page-result';
import type { CreateUserInput, UpdateUserInput } from './admin.schemas';

const USER_SELECT = {
  id: true, email: true, displayName: true, avatarUrl: true, status: true,
  isSystemAdmin: true, canCreateWorkspace: true, lastSeenAt: true, createdAt: true,
  _count: { select: { workspaceMemberships: true } },
} as const;

type Row = {
  id: string; email: string; displayName: string; avatarUrl: string | null; status: string;
  isSystemAdmin: boolean; canCreateWorkspace: boolean; lastSeenAt: Date | null; createdAt: Date;
  _count: { workspaceMemberships: number };
};

/** Quản trị tài khoản toàn hệ thống (chỉ admin hệ thống). */
@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  private toDto(u: Row) {
    return {
      id: u.id, email: u.email, displayName: u.displayName, avatarUrl: u.avatarUrl, status: u.status,
      isSystemAdmin: u.isSystemAdmin, canCreateWorkspace: u.canCreateWorkspace,
      workspaceCount: u._count.workspaceMemberships,
      lastSeenAt: u.lastSeenAt?.toISOString() ?? null, createdAt: u.createdAt.toISOString(),
    };
  }

  async list() {
    const rows = await this.prisma.user.findMany({ orderBy: { createdAt: 'asc' }, select: USER_SELECT });
    const data = rows.map((r) => this.toDto(r as Row));
    // Danh sách "all-in-one" (không phân trang) — vẫn bọc envelope theo cross-cutting decision.
    return offsetPage(data, 1, Math.max(1, data.length), data.length);
  }

  async create(input: CreateUserInput) {
    const email = input.email.toLowerCase();
    const exists = await this.prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (exists) throw new BusinessRuleException('Email đã tồn tại');

    let tempPassword: string | undefined;
    // Mật khẩu tạm: ngẫu nhiên bằng crypto (không dùng cuid — cuid không phải bí mật an toàn).
    const plain = input.password ?? (tempPassword = randomBytes(18).toString('base64url'));
    const passwordHash = await argon2.hash(plain);
    const created = await this.prisma.user.create({
      data: {
        email,
        displayName: input.displayName,
        passwordHash,
        isSystemAdmin: input.isSystemAdmin ?? false,
        canCreateWorkspace: input.canCreateWorkspace ?? false,
      },
      select: USER_SELECT,
    });
    return { ...this.toDto(created as Row), tempPassword };
  }

  async update(id: string, input: UpdateUserInput) {
    const found = await this.prisma.user.findUnique({ where: { id }, select: { id: true } });
    if (!found) throw new NotFoundAppException('Người dùng');
    const updated = await this.prisma.user.update({
      where: { id },
      data: {
        displayName: input.displayName,
        isSystemAdmin: input.isSystemAdmin,
        canCreateWorkspace: input.canCreateWorkspace,
        status: input.status as never,
      },
      select: USER_SELECT,
    });
    return this.toDto(updated as Row);
  }
}
