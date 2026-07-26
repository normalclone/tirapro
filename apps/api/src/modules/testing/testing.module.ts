import { Module } from '@nestjs/common';
import { IssuesModule } from '../issues/issues.module';
import { TestingController } from './testing.controller';
import { TestingService } from './testing.service';

/** Quản lý kiểm thử: ca kiểm thử, đợt chạy, kết quả & tạo bug từ ca không đạt. */
@Module({
  imports: [IssuesModule],
  controllers: [TestingController],
  providers: [TestingService],
  exports: [TestingService],
})
export class TestingModule {}
