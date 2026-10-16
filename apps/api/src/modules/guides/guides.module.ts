import { Module } from '@nestjs/common';
import { GuidesController } from './guides.controller';
import { GuidesService } from './guides.service';
import { GuidesBootstrapService } from './guides-bootstrap.service';
import { OnboardingService } from './onboarding.service';

@Module({
  controllers: [GuidesController],
  providers: [GuidesService, GuidesBootstrapService, OnboardingService],
  exports: [GuidesService],
})
export class GuidesModule {}
