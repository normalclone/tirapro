import { Module } from '@nestjs/common';
import { ResourcesController } from './resources.controller';
import { ResourcesService } from './resources.service';

/** Năng lực & tải nguồn lực: phân bổ theo dự án, nghỉ phép/ngày lễ, bảng tải theo tuần. */
@Module({
  controllers: [ResourcesController],
  providers: [ResourcesService],
  exports: [ResourcesService],
})
export class ResourcesModule {}
