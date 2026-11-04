import { Module } from '@nestjs/common';
import { OrganizationMembersController, ProjectMembersController } from './members.controller';
import { MembersService } from './members.service';

@Module({
  controllers: [OrganizationMembersController, ProjectMembersController],
  providers: [MembersService],
  exports: [MembersService],
})
export class MembersModule {}
