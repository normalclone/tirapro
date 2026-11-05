import { Module } from '@nestjs/common';
import { IssuesModule } from '../issues/issues.module';
import { MembersModule } from '../members/members.module';
import { AssistantBulkController } from './assistant-bulk.controller';
import { AssistantBulkService } from './assistant-bulk.service';

@Module({
  imports: [IssuesModule, MembersModule],
  controllers: [AssistantBulkController],
  providers: [AssistantBulkService],
})
export class AssistantBulkModule {}
