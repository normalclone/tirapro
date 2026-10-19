import { Module } from '@nestjs/common';
import { CommentsModule } from '../comments/comments.module';
import { IssuesModule } from '../issues/issues.module';
import { SearchModule } from '../search/search.module';
import { IntakeController } from './intake.controller';
import { IntakeService } from './intake.service';

@Module({
  imports: [IssuesModule, CommentsModule, SearchModule],
  controllers: [IntakeController],
  providers: [IntakeService],
  exports: [IntakeService],
})
export class IntakeModule {}
