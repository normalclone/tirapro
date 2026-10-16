import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
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
  updateWikiPageSchema,
  type CreateWikiPageInput,
  type MoveWikiPageInput,
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

  @Get(':id')
  @Permissions(PERMISSIONS.WORKSPACE_VIEW)
  async get(@WorkspaceId() workspaceId: string, @Param('id') id: string) {
    return this.wiki.get(workspaceId, id);
  }

  @ProjectRef('body', 'projectId')
  @Post()
  @Permissions(PERMISSIONS.WIKI_MANAGE)
  async create(
    @WorkspaceId() workspaceId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createWikiPageSchema)) dto: CreateWikiPageInput,
  ) {
    return this.wiki.create(workspaceId, dto, user.id);
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
    return this.wiki.update(workspaceId, id, dto, user.id);
  }

  /** Đổi trang cha và/hoặc thứ tự. Trả về cây đã cập nhật của phạm vi tương ứng. */
  @ProjectRef('wikiPage', 'id')
  @Put(':id/move')
  @Permissions(PERMISSIONS.WIKI_MANAGE)
  async move(
    @WorkspaceId() workspaceId: string,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(moveWikiPageSchema)) dto: MoveWikiPageInput,
  ) {
    return this.wiki.move(workspaceId, id, dto, user.id);
  }

  /** Xoá trang: chỉ Quản trị dự án (hoặc Workspace Admin với trang chung / mọi dự án). */
  @ProjectRef('wikiPage', 'id')
  @Delete(':id')
  @Permissions(PERMISSIONS.PROJECT_ADMIN)
  async remove(@WorkspaceId() workspaceId: string, @Param('id') id: string) {
    return this.wiki.remove(workspaceId, id);
  }
}
