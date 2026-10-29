import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@tirapro/types';
import { WorkspaceId } from '../../common/decorators/workspace-id.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AuditService } from './audit.service';
import { auditListSchema, type AuditListInput } from './audit.schemas';

@ApiTags('audit')
@Controller('audit')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  /** Nhật ký quản trị của workspace — chỉ quản trị workspace. */
  @Get()
  @Permissions(PERMISSIONS.WORKSPACE_ADMIN)
  async list(
    @WorkspaceId() workspaceId: string,
    @Query(new ZodValidationPipe(auditListSchema)) query: AuditListInput,
  ) {
    return this.audit.list(workspaceId, query);
  }
}
