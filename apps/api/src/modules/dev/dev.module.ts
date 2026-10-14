// Module `dev` = tích hợp dev-links GitHub/GitLab (repository, webhook, link commit/PR vào issue); REST path là `/dev/...`.
// Việc cần làm sau: đổi tên thư mục thành `dev-links` (xem bảng trạng thái ở docs/MASTER_PLAN.md).
import { Module } from '@nestjs/common';
import { DevController } from './dev.controller';
import { DevService } from './dev.service';

@Module({
  controllers: [DevController],
  providers: [DevService],
  exports: [DevService],
})
export class DevModule {}
