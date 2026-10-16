import { Module } from '@nestjs/common';
import { IssuesModule } from '../issues/issues.module';
import { ProjectsModule } from '../projects/projects.module';
import { ImportController } from './import.controller';
import { ImportService } from './import.service';
import { JiraImportService } from './jira/jira-import.service';
import { PendingAssigneeService } from './pending-assignee.service';

@Module({
  imports: [IssuesModule, ProjectsModule],
  controllers: [ImportController],
  // PendingAssigneeService nghe member.added (MembersModule chỉ phát sự kiện — không import ImportModule, tránh vòng phụ thuộc).
  providers: [ImportService, JiraImportService, PendingAssigneeService],
  exports: [ImportService],
})
export class ImportModule {}
