import { Module } from '@nestjs/common';
import { DashboardsController, DashboardTemplatesController } from './dashboards.controller';
import { DashboardsService } from './dashboards.service';

/** Dashboard tuỳ biến (ProjectAccessService/RbacService đến từ RbacModule — @Global). */
@Module({
  controllers: [DashboardsController, DashboardTemplatesController],
  providers: [DashboardsService],
})
export class DashboardsModule {}
