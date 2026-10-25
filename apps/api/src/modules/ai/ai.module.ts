import { Module } from '@nestjs/common';
import { SearchModule } from '../search/search.module';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { AiQuotaService } from './ai-quota.service';
import { ClaudeService } from './claude.service';
import { AssigneeSuggestService } from './assignee-suggest.service';
import { SprintAssistantService } from './sprint-assistant.service';

@Module({
  imports: [SearchModule],
  controllers: [AiController],
  providers: [
    AiQuotaService,
    ClaudeService,
    AiService,
    AssigneeSuggestService,
    SprintAssistantService,
  ],
  exports: [ClaudeService, AiService],
})
export class AiModule {}
