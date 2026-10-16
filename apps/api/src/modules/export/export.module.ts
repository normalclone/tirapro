import { Module } from '@nestjs/common';
import { IssuesModule } from '../issues/issues.module';
import { SearchModule } from '../search/search.module';
import { ExportController } from './export.controller';
import { ExportService } from './export.service';

@Module({
  imports: [IssuesModule, SearchModule],
  controllers: [ExportController],
  providers: [ExportService],
  exports: [ExportService],
})
export class ExportModule {}
