import { Module } from '@nestjs/common';
import { WorkflowAdminController } from './workflow-admin.controller';
import { WorkflowAdminService } from './workflow-admin.service';
import { WorkflowResolver } from './workflow-resolver.service';

@Module({
  controllers: [WorkflowAdminController],
  providers: [WorkflowAdminService, WorkflowResolver],
  exports: [WorkflowAdminService, WorkflowResolver],
})
export class WorkflowAdminModule {}
