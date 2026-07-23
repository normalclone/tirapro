import { Module } from '@nestjs/common';
import { WorkspaceMembersController, ProjectMembersController } from './members.controller';
import { MembersService } from './members.service';

@Module({
  controllers: [WorkspaceMembersController, ProjectMembersController],
  providers: [MembersService],
  exports: [MembersService],
})
export class MembersModule {}
