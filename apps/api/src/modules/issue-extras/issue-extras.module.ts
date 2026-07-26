import { Module } from '@nestjs/common';
import { IssueExtrasController } from './issue-extras.controller';
import { IssueExtrasService } from './issue-extras.service';

/** Người tham gia + checklist của issue (tách khỏi IssuesModule cho gọn). */
@Module({
  controllers: [IssueExtrasController],
  providers: [IssueExtrasService],
  exports: [IssueExtrasService],
})
export class IssueExtrasModule {}
