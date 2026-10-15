import { Module } from '@nestjs/common';
import { IssuesController } from './issues.controller';
import { IssuesService } from './issues.service';
import { TrashController } from './trash.controller';
import { TrashService } from './trash.service';
import { RankService } from './rank.service';
import { WipService } from './wip.service';

@Module({
  controllers: [IssuesController, TrashController],
  providers: [IssuesService, RankService, WipService, TrashService],
  exports: [IssuesService],
})
export class IssuesModule {}
