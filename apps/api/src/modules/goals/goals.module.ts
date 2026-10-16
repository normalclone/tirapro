import { Module } from '@nestjs/common';
import { SearchModule } from '../search/search.module';
import { GoalsController } from './goals.controller';
import { GoalsService } from './goals.service';
import { KrMeasureService } from './kr-measure.service';

/** MỤC TIÊU / OKR — Objective + KeyResult + issue gắn kèm; KR tự đo (L25) đo qua KrMeasureService. */
@Module({
  imports: [SearchModule],
  controllers: [GoalsController],
  providers: [GoalsService, KrMeasureService],
  exports: [GoalsService],
})
export class GoalsModule {}
