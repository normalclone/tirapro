import { Module } from '@nestjs/common';
import { ConfigCatalogController } from './config-catalog.controller';
import { ConfigCatalogService } from './config-catalog.service';

@Module({
  controllers: [ConfigCatalogController],
  providers: [ConfigCatalogService],
  exports: [ConfigCatalogService],
})
export class ConfigCatalogModule {}
