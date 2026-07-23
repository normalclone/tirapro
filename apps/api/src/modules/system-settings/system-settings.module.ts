import { Global, Module } from '@nestjs/common';
import { SystemSettingsService } from './system-settings.service';

/** Cờ hệ thống dùng chung (auth, ai, health, admin) → @Global để inject không cần import. */
@Global()
@Module({
  providers: [SystemSettingsService],
  exports: [SystemSettingsService],
})
export class SystemSettingsModule {}
