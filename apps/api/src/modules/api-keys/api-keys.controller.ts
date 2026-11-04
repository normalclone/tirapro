import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { OrganizationId } from '../../common/decorators/organization-id.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../../common/types/request';
import { ApiKeyService } from './api-key.service';
import { createApiKeySchema, type CreateApiKeyInput } from './api-keys.schemas';

/** Quản lý API key của tổ chức hiện tại — yêu cầu quyền organization:admin. */
@ApiTags('api-keys')
@Controller('api-keys')
@Permissions('organization:admin')
export class ApiKeysController {
  constructor(private readonly keys: ApiKeyService) {}

  @Get()
  list(@OrganizationId() organizationId: string) {
    return this.keys.list(organizationId);
  }

  @Post()
  create(
    @OrganizationId() organizationId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createApiKeySchema)) dto: CreateApiKeyInput,
  ) {
    return this.keys.create(organizationId, user.id, dto);
  }

  @Delete(':id')
  revoke(@OrganizationId() organizationId: string, @Param('id') id: string) {
    return this.keys.revoke(id, organizationId);
  }
}
