import { Module } from '@nestjs/common';
import { OrganizationMembersController, ProjectMembersController } from './members.controller';
import { AdminSyncService } from './admin-sync';
import { MembersService } from './members.service';

@Module({
  controllers: [OrganizationMembersController, ProjectMembersController],
  providers: [MembersService, AdminSyncService],
  exports: [MembersService, AdminSyncService],
})
export class MembersModule {}
