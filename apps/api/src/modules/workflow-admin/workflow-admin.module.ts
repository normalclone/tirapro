import { Module } from '@nestjs/common';
import { WorkflowAdminController } from './workflow-admin.controller';
import { WorkflowAdminService } from './workflow-admin.service';

@Module({
  controllers: [WorkflowAdminController],
  providers: [WorkflowAdminService],
  exports: [WorkflowAdminService],
})
export class WorkflowAdminModule {}
