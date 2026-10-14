import { Module } from '@nestjs/common';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { AiQuotaService } from './ai-quota.service';
import { ClaudeService } from './claude.service';

@Module({
  controllers: [AiController],
  providers: [AiQuotaService, ClaudeService, AiService],
  exports: [ClaudeService, AiService],
})
export class AiModule {}
