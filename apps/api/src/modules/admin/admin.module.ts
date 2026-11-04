import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminConsoleController } from './admin-console.controller';
import { AdminService } from './admin.service';
import { AdminOverviewService } from './admin-overview.service';
import { AdminWorkspacesService } from './admin-workspaces.service';
import { AdminSystemService } from './admin-system.service';
import { MembersModule } from '../members/members.module';
import { IssuesModule } from '../issues/issues.module';

@Module({
  imports: [MembersModule, IssuesModule],
  controllers: [AdminController, AdminConsoleController],
  providers: [AdminService, AdminOverviewService, AdminWorkspacesService, AdminSystemService],
})
export class AdminModule {}
