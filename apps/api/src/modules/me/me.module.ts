import { Module } from '@nestjs/common';
import { MeController } from './me.controller';
import { MeOverviewService } from './me-overview.service';

@Module({
  controllers: [MeController],
  providers: [MeOverviewService],
})
export class MeModule {}
