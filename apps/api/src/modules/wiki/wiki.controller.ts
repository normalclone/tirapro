import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@tirapro/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { WorkspaceId } from '../../common/decorators/workspace-id.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { ProjectRef } from '../../common/decorators/project-ref.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../../common/types/request';
import { WikiService } from './wiki.service';
import {
  createWikiPageSchema,
  moveWikiPageSchema,
  restoreWikiVersionSchema,
  updateWikiPageSchema,
  type CreateWikiPageInput,
  type MoveWikiPageInput,
  type RestoreWikiVersionInput,
  type UpdateWikiPageInput,
} from './wiki.schemas';

@ApiTags('wiki')
@Controller('wiki')
export class WikiController {
  constructor(private readonly wiki: WikiService) {}

  /**
   * Cây trang tài liệu. `projectId` bỏ trống = mọi trang; `none` = tài liệu chung workspace.
   * Có `q` thì trả danh sách phẳng các trang khớp tiêu đề/nội dung.
   */
  @ProjectRef('query', 'projectId')
  @Get()
  @Permissions(PERMISSIONS.WORKSPACE_VIEW)
  async list(
    @WorkspaceId() workspaceId: string,
    @Query('projectId') projectId?: string,
    @Query('q') q?: string,
  ) {
    const ws = workspaceId;
    if (q && q.trim()) return this.wiki.search(ws, q, projectId);
    return this.wiki.tree(ws, projectId);
  }

  /**
   * Người có thể cấp quyền viết / xoá trang ở phạm vi `projectId` (bỏ trống/`none` = cấp workspace).
   * Đặt TRƯỚC `:id` để không bị nuốt thành id trang.
   */
  @ProjectRef('query', 'projectId')
  @Get('admins')
  @Permissions(PERMISSIONS.WORKSPACE_VIEW)
  async admins(@WorkspaceId() workspaceId: string, @Query('projectId') projectId?: string) {
    return this.wiki.admins(workspaceId, projectId);
  }

  /** Trang wiki nhắc tới công việc `issueId` (khối "Tài liệu liên quan"). Đặt TRƯỚC `:id`. */
  @ProjectRef('issue', 'issueId')
  @Get('by-issue/:issueId')
  @Permissions(PERMISSIONS.PROJECT_VIEW)
  async byIssue(
    @WorkspaceId() workspaceId: string,
    @CurrentUser() user: AuthUser,
    @Param('issueId') issueId: string,
  ) {
    return this.wiki.byIssue(workspaceId, issueId, user);
  }

  /**
   * Trang đã xoá (thùng rác) của phạm vi `projectId` (bỏ trống = cấp workspace, `none` = tài liệu chung).
   * Chỉ Quản trị dự án / workspace. Đặt TRƯỚC `:id`.
   */
  @ProjectRef('query', 'projectId')
  @Get('trash')
  @Permissions(PERMISSIONS.PROJECT_ADMIN)
  async trash(@WorkspaceId() workspaceId: string, @Query('projectId') projectId?: string) {
    return this.wiki.trash(workspaceId, projectId);
  }

  @Get(':id')
  @Permissions(PERMISSIONS.WORKSPACE_VIEW)
  async get(
    @WorkspaceId() workspaceId: string,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    return this.wiki.get(workspaceId, id, user);
  }

  /** Lịch sử phiên bản của trang (mới nhất trước, tối đa 200, không kèm nội dung). Quyền xem như `GET :id`. */
  @Get(':id/versions')
  @Permissions(PERMISSIONS.WORKSPACE_VIEW)
  async versions(@WorkspaceId() workspaceId: string, @Param('id') id: string) {
    return this.wiki.listVersions(workspaceId, id);
  }

  /** Nội dung một phiên bản (404 nếu không có). */
  @Get(':id/versions/:version')
  @Permissions(PERMISSIONS.WORKSPACE_VIEW)
  async version(
    @WorkspaceId() workspaceId: string,
    @Param('id') id: string,
    @Param('version', ParseIntPipe) version: number,
  ) {
    return this.wiki.getVersion(workspaceId, id, version);
  }

  /** Khôi phục một phiên bản cũ (tạo phiên bản mới, không xoá lịch sử); 409 nếu trang vừa được sửa. */
  @ProjectRef('wikiPage', 'id')
  @Post(':id/versions/:version/restore')
  @HttpCode(200)
  @Permissions(PERMISSIONS.WIKI_MANAGE)
  async restoreVersion(
    @WorkspaceId() workspaceId: string,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('version', ParseIntPipe) version: number,
    @Body(new ZodValidationPipe(restoreWikiVersionSchema)) dto: RestoreWikiVersionInput,
  ) {
    return this.wiki.restoreVersion(workspaceId, id, version, dto, user);
  }

  @ProjectRef('body', 'projectId')
  @Post()
  @Permissions(PERMISSIONS.WIKI_MANAGE)
  async create(
    @WorkspaceId() workspaceId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createWikiPageSchema)) dto: CreateWikiPageInput,
  ) {
    return this.wiki.create(workspaceId, dto, user);
  }

  @ProjectRef('wikiPage', 'id')
  @Put(':id')
  @Permissions(PERMISSIONS.WIKI_MANAGE)
  async update(
    @WorkspaceId() workspaceId: string,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateWikiPageSchema)) dto: UpdateWikiPageInput,
  ) {
    return this.wiki.update(workspaceId, id, dto, user);
  }

  /** Đổi trang cha và/hoặc thứ tự. Trả về cây đã cập nhật của phạm vi tương ứng. */
  @ProjectRef('wikiPage', 'id')
  @Put(':id/move')
  @Permissions(PERMISSIONS.WIKI_MANAGE)
  async move(
    @WorkspaceId() workspaceId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(moveWikiPageSchema)) dto: MoveWikiPageInput,
  ) {
    return this.wiki.move(workspaceId, id, dto);
  }

  /** Xoá mềm trang: chỉ Quản trị dự án (hoặc Workspace Admin với trang chung / mọi dự án). */
  @ProjectRef('wikiPage', 'id')
  @Delete(':id')
  @Permissions(PERMISSIONS.PROJECT_ADMIN)
  async remove(
    @WorkspaceId() workspaceId: string,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    return this.wiki.remove(workspaceId, id, user.id);
  }

  /** Khôi phục trang đã xoá (kèm lịch sử): cùng quyền với xoá, theo dự án của trang. */
  @ProjectRef('wikiPage', 'id')
  @Post(':id/undelete')
  @HttpCode(200)
  @Permissions(PERMISSIONS.PROJECT_ADMIN)
  async undelete(
    @WorkspaceId() workspaceId: string,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    return this.wiki.undelete(workspaceId, id, user);
  }
}
