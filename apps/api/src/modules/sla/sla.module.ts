import { Module } from '@nestjs/common';
import { SlaController } from './sla.controller';
import { SlaService } from './sla.service';

/** Service desk / SLA: chính sách hạn phản hồi & giải quyết, tự gắn theo sự kiện issue. */
@Module({
  controllers: [SlaController],
  providers: [SlaService],
  exports: [SlaService],
})
export class SlaModule {}
