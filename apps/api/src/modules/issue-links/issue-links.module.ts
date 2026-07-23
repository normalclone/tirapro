import { Module } from '@nestjs/common';
import { IssueLinksController } from './issue-links.controller';
import { IssueLinksService } from './issue-links.service';

@Module({
  controllers: [IssueLinksController],
  providers: [IssueLinksService],
  exports: [IssueLinksService],
})
export class IssueLinksModule {}
