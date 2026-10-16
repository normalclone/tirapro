import { Module } from '@nestjs/common';
import { IssuesModule } from '../issues/issues.module';
import { WorklogsController } from './worklogs.controller';
import { WorklogsService } from './worklogs.service';

/** Worklog / theo dõi thời gian trên issue. RbacService đến từ RbacModule (toàn cục). */
@Module({
  imports: [IssuesModule],
  controllers: [WorklogsController],
  providers: [WorklogsService],
})
export class WorklogsModule {}
