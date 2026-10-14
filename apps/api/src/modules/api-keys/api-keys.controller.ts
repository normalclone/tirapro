import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { WorkspaceId } from '../../common/decorators/workspace-id.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../../common/types/request';
import { ApiKeyService } from './api-key.service';
import { createApiKeySchema, type CreateApiKeyInput } from './api-keys.schemas';

/** Quản lý API key của workspace hiện tại — yêu cầu quyền workspace:admin. */
@ApiTags('api-keys')
@Controller('api-keys')
@Permissions('workspace:admin')
export class ApiKeysController {
  constructor(private readonly keys: ApiKeyService) {}

  @Get()
  list(@WorkspaceId() workspaceId: string) {
    return this.keys.list(workspaceId);
  }

  @Post()
  create(
    @WorkspaceId() workspaceId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createApiKeySchema)) dto: CreateApiKeyInput,
  ) {
    return this.keys.create(workspaceId, user.id, dto);
  }

  @Delete(':id')
  revoke(@WorkspaceId() workspaceId: string, @Param('id') id: string) {
    return this.keys.revoke(id, workspaceId);
  }
}
