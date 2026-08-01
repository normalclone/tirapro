import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@tirapro/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { ForbiddenAppException } from '../../common/exceptions/app.exception';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../../common/types/request';
import { MembersService } from './members.service';
import { setRolesSchema, addProjectMemberSchema, addMembersBulkSchema, type SetRolesInput, type AddProjectMemberInput, type AddMembersBulkInput } from './members.schemas';

@ApiTags('members')
@Controller('members')
export class WorkspaceMembersController {
  constructor(private readonly members: MembersService) {}

  private ws(user: AuthUser): string {
    if (!user.workspaceId) throw new ForbiddenAppException('Bạn chưa chọn không gian làm việc — hãy chọn một không gian rồi thử lại');
    return user.workspaceId;
  }

  /** Thành viên workspace + vai trò (cho trang Thành viên). */
  @Get()
  async list(@CurrentUser() user: AuthUser) {
    return this.members.listWorkspace(this.ws(user));
  }

  /** Thêm 1 user CÓ SẴN (từ pool hệ thống) vào workspace + gán vai trò. */
  @Post()
  @Permissions(PERMISSIONS.MEMBER_MANAGE)
  async add(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(addProjectMemberSchema)) dto: AddProjectMemberInput,
  ) {
    return this.members.addWorkspace(this.ws(user), dto.userId, dto.roleIds);
  }

  /** Thêm NHIỀU người vào workspace một lúc. */
  @Post('bulk')
  @Permissions(PERMISSIONS.MEMBER_MANAGE)
  async addBulk(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(addMembersBulkSchema)) dto: AddMembersBulkInput,
  ) {
    return this.members.addWorkspaceMany(this.ws(user), dto.userIds, dto.roleIds);
  }

  @Put(':userId/roles')
  @Permissions(PERMISSIONS.MEMBER_MANAGE)
  async setRoles(
    @CurrentUser() user: AuthUser,
    @Param('userId') userId: string,
    @Body(new ZodValidationPipe(setRolesSchema)) dto: SetRolesInput,
  ) {
    return this.members.setWorkspaceRoles(this.ws(user), userId, dto.roleIds);
  }

  @Delete(':userId')
  @Permissions(PERMISSIONS.MEMBER_MANAGE)
  async remove(@CurrentUser() user: AuthUser, @Param('userId') userId: string) {
    return this.members.removeWorkspace(this.ws(user), userId, user.id);
  }
}

@ApiTags('members')
@Controller('projects/:projectId/members')
export class ProjectMembersController {
  constructor(private readonly members: MembersService) {}

  private ws(user: AuthUser): string {
    if (!user.workspaceId) throw new ForbiddenAppException('Bạn chưa chọn không gian làm việc — hãy chọn một không gian rồi thử lại');
    return user.workspaceId;
  }

  /** Thành viên dự án + vai trò. Dự án phải thuộc workspace người gọi (chống chéo tenant). */
  @Get()
  @Permissions(PERMISSIONS.PROJECT_VIEW)
  async list(@CurrentUser() user: AuthUser, @Param('projectId') projectId: string) {
    return this.members.listProject(this.ws(user), projectId);
  }

  @Post()
  @Permissions(PERMISSIONS.PROJECT_ADMIN)
  async add(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @Body(new ZodValidationPipe(addProjectMemberSchema)) dto: AddProjectMemberInput,
  ) {
    return this.members.addProject(this.ws(user), projectId, dto.userId, dto.roleIds);
  }

  /** Thêm NHIỀU người vào dự án một lúc. */
  @Post('bulk')
  @Permissions(PERMISSIONS.PROJECT_ADMIN)
  async addBulk(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @Body(new ZodValidationPipe(addMembersBulkSchema)) dto: AddMembersBulkInput,
  ) {
    return this.members.addProjectMany(this.ws(user), projectId, dto.userIds, dto.roleIds);
  }

  @Put(':userId/roles')
  @Permissions(PERMISSIONS.PROJECT_ADMIN)
  async setRoles(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @Param('userId') userId: string,
    @Body(new ZodValidationPipe(setRolesSchema)) dto: SetRolesInput,
  ) {
    return this.members.setProjectRoles(this.ws(user), projectId, userId, dto.roleIds);
  }

  /**
   * Xoá vai trò RIÊNG (ghi đè) của người này trong dự án → quay về vai trò mặc định
   * của workspace. Không "gỡ khỏi dự án" nữa vì mọi dự án dùng chung thành viên workspace.
   */
  @Delete(':userId')
  @Permissions(PERMISSIONS.PROJECT_ADMIN)
  async clearOverride(@CurrentUser() user: AuthUser, @Param('projectId') projectId: string, @Param('userId') userId: string) {
    return this.members.clearProjectOverride(this.ws(user), projectId, userId);
  }
}
