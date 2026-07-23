import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module';
import { WorkspaceBootstrapService } from './workspace-bootstrap.service';
import { WorkspacesService } from './workspaces.service';
import { WorkspacesController } from './workspaces.controller';

@Module({
  imports: [MediaModule],
  controllers: [WorkspacesController],
  providers: [WorkspaceBootstrapService, WorkspacesService],
  exports: [WorkspaceBootstrapService],
})
export class WorkspacesModule {}
