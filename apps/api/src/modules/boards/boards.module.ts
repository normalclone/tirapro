import { Module } from '@nestjs/common';
import { IssuesModule } from '../issues/issues.module';
import { SearchModule } from '../search/search.module';
import { BoardsController } from './boards.controller';
import { BoardsService } from './boards.service';

@Module({
  imports: [IssuesModule, SearchModule],
  controllers: [BoardsController],
  providers: [BoardsService],
  exports: [BoardsService],
})
export class BoardsModule {}
