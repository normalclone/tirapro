import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
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
  type SetRolesInput,
  type AddProjectMemberInput,
  type AddMembersBulkInput,
} from './members.schemas';

@ApiTags('members')
@Controller('members')
export class WorkspaceMembersController {
  constructor(private readonly members: MembersService) {}

  /** Thành viên workspace + vai trò (cho trang Thành viên). */
  @Permissions(PERMISSIONS.WORKSPACE_VIEW)
  @Get()
  async list(@WorkspaceId() workspaceId: string) {
    return this.members.listWorkspace(workspaceId);
  }

  /** Thêm 1 user CÓ SẴN (từ pool hệ thống) vào workspace + gán vai trò. */
  @Post()
  @Permissions(PERMISSIONS.MEMBER_MANAGE)
  async add(
    @WorkspaceId() workspaceId: string,
    @Body(new ZodValidationPipe(addProjectMemberSchema)) dto: AddProjectMemberInput,
  ) {
    return this.members.addWorkspace(workspaceId, dto.userId, dto.roleIds);
  }

  /** Thêm NHIỀU người vào workspace một lúc. */
  @Post('bulk')
  @Permissions(PERMISSIONS.MEMBER_MANAGE)
  async addBulk(
    @WorkspaceId() workspaceId: string,
    @Body(new ZodValidationPipe(addMembersBulkSchema)) dto: AddMembersBulkInput,
  ) {
    return this.members.addWorkspaceMany(workspaceId, dto.userIds, dto.roleIds);
  }

  @Put(':userId/roles')
  @Permissions(PERMISSIONS.MEMBER_MANAGE)
  async setRoles(
    @WorkspaceId() workspaceId: string,
    @Param('userId') userId: string,
    @Body(new ZodValidationPipe(setRolesSchema)) dto: SetRolesInput,
  ) {
    return this.members.setWorkspaceRoles(workspaceId, userId, dto.roleIds);
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
  async list(@WorkspaceId() workspaceId: string, @Param('projectId') projectId: string) {
    return this.members.listProject(workspaceId, projectId);
  }

  @Post()
  @Permissions(PERMISSIONS.PROJECT_ADMIN)
  async add(
    @WorkspaceId() workspaceId: string,
    @Param('projectId') projectId: string,
    @Body(new ZodValidationPipe(addProjectMemberSchema)) dto: AddProjectMemberInput,
  ) {
    return this.members.addProject(workspaceId, projectId, dto.userId, dto.roleIds);
  }

  /** Thêm NHIỀU người vào dự án một lúc. */
  @Post('bulk')
  @Permissions(PERMISSIONS.PROJECT_ADMIN)
  async addBulk(
    @WorkspaceId() workspaceId: string,
    @Param('projectId') projectId: string,
    @Body(new ZodValidationPipe(addMembersBulkSchema)) dto: AddMembersBulkInput,
  ) {
    return this.members.addProjectMany(workspaceId, projectId, dto.userIds, dto.roleIds);
  }

  @Put(':userId/roles')
  @Permissions(PERMISSIONS.PROJECT_ADMIN)
  async setRoles(
    @WorkspaceId() workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('userId') userId: string,
    @Body(new ZodValidationPipe(setRolesSchema)) dto: SetRolesInput,
  ) {
    return this.members.setProjectRoles(workspaceId, projectId, userId, dto.roleIds);
  }

  /**
   * Xoá vai trò RIÊNG (ghi đè) của người này trong dự án → quay về vai trò mặc định
   * của workspace. Không "gỡ khỏi dự án" nữa vì mọi dự án dùng chung thành viên workspace.
   */
  @Delete(':userId')
  @Permissions(PERMISSIONS.PROJECT_ADMIN)
  async clearOverride(
    @WorkspaceId() workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('userId') userId: string,
  ) {
    return this.members.clearProjectOverride(workspaceId, projectId, userId);
  }
}
