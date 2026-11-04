import { Body, Controller, Delete, Get, Header, Param, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@tirapro/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { OrganizationId } from '../../common/decorators/organization-id.decorator';
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
export class OrganizationMembersController {
  constructor(private readonly members: MembersService) {}

  /** Thành viên tổ chức + vai trò (cho trang Thành viên). */
  @Permissions(PERMISSIONS.ORGANIZATION_VIEW)
  @Get()
  async list(@OrganizationId() organizationId: string, @CurrentUser() user: AuthUser) {
    // `user` đi vào service: isSystemAdmin/lastSeenAt của từng người chỉ trả khi người xem có member:manage.
    return this.members.listOrganization(organizationId, user);
  }

  /** Thêm 1 user CÓ SẴN (từ pool hệ thống) vào tổ chức + gán vai trò. */
  @Post()
  @Permissions(PERMISSIONS.MEMBER_MANAGE)
  async add(
    @CurrentUser() user: AuthUser,
    @OrganizationId() organizationId: string,
    @Body(new ZodValidationPipe(addProjectMemberSchema)) dto: AddProjectMemberInput,
  ) {
    return this.members.addOrganization(organizationId, dto.userId, dto.roleIds, user.id);
  }

  /**
   * Tạo TÀI KHOẢN MỚI và thêm vào tổ chức trong một lần (quản trị tổ chức). Mật khẩu tạm chỉ trả MỘT lần,
   * và chỉ khi không truyền `password`.
   */
  @Post('accounts')
  @Header('Cache-Control', 'no-store') // phản hồi mang mật khẩu tạm — không để trình duyệt/proxy lưu
  @Permissions(PERMISSIONS.MEMBER_MANAGE)
  async createAccount(
    @CurrentUser() user: AuthUser,
    @OrganizationId() organizationId: string,
    @Body(new ZodValidationPipe(createMemberAccountSchema)) dto: CreateMemberAccountInput,
  ) {
    return this.members.createAccount(organizationId, user.id, dto);
  }

  /** Thêm NHIỀU người vào tổ chức một lúc. */
  @Post('bulk')
  @Permissions(PERMISSIONS.MEMBER_MANAGE)
  async addBulk(
    @CurrentUser() user: AuthUser,
    @OrganizationId() organizationId: string,
    @Body(new ZodValidationPipe(addMembersBulkSchema)) dto: AddMembersBulkInput,
  ) {
    return this.members.addOrganizationMany(organizationId, dto.userIds, dto.roleIds, user.id);
  }

  @Put(':userId/roles')
  @Permissions(PERMISSIONS.MEMBER_MANAGE)
  async setRoles(
    @CurrentUser() user: AuthUser,
    @OrganizationId() organizationId: string,
    @Param('userId') userId: string,
    @Body(new ZodValidationPipe(setRolesSchema)) dto: SetRolesInput,
  ) {
    return this.members.setOrganizationRoles(organizationId, userId, dto.roleIds, user.id);
  }

  @Delete(':userId')
  @Permissions(PERMISSIONS.MEMBER_MANAGE)
  async remove(
    @CurrentUser() user: AuthUser,
    @OrganizationId() organizationId: string,
    @Param('userId') userId: string,
  ) {
    return this.members.removeOrganization(organizationId, userId, user.id);
  }
}

@ApiTags('members')
@Controller('projects/:projectId/members')
export class ProjectMembersController {
  constructor(private readonly members: MembersService) {}

  /** Thành viên dự án + vai trò. Dự án phải thuộc tổ chức người gọi (chống chéo tenant). */
  @Get()
  @Permissions(PERMISSIONS.PROJECT_VIEW)
  async list(
    @OrganizationId() organizationId: string,
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
  ) {
    return this.members.listProject(organizationId, projectId, user);
  }

  @Post()
  @Permissions(PERMISSIONS.PROJECT_ADMIN)
  async add(
    @CurrentUser() user: AuthUser,
    @OrganizationId() organizationId: string,
    @Param('projectId') projectId: string,
    @Body(new ZodValidationPipe(addProjectMemberSchema)) dto: AddProjectMemberInput,
  ) {
    return this.members.addProject(organizationId, projectId, dto.userId, dto.roleIds, user.id);
  }

  /** Thêm NHIỀU người vào dự án một lúc. */
  @Post('bulk')
  @Permissions(PERMISSIONS.PROJECT_ADMIN)
  async addBulk(
    @CurrentUser() user: AuthUser,
    @OrganizationId() organizationId: string,
    @Param('projectId') projectId: string,
    @Body(new ZodValidationPipe(addMembersBulkSchema)) dto: AddMembersBulkInput,
  ) {
    return this.members.addProjectMany(
      organizationId,
      projectId,
      dto.userIds,
      dto.roleIds,
      user.id,
    );
  }

  @Put(':userId/roles')
  @Permissions(PERMISSIONS.PROJECT_ADMIN)
  async setRoles(
    @CurrentUser() user: AuthUser,
    @OrganizationId() organizationId: string,
    @Param('projectId') projectId: string,
    @Param('userId') userId: string,
    @Body(new ZodValidationPipe(setRolesSchema)) dto: SetRolesInput,
  ) {
    return this.members.setProjectRoles(organizationId, projectId, userId, dto.roleIds, user.id);
  }

  /**
   * Xoá vai trò RIÊNG (ghi đè) của người này trong dự án → quay về vai trò mặc định
   * của organization. Không "gỡ khỏi dự án" nữa vì mọi dự án dùng chung thành viên organization.
   */
  @Delete(':userId')
  @Permissions(PERMISSIONS.PROJECT_ADMIN)
  async clearOverride(
    @CurrentUser() user: AuthUser,
    @OrganizationId() organizationId: string,
    @Param('projectId') projectId: string,
    @Param('userId') userId: string,
  ) {
    return this.members.clearProjectOverride(organizationId, projectId, userId, user.id);
  }
}
