// Module `dev-links` = tích hợp GitHub/GitLab (repository, webhook, link commit/PR vào issue). REST path `/dev/...` giữ nguyên để không phá client/webhook.
import { Module } from '@nestjs/common';
import { DevLinksController } from './dev-links.controller';
import { DevLinksService } from './dev-links.service';

@Module({
  controllers: [DevLinksController],
  providers: [DevLinksService],
  exports: [DevLinksService],
})
export class DevLinksModule {}
