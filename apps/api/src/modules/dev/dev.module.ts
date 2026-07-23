import { Module } from '@nestjs/common';
import { DevController } from './dev.controller';
import { DevService } from './dev.service';

@Module({
  controllers: [DevController],
  providers: [DevService],
  exports: [DevService],
})
export class DevModule {}
