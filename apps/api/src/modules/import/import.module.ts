import { Module } from '@nestjs/common';
import { IssuesModule } from '../issues/issues.module';
import { ImportController } from './import.controller';
import { ImportService } from './import.service';

@Module({
  imports: [IssuesModule],
  controllers: [ImportController],
  providers: [ImportService],
  exports: [ImportService],
})
export class ImportModule {}
