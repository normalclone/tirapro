import { Module } from '@nestjs/common';
import { IssuesController } from './issues.controller';
import { IssuesService } from './issues.service';
import { TrashController } from './trash.controller';
import { TrashService } from './trash.service';
import { PointsService } from './points.service';
import { RankService } from './rank.service';
import { WipService } from './wip.service';
import { CommentsModule } from '../comments/comments.module';
import { WorkflowAdminModule } from '../workflow-admin/workflow-admin.module';

@Module({
  imports: [CommentsModule, WorkflowAdminModule],
  controllers: [IssuesController, TrashController],
  providers: [IssuesService, RankService, WipService, TrashService, PointsService],
  exports: [IssuesService, PointsService],
})
export class IssuesModule {}
