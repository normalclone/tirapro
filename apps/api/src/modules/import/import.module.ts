import { Module } from '@nestjs/common';
import { IssuesModule } from '../issues/issues.module';
import { ProjectsModule } from '../projects/projects.module';
import { ImportController } from './import.controller';
import { ImportService } from './import.service';
import { JiraImportService } from './jira/jira-import.service';

@Module({
  imports: [IssuesModule, ProjectsModule],
  controllers: [ImportController],
  providers: [ImportService, JiraImportService],
  exports: [ImportService],
})
export class ImportModule {}
