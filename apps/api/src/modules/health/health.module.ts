import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { ApiHelpController } from './api-help.controller';

@Module({
  controllers: [HealthController, ApiHelpController],
})
export class HealthModule {}
