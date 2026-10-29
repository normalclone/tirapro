import { Global, Module } from '@nestjs/common';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';

/** @Global để roles/members/integrations/admin inject `AuditService` không cần import module. */
@Global()
@Module({
  controllers: [AuditController],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
