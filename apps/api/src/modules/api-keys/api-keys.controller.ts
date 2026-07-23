import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { BusinessRuleException } from '../../common/exceptions/app.exception';
import type { AuthUser } from '../../common/types/request';
import { ApiKeyService } from './api-key.service';
import { createApiKeySchema, type CreateApiKeyInput } from './api-keys.schemas';

/** Quản lý API key của workspace hiện tại — yêu cầu quyền workspace:admin. */
@ApiTags('api-keys')
@Controller('api-keys')
@Permissions('workspace:admin')
export class ApiKeysController {
  constructor(private readonly keys: ApiKeyService) {}

  private wsId(user: AuthUser): string {
    if (!user.workspaceId) throw new BusinessRuleException('Chưa chọn workspace');
    return user.workspaceId;
  }

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.keys.list(this.wsId(user));
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(createApiKeySchema)) dto: CreateApiKeyInput) {
    return this.keys.create(this.wsId(user), user.id, dto);
  }

  @Delete(':id')
  revoke(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.keys.revoke(id, this.wsId(user));
  }
}
