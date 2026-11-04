import { Module } from '@nestjs/common';
import { IssuesModule } from '../issues/issues.module';
import { SearchModule } from '../search/search.module';
import { WorkflowAdminModule } from '../workflow-admin/workflow-admin.module';
import { BoardsController } from './boards.controller';
import { BoardsService } from './boards.service';

@Module({
  imports: [IssuesModule, SearchModule, WorkflowAdminModule],
  controllers: [BoardsController],
  providers: [BoardsService],
  exports: [BoardsService],
})
export class BoardsModule {}
