import { Module } from '@nestjs/common';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { ProjectHealthService } from './project-health.service';
import { QaReportService } from './qa-report.service';

@Module({
  controllers: [AnalyticsController],
  providers: [AnalyticsService, ProjectHealthService, QaReportService],
  exports: [AnalyticsService, ProjectHealthService],
})
export class AnalyticsModule {}
