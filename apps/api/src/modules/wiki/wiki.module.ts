import { Module } from '@nestjs/common';
import { WikiController } from './wiki.controller';
import { WikiService } from './wiki.service';

/**
 * Module Wiki — tài liệu nội bộ dạng cây (markdown), phạm vi workspace hoặc dự án.
 * Đọc: workspace:view. Ghi: wiki:manage.
 */
@Module({
  controllers: [WikiController],
  providers: [WikiService],
  exports: [WikiService],
})
export class WikiModule {}
