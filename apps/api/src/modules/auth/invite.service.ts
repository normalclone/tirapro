import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import { SYSTEM_ROLES } from '@tirapro/types';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { BusinessRuleException, NotFoundAppException } from '../../common/exceptions/app.exception';
import { MailService } from '../mail/mail.service';
import { RbacService } from '../rbac/rbac.service';
import { generateOneTimeToken, hashOneTimeToken } from './auth-token';

export const INVITE_TTL_MS = 7 * 24 * 60 * 60_000;

const INVALID_INVITE =
  'Lời mời không hợp lệ hoặc đã được dùng — hãy nhờ quản trị viên gửi lời mời mới';
const EXPIRED_INVITE = 'Lời mời đã hết hạn — hãy nhờ quản trị viên gửi lời mời mới';

@Injectable()
export class InviteService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
    private readonly rbac: RbacService,
  ) {}

  /**
   * Tạo lời mời + xếp thư vào outbox (cùng transaction). Lời mời cũ còn hiệu lực của cùng email bị vô hiệu.
   * `acceptUrl` chỉ trả về khi MAIL_DRIVER=console (dev chưa có thư thật để admin chuyển liên kết bằng tay);
   * khi gửi thư thật, liên kết chỉ nằm trong hộp thư của người được mời.
   */
  async createInvite(
    workspaceId: string,
    invitedById: string,
    input: { email: string; roleId?: string },
  ): Promise<{ inviteId: string; acceptUrl?: string }> {
    const email = input.email.trim().toLowerCase();
    const roleId = await this.resolveRoleId(workspaceId, input.roleId);

    const [workspace, inviter, existingUser] = await Promise.all([
      this.prisma.workspace.findFirst({
        where: { id: workspaceId, deletedAt: null },
        select: { name: true },
      }),
      this.prisma.user.findUnique({ where: { id: invitedById }, select: { displayName: true } }),
      this.prisma.user.findUnique({ where: { email }, select: { id: true } }),
    ]);
    if (!workspace) throw new NotFoundAppException('Không gian làm việc');

    if (existingUser) {
      const member = await this.prisma.workspaceMembership.findUnique({
        where: { workspaceId_userId: { workspaceId, userId: existingUser.id } },
        select: { id: true },
      });
      if (member)
        throw new BusinessRuleException('Người này đã là thành viên của không gian làm việc');
    }

    const { token, tokenHash } = generateOneTimeToken();
    const acceptUrl = `${this.config.get<string>('mail.appWebUrl') ?? ''}/invite/accept?token=${token}`;
    const now = new Date();

    const invite = await this.prisma.$transaction(async (tx) => {
      await tx.inviteToken.updateMany({
        where: { workspaceId, email, acceptedAt: null, expiresAt: { gt: now } },
        data: { expiresAt: now },
      });
      const created = await tx.inviteToken.create({
        data: {
          workspaceId,
          email,
          roleId,
          tokenHash,
          invitedById,
          expiresAt: new Date(now.getTime() + INVITE_TTL_MS),
        },
        select: { id: true },
      });
      await this.mail.enqueue(
        {
          to: email,
          template: 'invite',
          payload: {
            workspaceName: workspace.name,
            inviterName: inviter?.displayName ?? 'Một đồng nghiệp',
            acceptUrl,
          },
        },
        tx,
      );
      return created;
    });

    return this.config.get<string>('mail.driver') === 'console'
      ? { inviteId: invite.id, acceptUrl }
      : { inviteId: invite.id };
  }

  /**
   * Chấp nhận lời mời: tạo user mới (displayName + mật khẩu) hoặc gắn vào user có sẵn cùng email
   * (khi đó giữ nguyên mật khẩu/tên cũ). Token dùng một lần — giành bằng updateMany có điều kiện.
   * Không cấp phiên đăng nhập: web chuyển người dùng sang trang đăng nhập.
   */
  async acceptInvite(input: {
    token: string;
    displayName: string;
    password: string;
  }): Promise<{ userId: string; workspaceId: string; existingUser: boolean }> {
    const invite = await this.prisma.inviteToken.findUnique({
      where: { tokenHash: hashOneTimeToken(input.token) },
    });
    if (!invite || invite.acceptedAt) throw new BusinessRuleException(INVALID_INVITE);
    if (invite.expiresAt.getTime() <= Date.now()) throw new BusinessRuleException(EXPIRED_INVITE);

    // Workspace đã xoá mềm thì lời mời vô hiệu — kiểm trước khi băm mật khẩu và trước khi giành token.
    const ws = await this.prisma.workspace.findFirst({
      where: { id: invite.workspaceId, deletedAt: null },
      select: { id: true },
    });
    if (!ws) throw new BusinessRuleException(INVALID_INVITE);

    // Băm ngoài transaction để không giữ kết nối DB trong lúc argon2 chạy.
    const passwordHash = await argon2.hash(input.password);

    const result = await this.prisma.$transaction(async (tx) => {
      const now = new Date();
      const claim = await tx.inviteToken.updateMany({
        where: { id: invite.id, acceptedAt: null, expiresAt: { gt: now } },
        data: { acceptedAt: now },
      });
      if (claim.count !== 1) throw new BusinessRuleException(INVALID_INVITE);

      const role = await tx.role.findFirst({
        where: {
          id: invite.roleId,
          OR: [{ workspaceId: invite.workspaceId }, { workspaceId: null }],
        },
        select: { id: true },
      });
      if (!role)
        throw new BusinessRuleException(
          'Vai trò trong lời mời không còn tồn tại — hãy nhờ quản trị viên gửi lời mời mới',
        );

      const existing = await tx.user.findUnique({
        where: { email: invite.email },
        select: { id: true, status: true },
      });
      if (existing?.status === 'DEACTIVATED') {
        throw new BusinessRuleException(
          'Tài khoản này đã bị vô hiệu hoá — hãy liên hệ quản trị viên',
        );
      }
      const userId =
        existing?.id ??
        (
          await tx.user.create({
            data: { email: invite.email, displayName: input.displayName, passwordHash },
            select: { id: true },
          })
        ).id;

      // Idempotent: đã là thành viên (được thêm tay giữa chừng) thì không tạo trùng.
      const member = await tx.workspaceMembership.findUnique({
        where: { workspaceId_userId: { workspaceId: invite.workspaceId, userId } },
        select: { id: true },
      });
      if (!member) {
        await tx.workspaceMembership.create({
          data: {
            workspaceId: invite.workspaceId,
            userId,
            roleId: role.id,
            joinedAt: now,
            roles: { create: [{ roleId: role.id }] },
          },
        });
      }
      return { userId, workspaceId: invite.workspaceId, existingUser: !!existing };
    });

    await this.rbac.invalidate(result.userId, result.workspaceId);
    return result;
  }

  /** Role hợp lệ = thuộc workspace hoặc role hệ thống; không truyền → "Workspace Member". */
  private async resolveRoleId(workspaceId: string, roleId?: string): Promise<string> {
    if (roleId) {
      const found = await this.prisma.role.findFirst({
        where: { id: roleId, scope: 'WORKSPACE', OR: [{ workspaceId }, { workspaceId: null }] },
        select: { id: true },
      });
      if (!found) throw new NotFoundAppException('Vai trò');
      return found.id;
    }
    const memberRole = await this.prisma.role.findFirst({
      where: {
        name: SYSTEM_ROLES.WORKSPACE_MEMBER,
        scope: 'WORKSPACE',
        workspaceId: null,
        isSystem: true,
      },
      select: { id: true },
    });
    if (!memberRole) throw new Error('System role chưa được seed (chạy pnpm db:seed)');
    return memberRole.id;
  }
}
