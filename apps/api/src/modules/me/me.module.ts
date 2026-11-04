import { Module } from '@nestjs/common';
import { SearchModule } from '../search/search.module';
import { MeController } from './me.controller';
import { MeSearchService } from './me-search.service';

@Module({
  imports: [SearchModule],
  controllers: [MeController],
  providers: [MeSearchService],
  exports: [MeSearchService],
})
export class MeModule {}
