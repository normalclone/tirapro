import { Module } from '@nestjs/common';
import { GuidesController } from './guides.controller';
import { GuidesService } from './guides.service';
import { GuidesBootstrapService } from './guides-bootstrap.service';

@Module({
  controllers: [GuidesController],
  providers: [GuidesService, GuidesBootstrapService],
  exports: [GuidesService],
})
export class GuidesModule {}
