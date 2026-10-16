import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import {
  AUDIT_ACTIONS,
  DEFAULT_PROJECT_ROLE_BY_WS_ROLE,
  DOMAIN_EVENTS,
  roleLabel,
  type RoleScope,
} from '@tirapro/types';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { toUserDto, USER_DTO_SELECT, type UserDtoSource } from '../../common/mappers/user.mapper';
import {
  BusinessRuleException,
  EmailAlreadyRegisteredException,
  ForbiddenAppException,
  NotFoundAppException,
} from '../../common/exceptions/app.exception';
import { generateTempPassword } from '../../common/password';
import { RbacService } from '../rbac/rbac.service';
import { ApiKeyService } from '../api-keys/api-key.service';
import { AuditService } from '../audit/audit.service';
import { SYSTEM_USER_EMAIL } from '../automation/rule-engine.service';
import type { CreateMemberAccountInput } from './members.schemas';

type RoleRefRow = { role: { id: string; name: string; color: string | null } };

/**
 * Quản lý thành viên + GÁN NHIỀU VAI TRÒ ở cấp workspace và project.
 * roleId trên membership = vai trò chính (= roleIds[0]); join table giữ toàn bộ.
 */
@Injectable()
export class MembersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rbac: RbacService,
    private readonly apiKeys: ApiKeyService,
    private readonly events: EventEmitter2,
    private readonly audit: AuditService,
  ) {}

  // ───────────────────────── Workspace ─────────────────────────

  async listWorkspace(workspaceId: string) {
    const rows = await this.prisma.workspaceMembership.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        joinedAt: true,
        roleId: true,
        role: { select: { id: true, name: true, color: true } },
        user: { select: USER_DTO_SELECT },
        roles: { select: { role: { select: { id: true, name: true, color: true } } } },
      },
    });
    return rows.map((m) => this.toMemberDto(m, m.role));
  }

  async addWorkspace(workspaceId: string, userId: string, roleIds: string[], actorId?: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, status: true, email: true },
    });
    if (!user) throw new NotFoundAppException('Người dùng');
    const existing = await this.prisma.workspaceMembership.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
      select: { id: true },
    });
    if (existing) return this.setWorkspaceRoles(workspaceId, userId, roleIds, actorId); // đã là thành viên → cập nhật vai trò
    this.assertAddable([user]);
    const ids = await this.validateRoles(workspaceId, roleIds, 'WORKSPACE');
    await this.prisma.workspaceMembership.create({
      data: {
        workspaceId,
        userId,
        roleId: ids[0]!,
        joinedAt: new Date(),
        roles: { create: ids.map((roleId) => ({ roleId })) },
      },
    });
    await this.rbac.invalidate(userId, workspaceId);
    const member = await this.getWorkspaceMember(workspaceId, userId);
    await this.audit.record({
      workspaceId,
      actorId,
      action: AUDIT_ACTIONS.MEMBER_ADDED,
      entityType: 'user',
      entityId: userId,
      summary: `Thêm ${this.label(member.user)} với vai trò ${this.roleNames(member.roles)}`,
      meta: { roleIds: ids },
    });
    this.emitMemberAdded(workspaceId, [userId], actorId);
    return member;
  }

  /**
   * Báo "người mới vào workspace" SAU khi đã commit (L28: Jira import tự gán các việc đã nhớ email của họ).
   * Chỉ cho người thật sự được thêm — đổi vai trò của người đã là thành viên không phát.
   */
  private emitMemberAdded(workspaceId: string, userIds: string[], actorId?: string): void {
    if (userIds.length === 0) return;
    this.events.emit(DOMAIN_EVENTS.MEMBER_ADDED, { workspaceId, userIds, actorId });
  }

  /**
   * Tạo tài khoản mới + membership + vai trò trong MỘT transaction (không để lại tài khoản mồ côi khi bước
   * thêm thất bại). Mật khẩu tạm chỉ trả về ở đây, không lưu thô.
   */
  async createAccount(workspaceId: string, actorId: string, input: CreateMemberAccountInput) {
    const email = input.email.toLowerCase();
    const exists = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, status: true },
    });
    if (exists) throw this.emailTakenError(email, exists.status);
    const ids = await this.validateRoles(workspaceId, input.roleIds, 'WORKSPACE');
    const tempPassword = input.password ? undefined : generateTempPassword();
    const passwordHash = await argon2.hash(input.password ?? tempPassword!); // băm NGOÀI transaction (chậm)
    const userId = await this.createAccountTx(
      workspaceId,
      actorId,
      input,
      email,
      ids,
      passwordHash,
    );
    await this.rbac.invalidate(userId, workspaceId);
    const member = await this.getWorkspaceMember(workspaceId, userId);
    this.emitMemberAdded(workspaceId, [userId], actorId);
    return { member, tempPassword };
  }

  /** Transaction tạo user + membership + nhật ký; hai request trùng email đồng thời → P2002 → cùng lỗi "đã có tài khoản". */
  private async createAccountTx(
    workspaceId: string,
    actorId: string,
    input: CreateMemberAccountInput,
    email: string,
    ids: string[],
    passwordHash: string,
  ): Promise<string> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: { email, displayName: input.displayName, passwordHash },
          select: { id: true },
        });
        await tx.workspaceMembership.create({
          data: {
            workspaceId,
            userId: user.id,
            roleId: ids[0]!,
            joinedAt: new Date(),
            roles: { create: ids.map((roleId) => ({ roleId })) },
          },
        });
        await this.audit.record(
          {
            workspaceId,
            actorId,
            action: AUDIT_ACTIONS.MEMBER_ACCOUNT_CREATED,
            entityType: 'user',
            entityId: user.id,
            summary: `Tạo tài khoản ${input.displayName} (${email}) và thêm vào không gian làm việc`,
            meta: { roleIds: ids },
          },
          tx,
        );
        return user.id;
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw this.emailTakenError(email, 'ACTIVE');
      }
      throw e;
    }
  }

  /** Thông điệp đúng theo tình trạng tài khoản đang giữ email (không bảo "chọn trong danh sách" khi pool đã ẩn họ). */
  private emailTakenError(email: string, status: string) {
    if (email === SYSTEM_USER_EMAIL) {
      return new BusinessRuleException(
        'Email này dành riêng cho tài khoản hệ thống — hãy dùng email khác',
      );
    }
    if (status === 'DEACTIVATED') {
      return new BusinessRuleException(
        'Email này thuộc một tài khoản đã bị vô hiệu hoá — hãy nhờ quản trị hệ thống mở khoá, hoặc dùng email khác',
      );
    }
    return new EmailAlreadyRegisteredException();
  }

  /** Tài khoản vô hiệu hoá và người dùng hệ thống của automation không được thêm vào không gian làm việc. */
  private assertAddable(users: { status: string; email: string }[]): void {
    const bad = users.filter((u) => u.status === 'DEACTIVATED' || u.email === SYSTEM_USER_EMAIL);
    if (bad.length) {
      throw new BusinessRuleException(
        bad.length === 1
          ? 'Không thể thêm tài khoản đã bị vô hiệu hoá hoặc tài khoản hệ thống vào không gian làm việc'
          : `Có ${bad.length} tài khoản đã bị vô hiệu hoá hoặc là tài khoản hệ thống — bỏ họ khỏi danh sách rồi thử lại`,
      );
    }
  }

  async setWorkspaceRoles(
    workspaceId: string,
    userId: string,
    roleIds: string[],
    actorId?: string,
  ) {
    const membership = await this.prisma.workspaceMembership.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
      select: { id: true },
    });
    if (!membership) throw new NotFoundAppException('Thành viên');
    const ids = await this.validateRoles(workspaceId, roleIds, 'WORKSPACE');
    await this.prisma.$transaction([
      this.prisma.workspaceMembershipRole.deleteMany({ where: { membershipId: membership.id } }),
      this.prisma.workspaceMembershipRole.createMany({
        data: ids.map((roleId) => ({ membershipId: membership.id, roleId })),
      }),
      this.prisma.workspaceMembership.update({
        where: { id: membership.id },
        data: { roleId: ids[0]! },
      }),
    ]);
    await this.rbac.invalidate(userId, workspaceId);
    const member = await this.getWorkspaceMember(workspaceId, userId);
    await this.audit.record({
      workspaceId,
      actorId,
      action: AUDIT_ACTIONS.MEMBER_ROLES_CHANGED,
      entityType: 'user',
      entityId: userId,
      summary: `Đổi vai trò của ${this.label(member.user)} thành ${this.roleNames(member.roles)}`,
      meta: { roleIds: ids },
    });
    return member;
  }

  /** Thêm NHIỀU người vào workspace cùng bộ vai trò; bỏ qua người đã là thành viên. */
  async addWorkspaceMany(
    workspaceId: string,
    userIds: string[],
    roleIds: string[],
    actorId?: string,
  ) {
    const ids = await this.validateRoles(workspaceId, roleIds, 'WORKSPACE');
    const unique = [...new Set(userIds)];
    const existUsers = await this.prisma.user.findMany({
      where: { id: { in: unique } },
      select: { id: true, status: true, email: true },
    });
    const valid = new Set(existUsers.map((u) => u.id));
    const already = await this.prisma.workspaceMembership.findMany({
      where: { workspaceId, userId: { in: [...valid] } },
      select: { userId: true },
    });
    const alreadySet = new Set(already.map((a) => a.userId));
    const toAdd = [...valid].filter((u) => !alreadySet.has(u));
    this.assertAddable(existUsers.filter((u) => toAdd.includes(u.id)));
    if (toAdd.length) {
      // Một transaction cho cả lô: hoặc thêm đủ, hoặc không thêm ai. skipDuplicates để hai request đồng thời
      // thêm cùng một người không làm cả lô thất bại; vai trò chỉ gán cho membership chưa có vai trò nào.
      await this.prisma.$transaction(async (tx) => {
        await tx.workspaceMembership.createMany({
          data: toAdd.map((userId) => ({
            workspaceId,
            userId,
            roleId: ids[0]!,
            joinedAt: new Date(),
          })),
          skipDuplicates: true,
        });
        const fresh = await tx.workspaceMembership.findMany({
          where: { workspaceId, userId: { in: toAdd }, roles: { none: {} } },
          select: { id: true },
        });
        await tx.workspaceMembershipRole.createMany({
          data: fresh.flatMap((m) => ids.map((roleId) => ({ membershipId: m.id, roleId }))),
          skipDuplicates: true,
        });
      });
      await this.rbac.invalidateWorkspace(workspaceId);
      await this.audit.record({
        workspaceId,
        actorId,
        action: AUDIT_ACTIONS.MEMBER_ADDED,
        entityType: 'user',
        summary: `Thêm ${toAdd.length} thành viên vào không gian làm việc`,
        meta: { userIds: toAdd, roleIds: ids },
      });
      this.emitMemberAdded(workspaceId, toAdd, actorId);
    }
    return { added: toAdd.length, skipped: unique.length - toAdd.length };
  }

  async removeWorkspace(workspaceId: string, userId: string, actingUserId: string) {
    if (userId === actingUserId) throw new ForbiddenAppException('Không thể tự gỡ chính mình');
    const ws = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { ownerId: true },
    });
    if (ws?.ownerId === userId)
      throw new ForbiddenAppException(
        'Không thể gỡ chủ sở hữu của không gian làm việc — hãy chuyển quyền sở hữu cho người khác trước',
      );
    const who = await this.userLabel(userId);
    // Không để dự án riêng tư mất người cuối cùng (chỉ còn quản trị workspace thấy) — chặn kèm lối thoát.
    const sole = await this.privateProjectsWithOnlyMember(workspaceId, userId);
    if (sole.length > 0)
      throw new BusinessRuleException(
        `${who} là thành viên duy nhất của dự án riêng tư ${sole.join(', ')} — hãy thêm người khác vào dự án (Cấu hình dự án → Thành viên) hoặc chuyển dự án sang công khai trước khi gỡ`,
      );
    // Một transaction: gỡ membership + xoá ghi đè vai trò dự án của workspace này + thu hồi API key.
    // Thiếu bước nào thì người bị gỡ vẫn giữ được quyền qua key/ghi đè dự án còn sót.
    const revokedPrefixes = await this.prisma.$transaction(async (tx) => {
      await tx.workspaceMembership.delete({
        where: { workspaceId_userId: { workspaceId, userId } },
      });
      await tx.projectMembership.deleteMany({ where: { userId, project: { workspaceId } } });
      return this.apiKeys.revokeAllForUser(workspaceId, userId, tx);
    });
    await this.apiKeys.dropCaches(revokedPrefixes);
    await this.rbac.invalidate(userId, workspaceId);
    // Gateway ngắt mọi socket của user này đang ở workspace đó (room ws:<id>).
    this.events.emit(DOMAIN_EVENTS.MEMBER_REMOVED, { workspaceId, userId });
    await this.audit.record({
      workspaceId,
      actorId: actingUserId,
      action: AUDIT_ACTIONS.MEMBER_REMOVED,
      entityType: 'user',
      entityId: userId,
      summary: `Gỡ ${who} khỏi không gian làm việc`,
    });
    return { success: true };
  }

  /** Mã các dự án riêng tư (chưa xoá) mà `userId` là thành viên DUY NHẤT còn thuộc workspace. */
  private async privateProjectsWithOnlyMember(
    workspaceId: string,
    userId: string,
  ): Promise<string[]> {
    const rows = await this.prisma.project.findMany({
      where: { workspaceId, deletedAt: null, isPrivate: true, memberships: { some: { userId } } },
      select: {
        key: true,
        // Chỉ tính thành viên còn thuộc workspace (dòng của người đã rời workspace không còn ý nghĩa).
        memberships: {
          where: { user: { workspaceMemberships: { some: { workspaceId } } } },
          select: { userId: true },
        },
      },
      orderBy: { key: 'asc' },
    });
    return rows.filter((p) => p.memberships.every((m) => m.userId === userId)).map((p) => p.key);
  }

  // ───────────────────────── Project ─────────────────────────

  /** Dự án PHẢI thuộc workspace của người gọi (chống truy cập chéo tenant). Trả về dự án khi hợp lệ. */
  private async requireProject(workspaceId: string, projectId: string) {
    const p = await this.prisma.project.findFirst({
      where: { id: projectId, workspaceId, deletedAt: null },
      select: { id: true, name: true, isPrivate: true },
    });
    if (!p) throw new NotFoundAppException('Dự án');
    return p;
  }

  /**
   * Thành viên DỰ ÁN = TOÀN BỘ thành viên workspace (dự án dùng chung tập người dùng).
   * Vai trò hiển thị là vai trò HIỆU LỰC: ghi đè riêng ở dự án nếu có, ngược lại là
   * vai trò mặc định suy từ vai trò workspace (`DEFAULT_PROJECT_ROLE_BY_WS_ROLE`).
   */
  async listProject(workspaceId: string, projectId: string) {
    const project = await this.requireProject(workspaceId, projectId);
    const [wsRows, overrides, projectRoles] = await Promise.all([
      this.prisma.workspaceMembership.findMany({
        where: { workspaceId },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          joinedAt: true,
          roleId: true,
          role: { select: { id: true, name: true, color: true } },
          user: { select: USER_DTO_SELECT },
          roles: { select: { role: { select: { id: true, name: true, color: true } } } },
        },
      }),
      this.prisma.projectMembership.findMany({
        where: { projectId },
        select: {
          id: true,
          userId: true,
          roleId: true,
          role: { select: { id: true, name: true, color: true } },
          roles: { select: { role: { select: { id: true, name: true, color: true } } } },
        },
      }),
      this.prisma.role.findMany({
        where: { scope: 'PROJECT', OR: [{ workspaceId }, { workspaceId: null }] },
        select: { id: true, name: true, color: true },
      }),
    ]);
    const overrideByUser = new Map(overrides.map((o) => [o.userId, o]));
    // Dự án riêng tư: thành viên = chỉ các dòng ProjectMembership (không có "mặc định theo workspace").
    const visibleRows = project.isPrivate
      ? wsRows.filter((m) => overrideByUser.has(m.user.id))
      : wsRows;
    const projRoleByName = new Map(projectRoles.map((r) => [r.name, r]));

    return visibleRows.map((m) => {
      const ov = overrideByUser.get(m.user.id);
      if (ov) {
        return {
          ...this.toMemberDto({ id: ov.id, user: m.user, roles: ov.roles }, ov.role),
          isOverride: true,
        };
      }
      // Vai trò mặc định theo vai trò workspace của người này.
      const defaults: { id: string; name: string; color: string | null }[] = [];
      for (const r of m.roles.length ? m.roles : [{ role: m.role }]) {
        const target = DEFAULT_PROJECT_ROLE_BY_WS_ROLE[r.role.name];
        const found = target ? projRoleByName.get(target) : undefined;
        if (found && !defaults.some((d) => d.id === found.id)) defaults.push(found);
      }
      return {
        membershipId: m.id,
        user: toUserDto(m.user),
        roles: defaults,
        joinedAt: m.joinedAt ? m.joinedAt.toISOString() : null,
        isOverride: false,
      };
    });
  }

  /** Xoá GHI ĐÈ vai trò ở dự án → người này quay về vai trò mặc định của workspace. */
  async clearProjectOverride(
    workspaceId: string,
    projectId: string,
    userId: string,
    actorId?: string,
  ) {
    const project = await this.requireProject(workspaceId, projectId);
    if (project.isPrivate) {
      // Dự án riêng tư: gỡ ghi đè = GỠ KHỎI DỰ ÁN. Không để dự án không còn thành viên nào (mồ côi).
      const members = await this.prisma.projectMembership.count({
        where: { projectId, user: { workspaceMemberships: { some: { workspaceId } } } },
      });
      const isMember = await this.prisma.projectMembership.findUnique({
        where: { projectId_userId: { projectId, userId } },
        select: { id: true },
      });
      if (isMember && members <= 1)
        throw new BusinessRuleException('Dự án phải còn ít nhất một thành viên');
    }
    const { count } = await this.prisma.projectMembership.deleteMany({
      where: { projectId, userId },
    });
    await this.rbac.invalidate(userId, workspaceId);
    if (count === 0) return { success: true }; // không có vai trò riêng để gỡ → không ghi nhật ký
    await this.audit.record({
      workspaceId,
      actorId,
      action: AUDIT_ACTIONS.PROJECT_MEMBER_REMOVED,
      entityType: 'user',
      entityId: userId,
      summary: project.isPrivate
        ? `Gỡ ${await this.userLabel(userId)} khỏi dự án riêng tư "${project.name}"`
        : `Gỡ vai trò riêng của ${await this.userLabel(userId)} trong dự án "${project.name}"`,
      meta: { projectId },
    });
    return { success: true };
  }

  async addProject(
    workspaceId: string,
    projectId: string,
    userId: string,
    roleIds: string[],
    actorId?: string,
  ): Promise<Awaited<ReturnType<MembersService['getProjectMember']>>> {
    const project = await this.requireProject(workspaceId, projectId);
    await this.assertWorkspaceMember(workspaceId, userId);
    const ids = await this.validateRoles(workspaceId, roleIds, 'PROJECT');
    const existing = await this.prisma.projectMembership.findUnique({
      where: { projectId_userId: { projectId, userId } },
      select: { id: true },
    });
    if (existing) return this.setProjectRoles(workspaceId, projectId, userId, roleIds, actorId);

    const member = await this.createProjectMembership(workspaceId, projectId, userId, ids);
    await this.audit.record({
      workspaceId,
      actorId,
      action: AUDIT_ACTIONS.PROJECT_MEMBER_ADDED,
      entityType: 'user',
      entityId: userId,
      summary: `Thêm ${this.label(member.user)} vào dự án "${project.name}" với vai trò ${this.roleNames(member.roles)}`,
      meta: { projectId, roleIds: ids },
    });
    return member;
  }

  async setProjectRoles(
    workspaceId: string,
    projectId: string,
    userId: string,
    roleIds: string[],
    actorId?: string,
  ): Promise<Awaited<ReturnType<MembersService['getProjectMember']>>> {
    const project = await this.requireProject(workspaceId, projectId);
    const membership = await this.prisma.projectMembership.findUnique({
      where: { projectId_userId: { projectId, userId } },
      select: { id: true },
    });
    // Chưa có ghi đè → TẠO MỚI (mọi thành viên workspace đều thuộc dự án theo mặc định,
    // đặt vai trò riêng ở đây chính là tạo bản ghi đè) — ghi nhật ký là "đặt vai trò riêng", không phải "thêm vào dự án".
    if (!membership) {
      await this.assertWorkspaceMember(workspaceId, userId);
      const newIds = await this.validateRoles(workspaceId, roleIds, 'PROJECT');
      const created = await this.createProjectMembership(workspaceId, projectId, userId, newIds);
      await this.audit.record({
        workspaceId,
        actorId,
        action: AUDIT_ACTIONS.PROJECT_MEMBER_ROLES_CHANGED,
        entityType: 'user',
        entityId: userId,
        summary: `Đặt vai trò riêng của ${this.label(created.user)} trong dự án "${project.name}" thành ${this.roleNames(created.roles)}`,
        meta: { projectId, roleIds: newIds },
      });
      return created;
    }
    const ids = await this.validateRoles(workspaceId, roleIds, 'PROJECT');
    await this.prisma.$transaction([
      this.prisma.projectMembershipRole.deleteMany({ where: { membershipId: membership.id } }),
      this.prisma.projectMembershipRole.createMany({
        data: ids.map((roleId) => ({ membershipId: membership.id, roleId })),
      }),
      this.prisma.projectMembership.update({
        where: { id: membership.id },
        data: { roleId: ids[0]! },
      }),
    ]);
    await this.rbac.invalidate(userId, workspaceId);
    const member = await this.getProjectMember(projectId, userId);
    await this.audit.record({
      workspaceId,
      actorId,
      action: AUDIT_ACTIONS.PROJECT_MEMBER_ROLES_CHANGED,
      entityType: 'user',
      entityId: userId,
      summary: `Đổi vai trò của ${this.label(member.user)} trong dự án "${project.name}" thành ${this.roleNames(member.roles)}`,
      meta: { projectId, roleIds: ids },
    });
    return member;
  }

  /** Người được đặt vai trò ở dự án phải là thành viên workspace của dự án. */
  private async assertWorkspaceMember(workspaceId: string, userId: string): Promise<void> {
    const isMember = await this.prisma.workspaceMembership.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
      select: { id: true },
    });
    if (!isMember)
      throw new ForbiddenAppException(
        'Người dùng chưa thuộc không gian làm việc này — hãy thêm họ vào không gian làm việc trước',
      );
  }

  private async createProjectMembership(
    workspaceId: string,
    projectId: string,
    userId: string,
    ids: string[],
  ) {
    // Tạo ghi đè mới: không đặt vai trò dự án cho tài khoản vô hiệu hoá / người dùng hệ thống (như thêm vào workspace).
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { status: true, email: true },
    });
    if (!user) throw new NotFoundAppException('Người dùng');
    this.assertAddable([user]);
    await this.prisma.projectMembership.create({
      data: {
        projectId,
        userId,
        roleId: ids[0]!,
        roles: { create: ids.map((roleId) => ({ roleId })) },
      },
    });
    await this.rbac.invalidate(userId, workspaceId);
    return this.getProjectMember(projectId, userId);
  }

  /** Thêm NHIỀU người vào dự án cùng bộ vai trò; chỉ nhận người ĐÃ thuộc workspace, bỏ qua người đã ở dự án. */
  async addProjectMany(
    workspaceId: string,
    projectId: string,
    userIds: string[],
    roleIds: string[],
    actorId?: string,
  ) {
    const project = await this.requireProject(workspaceId, projectId);
    const ids = await this.validateRoles(workspaceId, roleIds, 'PROJECT');
    const unique = [...new Set(userIds)];
    const wsMembers = await this.prisma.workspaceMembership.findMany({
      where: { workspaceId, userId: { in: unique } },
      select: { userId: true },
    });
    const wsSet = new Set(wsMembers.map((m) => m.userId));
    const valid = unique.filter((u) => wsSet.has(u));
    const already = await this.prisma.projectMembership.findMany({
      where: { projectId, userId: { in: valid } },
      select: { userId: true },
    });
    const alreadySet = new Set(already.map((a) => a.userId));
    const toAdd = valid.filter((u) => !alreadySet.has(u));
    if (toAdd.length) {
      const users = await this.prisma.user.findMany({
        where: { id: { in: toAdd } },
        select: { status: true, email: true },
      });
      this.assertAddable(users);
      await this.prisma.$transaction(async (tx) => {
        await tx.projectMembership.createMany({
          data: toAdd.map((userId) => ({ projectId, userId, roleId: ids[0]! })),
          skipDuplicates: true,
        });
        const fresh = await tx.projectMembership.findMany({
          where: { projectId, userId: { in: toAdd }, roles: { none: {} } },
          select: { id: true },
        });
        await tx.projectMembershipRole.createMany({
          data: fresh.flatMap((m) => ids.map((roleId) => ({ membershipId: m.id, roleId }))),
          skipDuplicates: true,
        });
      });
      await this.rbac.invalidateWorkspace(workspaceId);
      await this.audit.record({
        workspaceId,
        actorId,
        action: AUDIT_ACTIONS.PROJECT_MEMBER_ADDED,
        entityType: 'user',
        summary: `Thêm ${toAdd.length} người vào dự án "${project.name}"`,
        meta: { projectId, userIds: toAdd, roleIds: ids },
      });
    }
    return { added: toAdd.length, skipped: unique.length - toAdd.length };
  }

  // ───────────────────────── helpers ─────────────────────────

  /** "Tên (email)" để dựng câu mô tả nhật ký. */
  private label(user: { displayName: string; email: string }): string {
    return `${user.displayName} (${user.email})`;
  }

  /** Nhãn tiếng Việt hiển thị (vai trò hệ thống) — câu `summary` lưu vĩnh viễn nên phải đúng ngôn ngữ ngay lúc ghi. */
  private roleNames(roles: { name: string }[]): string {
    return roles.map((r) => roleLabel(r.name)).join(', ') || '—';
  }

  private async userLabel(userId: string): Promise<string> {
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { displayName: true, email: true },
    });
    return u ? this.label(u) : userId;
  }

  private async getWorkspaceMember(workspaceId: string, userId: string) {
    const m = await this.prisma.workspaceMembership.findUniqueOrThrow({
      where: { workspaceId_userId: { workspaceId, userId } },
      select: {
        id: true,
        joinedAt: true,
        roleId: true,
        role: { select: { id: true, name: true, color: true } },
        user: { select: USER_DTO_SELECT },
        roles: { select: { role: { select: { id: true, name: true, color: true } } } },
      },
    });
    return this.toMemberDto(m, m.role);
  }

  private async getProjectMember(projectId: string, userId: string) {
    const m = await this.prisma.projectMembership.findUniqueOrThrow({
      where: { projectId_userId: { projectId, userId } },
      select: {
        id: true,
        roleId: true,
        role: { select: { id: true, name: true, color: true } },
        user: { select: USER_DTO_SELECT },
        roles: { select: { role: { select: { id: true, name: true, color: true } } } },
      },
    });
    return this.toMemberDto(m, m.role);
  }

  /** Mỗi role phải tồn tại (system hoặc của workspace) và đúng scope của cấp đang gán. */
  private async validateRoles(
    workspaceId: string,
    roleIds: string[],
    scope: RoleScope,
  ): Promise<string[]> {
    const unique = [...new Set(roleIds)];
    const found = await this.prisma.role.findMany({
      where: { id: { in: unique }, scope, OR: [{ workspaceId }, { workspaceId: null }] },
      select: { id: true },
    });
    if (found.length !== unique.length) {
      throw new ForbiddenAppException(
        `Một số vai trò không hợp lệ cho cấp ${scope === 'PROJECT' ? 'dự án' : 'không gian làm việc'}`,
      );
    }
    // Giữ thứ tự gốc (roleIds[0] = vai trò chính).
    const set = new Set(found.map((r) => r.id));
    return unique.filter((id) => set.has(id));
  }

  /**
   * `primary` = vai trò chính (cột roleId): khi bảng nối rỗng (membership tạo bởi đường quên ghi bảng nối,
   * hoặc race giữa tạo và `roles.create`) thì rơi về nó thay vì trả `roles: []` ("Chưa có vai trò").
   */
  private toMemberDto(
    m: {
      id: string;
      joinedAt?: Date | null;
      user: UserDtoSource;
      roles: RoleRefRow[];
    },
    primary?: { id: string; name: string; color: string | null } | null,
  ) {
    return {
      membershipId: m.id,
      user: toUserDto(m.user),
      roles: m.roles.length
        ? m.roles.map((r) => ({ id: r.role.id, name: r.role.name, color: r.role.color }))
        : primary
          ? [{ id: primary.id, name: primary.name, color: primary.color }]
          : [],
      joinedAt: m.joinedAt ? m.joinedAt.toISOString() : null,
    };
  }
}
