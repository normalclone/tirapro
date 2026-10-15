import { Module } from '@nestjs/common';
import { IssuesController } from './issues.controller';
import { IssuesService } from './issues.service';
import { RankService } from './rank.service';
import { WipService } from './wip.service';

@Module({
  controllers: [IssuesController],
  providers: [IssuesService, RankService, WipService],
  exports: [IssuesService],
})
export class IssuesModule {}
