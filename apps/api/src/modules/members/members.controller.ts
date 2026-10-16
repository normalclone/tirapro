import { Body, Controller, Delete, Get, Header, Param, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@tirapro/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { WorkspaceId } from '../../common/decorators/workspace-id.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../../common/types/request';
import { MembersService } from './members.service';
import {
  setRolesSchema,
  addProjectMemberSchema,
  addMembersBulkSchema,
  createMemberAccountSchema,
  type SetRolesInput,
  type AddProjectMemberInput,
  type AddMembersBulkInput,
  type CreateMemberAccountInput,
} from './members.schemas';

@ApiTags('members')
@Controller('members')
export class WorkspaceMembersController {
  constructor(private readonly members: MembersService) {}

  /** Thành viên workspace + vai trò (cho trang Thành viên). */
  @Permissions(PERMISSIONS.WORKSPACE_VIEW)
  @Get()
  async list(@WorkspaceId() workspaceId: string, @CurrentUser() user: AuthUser) {
    // `user` đi vào service: isSystemAdmin/lastSeenAt của từng người chỉ trả khi người xem có member:manage.
    return this.members.listWorkspace(workspaceId, user);
  }

  /** Thêm 1 user CÓ SẴN (từ pool hệ thống) vào workspace + gán vai trò. */
  @Post()
  @Permissions(PERMISSIONS.MEMBER_MANAGE)
  async add(
    @CurrentUser() user: AuthUser,
    @WorkspaceId() workspaceId: string,
    @Body(new ZodValidationPipe(addProjectMemberSchema)) dto: AddProjectMemberInput,
  ) {
    return this.members.addWorkspace(workspaceId, dto.userId, dto.roleIds, user.id);
  }

  /**
   * Tạo TÀI KHOẢN MỚI và thêm vào workspace trong một lần (quản trị workspace). Mật khẩu tạm chỉ trả MỘT lần,
   * và chỉ khi không truyền `password`.
   */
  @Post('accounts')
  @Header('Cache-Control', 'no-store') // phản hồi mang mật khẩu tạm — không để trình duyệt/proxy lưu
  @Permissions(PERMISSIONS.MEMBER_MANAGE)
  async createAccount(
    @CurrentUser() user: AuthUser,
    @WorkspaceId() workspaceId: string,
    @Body(new ZodValidationPipe(createMemberAccountSchema)) dto: CreateMemberAccountInput,
  ) {
    return this.members.createAccount(workspaceId, user.id, dto);
  }

  /** Thêm NHIỀU người vào workspace một lúc. */
  @Post('bulk')
  @Permissions(PERMISSIONS.MEMBER_MANAGE)
  async addBulk(
    @CurrentUser() user: AuthUser,
    @WorkspaceId() workspaceId: string,
    @Body(new ZodValidationPipe(addMembersBulkSchema)) dto: AddMembersBulkInput,
  ) {
    return this.members.addWorkspaceMany(workspaceId, dto.userIds, dto.roleIds, user.id);
  }

  @Put(':userId/roles')
  @Permissions(PERMISSIONS.MEMBER_MANAGE)
  async setRoles(
    @CurrentUser() user: AuthUser,
    @WorkspaceId() workspaceId: string,
    @Param('userId') userId: string,
    @Body(new ZodValidationPipe(setRolesSchema)) dto: SetRolesInput,
  ) {
    return this.members.setWorkspaceRoles(workspaceId, userId, dto.roleIds, user.id);
  }

  @Delete(':userId')
  @Permissions(PERMISSIONS.MEMBER_MANAGE)
  async remove(
    @CurrentUser() user: AuthUser,
    @WorkspaceId() workspaceId: string,
    @Param('userId') userId: string,
  ) {
    return this.members.removeWorkspace(workspaceId, userId, user.id);
  }
}

@ApiTags('members')
@Controller('projects/:projectId/members')
export class ProjectMembersController {
  constructor(private readonly members: MembersService) {}

  /** Thành viên dự án + vai trò. Dự án phải thuộc workspace người gọi (chống chéo tenant). */
  @Get()
  @Permissions(PERMISSIONS.PROJECT_VIEW)
  async list(
    @WorkspaceId() workspaceId: string,
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
  ) {
    return this.members.listProject(workspaceId, projectId, user);
  }

  @Post()
  @Permissions(PERMISSIONS.PROJECT_ADMIN)
  async add(
    @CurrentUser() user: AuthUser,
    @WorkspaceId() workspaceId: string,
    @Param('projectId') projectId: string,
    @Body(new ZodValidationPipe(addProjectMemberSchema)) dto: AddProjectMemberInput,
  ) {
    return this.members.addProject(workspaceId, projectId, dto.userId, dto.roleIds, user.id);
  }

  /** Thêm NHIỀU người vào dự án một lúc. */
  @Post('bulk')
  @Permissions(PERMISSIONS.PROJECT_ADMIN)
  async addBulk(
    @CurrentUser() user: AuthUser,
    @WorkspaceId() workspaceId: string,
    @Param('projectId') projectId: string,
    @Body(new ZodValidationPipe(addMembersBulkSchema)) dto: AddMembersBulkInput,
  ) {
    return this.members.addProjectMany(workspaceId, projectId, dto.userIds, dto.roleIds, user.id);
  }

  @Put(':userId/roles')
  @Permissions(PERMISSIONS.PROJECT_ADMIN)
  async setRoles(
    @CurrentUser() user: AuthUser,
    @WorkspaceId() workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('userId') userId: string,
    @Body(new ZodValidationPipe(setRolesSchema)) dto: SetRolesInput,
  ) {
    return this.members.setProjectRoles(workspaceId, projectId, userId, dto.roleIds, user.id);
  }

  /**
   * Xoá vai trò RIÊNG (ghi đè) của người này trong dự án → quay về vai trò mặc định
   * của workspace. Không "gỡ khỏi dự án" nữa vì mọi dự án dùng chung thành viên workspace.
   */
  @Delete(':userId')
  @Permissions(PERMISSIONS.PROJECT_ADMIN)
  async clearOverride(
    @CurrentUser() user: AuthUser,
    @WorkspaceId() workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('userId') userId: string,
  ) {
    return this.members.clearProjectOverride(workspaceId, projectId, userId, user.id);
  }
}
