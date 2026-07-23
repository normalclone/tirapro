import { Module } from '@nestjs/common';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { ClaudeService } from './claude.service';

@Module({
  controllers: [AiController],
  providers: [ClaudeService, AiService],
  exports: [ClaudeService, AiService],
})
export class AiModule {}
