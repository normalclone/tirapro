import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@tirapro/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { ForbiddenAppException } from '../../common/exceptions/app.exception';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../../common/types/request';
import { WikiService } from './wiki.service';
import {
  createWikiPageSchema, moveWikiPageSchema, updateWikiPageSchema,
  type CreateWikiPageInput, type MoveWikiPageInput, type UpdateWikiPageInput,
} from './wiki.schemas';

@ApiTags('wiki')
@Controller('wiki')
export class WikiController {
  constructor(private readonly wiki: WikiService) {}

  private ws(user: AuthUser): string {
    if (!user.workspaceId) throw new ForbiddenAppException('Bạn chưa chọn không gian làm việc — hãy chọn một không gian rồi thử lại');
    return user.workspaceId;
  }

  /**
   * Cây trang tài liệu. `projectId` bỏ trống = mọi trang; `none` = tài liệu chung workspace.
   * Có `q` thì trả danh sách phẳng các trang khớp tiêu đề/nội dung.
   */
  @Get()
  @Permissions(PERMISSIONS.WORKSPACE_VIEW)
  async list(
    @CurrentUser() user: AuthUser,
    @Query('projectId') projectId?: string,
    @Query('q') q?: string,
  ) {
    const ws = this.ws(user);
    if (q && q.trim()) return this.wiki.search(ws, q, projectId);
    return this.wiki.tree(ws, projectId);
  }

  @Get(':id')
  @Permissions(PERMISSIONS.WORKSPACE_VIEW)
  async get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.wiki.get(this.ws(user), id);
  }

  @Post()
  @Permissions(PERMISSIONS.WIKI_MANAGE)
  async create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createWikiPageSchema)) dto: CreateWikiPageInput,
  ) {
    return this.wiki.create(this.ws(user), dto, user.id);
  }

  @Put(':id')
  @Permissions(PERMISSIONS.WIKI_MANAGE)
  async update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateWikiPageSchema)) dto: UpdateWikiPageInput,
  ) {
    return this.wiki.update(this.ws(user), id, dto, user.id);
  }

  /** Đổi trang cha và/hoặc thứ tự. Trả về cây đã cập nhật của phạm vi tương ứng. */
  @Put(':id/move')
  @Permissions(PERMISSIONS.WIKI_MANAGE)
  async move(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(moveWikiPageSchema)) dto: MoveWikiPageInput,
  ) {
    return this.wiki.move(this.ws(user), id, dto, user.id);
  }

  @Delete(':id')
  @Permissions(PERMISSIONS.WIKI_MANAGE)
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.wiki.remove(this.ws(user), id);
  }
}
