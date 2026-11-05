import { Module } from '@nestjs/common';
import { ProjectTeamsController } from './project-teams.controller';
import { ProjectTeamsService } from './project-teams.service';

@Module({
  controllers: [ProjectTeamsController],
  providers: [ProjectTeamsService],
  exports: [ProjectTeamsService],
})
export class ProjectTeamsModule {}
