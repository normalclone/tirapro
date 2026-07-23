import { Module } from '@nestjs/common';
import { WatchersController } from './watchers.controller';
import { WatchersService } from './watchers.service';

@Module({
  controllers: [WatchersController],
  providers: [WatchersService],
  exports: [WatchersService],
})
export class WatchersModule {}
