import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { SearchModule } from '../search/search.module';
import { SavedFiltersController } from './saved-filters.controller';
import { SavedFiltersService } from './saved-filters.service';

@Module({
  imports: [SearchModule, NotificationsModule],
  controllers: [SavedFiltersController],
  providers: [SavedFiltersService],
  exports: [SavedFiltersService],
})
export class SavedFiltersModule {}
