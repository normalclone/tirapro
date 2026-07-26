import { Module } from '@nestjs/common';
import { RaidController } from './raid.controller';
import { RaidService } from './raid.service';

/** SỔ RỦI RO RAID — Risk / Assumption / Issue / Dependency. */
@Module({
  controllers: [RaidController],
  providers: [RaidService],
  exports: [RaidService],
})
export class RaidModule {}
