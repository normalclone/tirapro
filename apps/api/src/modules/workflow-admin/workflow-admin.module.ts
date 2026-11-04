import { Module } from '@nestjs/common';
import { WorkflowAdminController } from './workflow-admin.controller';
import { WorkflowAdminService } from './workflow-admin.service';
import { WorkflowSchemeController } from './workflow-scheme.controller';
import { WorkflowSchemeService } from './workflow-scheme.service';
import { WorkflowResolver } from './workflow-resolver.service';

@Module({
  controllers: [WorkflowAdminController, WorkflowSchemeController],
  providers: [WorkflowAdminService, WorkflowSchemeService, WorkflowResolver],
  exports: [WorkflowAdminService, WorkflowSchemeService, WorkflowResolver],
})
export class WorkflowAdminModule {}
