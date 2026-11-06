import { Module } from '@nestjs/common';
import { ProjectRolesController } from './project-roles.controller';
import { ProjectRolesService } from './project-roles.service';
import { RolesController } from './roles.controller';
import { RolesService } from './roles.service';

@Module({
  controllers: [RolesController, ProjectRolesController],
  providers: [RolesService, ProjectRolesService],
})
export class RolesModule {}
