import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@tirapro/types';
import { OrganizationId } from '../../common/decorators/organization-id.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AuditService } from './audit.service';
import { auditListSchema, type AuditListInput } from './audit.schemas';

@ApiTags('audit')
@Controller('audit')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  /** Nhật ký quản trị của tổ chức — chỉ quản trị organization. */
  @Get()
  @Permissions(PERMISSIONS.ORGANIZATION_ADMIN)
  async list(
    @OrganizationId() organizationId: string,
    @Query(new ZodValidationPipe(auditListSchema)) query: AuditListInput,
  ) {
    return this.audit.list(organizationId, query);
  }
}
