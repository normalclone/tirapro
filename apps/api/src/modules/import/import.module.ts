import { Module } from '@nestjs/common';
import { IssuesModule } from '../issues/issues.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ProjectsModule } from '../projects/projects.module';
import { ExcelImportService } from './excel/excel-import.service';
import { ImportController } from './import.controller';
import { ImportService } from './import.service';
import { JiraImportService } from './jira/jira-import.service';
import { PendingAssigneeService } from './pending-assignee.service';

@Module({
  imports: [IssuesModule, ProjectsModule, NotificationsModule],
  controllers: [ImportController],
  // PendingAssigneeService nghe member.added + project.access_changed (MembersModule/ProjectsModule chỉ phát sự kiện — không import ImportModule, tránh vòng phụ thuộc).
  providers: [ImportService, ExcelImportService, JiraImportService, PendingAssigneeService],
  exports: [ImportService],
})
export class ImportModule {}
