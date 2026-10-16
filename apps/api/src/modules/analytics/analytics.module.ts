import { Module } from '@nestjs/common';
import { GoalsModule } from '../goals/goals.module';
import { RaidModule } from '../raid/raid.module';
import { ResourcesModule } from '../resources/resources.module';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { LeadershipService } from './leadership.service';
import { ProjectHealthService } from './project-health.service';
import { QaReportService } from './qa-report.service';

@Module({
  imports: [RaidModule, GoalsModule, ResourcesModule],
  controllers: [AnalyticsController],
  providers: [AnalyticsService, ProjectHealthService, QaReportService, LeadershipService],
  exports: [AnalyticsService, ProjectHealthService, LeadershipService],
})
export class AnalyticsModule {}
