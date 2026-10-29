import { Module } from '@nestjs/common';
import { AnalyticsModule } from '../analytics/analytics.module';
import { MediaModule } from '../media/media.module';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';

@Module({
  imports: [MediaModule, AnalyticsModule],
  controllers: [ProjectsController],
  providers: [ProjectsService],
  exports: [ProjectsService],
})
export class ProjectsModule {}
