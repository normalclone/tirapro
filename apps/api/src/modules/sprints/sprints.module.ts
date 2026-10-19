import { Module } from '@nestjs/common';
import { SprintsController } from './sprints.controller';
import { SprintsService } from './sprints.service';
import { SprintSnapshotCron } from './sprint-snapshot.cron';

@Module({
  controllers: [SprintsController],
  providers: [SprintsService, SprintSnapshotCron],
  exports: [SprintsService],
})
export class SprintsModule {}
