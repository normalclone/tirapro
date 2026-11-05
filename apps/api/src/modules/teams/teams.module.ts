import { Module } from '@nestjs/common';
import { MembersModule } from '../members/members.module';
import { ProjectTeamsModule } from '../project-teams/project-teams.module';
import { TeamsController } from './teams.controller';
import { TeamsService } from './teams.service';

@Module({
  imports: [MembersModule, ProjectTeamsModule],
  controllers: [TeamsController],
  providers: [TeamsService],
  exports: [TeamsService],
})
export class TeamsModule {}
