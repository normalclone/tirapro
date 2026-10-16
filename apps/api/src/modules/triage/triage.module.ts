import { Module } from '@nestjs/common';
import { CommentsModule } from '../comments/comments.module';
import { IssuesModule } from '../issues/issues.module';
import { TriageController } from './triage.controller';
import { TriageService } from './triage.service';

@Module({
  imports: [IssuesModule, CommentsModule],
  controllers: [TriageController],
  providers: [TriageService],
  exports: [TriageService],
})
export class TriageModule {}
