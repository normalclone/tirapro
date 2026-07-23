import { Module } from '@nestjs/common';
import { IssuesModule } from '../issues/issues.module';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';

@Module({
  imports: [IssuesModule],
  controllers: [SearchController],
  providers: [SearchService],
  exports: [SearchService],
})
export class SearchModule {}
