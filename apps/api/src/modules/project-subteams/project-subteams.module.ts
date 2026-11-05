import { Module } from '@nestjs/common';
import { ProjectSubTeamsController } from './project-subteams.controller';
import { ProjectSubTeamsService } from './project-subteams.service';

@Module({
  controllers: [ProjectSubTeamsController],
  providers: [ProjectSubTeamsService],
  exports: [ProjectSubTeamsService],
})
export class ProjectSubTeamsModule {}
