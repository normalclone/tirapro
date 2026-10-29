import { Module } from '@nestjs/common';
import { AnalyticsModule } from '../analytics/analytics.module';
import { ProgramsController } from './programs.controller';
import { ProgramsService } from './programs.service';

@Module({
  imports: [AnalyticsModule],
  controllers: [ProgramsController],
  providers: [ProgramsService],
  exports: [ProgramsService],
})
export class ProgramsModule {}
