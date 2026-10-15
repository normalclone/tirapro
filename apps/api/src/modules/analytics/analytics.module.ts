import { Module } from '@nestjs/common';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { ProjectHealthService } from './project-health.service';

@Module({
  controllers: [AnalyticsController],
  providers: [AnalyticsService, ProjectHealthService],
  exports: [AnalyticsService, ProjectHealthService],
})
export class AnalyticsModule {}
