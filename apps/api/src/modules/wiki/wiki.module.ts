import { Module } from '@nestjs/common';
import { WikiController } from './wiki.controller';
import { WikiService } from './wiki.service';

/**
 * Module Wiki — tài liệu nội bộ dạng cây (markdown), phạm vi tổ chức hoặc dự án.
 * Đọc: organization:view. Ghi: wiki:manage (theo dự án của trang). Xoá: project:admin.
 */
@Module({
  controllers: [WikiController],
  providers: [WikiService],
  exports: [WikiService],
})
export class WikiModule {}
