import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module';
import { OrganizationBootstrapService } from './organization-bootstrap.service';
import { OrganizationsService } from './organizations.service';
import { OrganizationsController } from './organizations.controller';

@Module({
  imports: [MediaModule],
  controllers: [OrganizationsController],
  providers: [OrganizationBootstrapService, OrganizationsService],
  exports: [OrganizationBootstrapService],
})
export class OrganizationsModule {}
