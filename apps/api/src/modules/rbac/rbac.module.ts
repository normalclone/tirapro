import { Global, Module } from '@nestjs/common';
import { IssueOwnershipService } from './issue-ownership.service';
import { ProjectAccessService } from './project-access.service';
import { RbacService } from './rbac.service';

@Global()
@Module({
  providers: [RbacService, IssueOwnershipService, ProjectAccessService],
  exports: [RbacService, IssueOwnershipService, ProjectAccessService],
})
export class RbacModule {}
