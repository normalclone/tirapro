import { Global, Module } from '@nestjs/common';
import { IssueOwnershipService } from './issue-ownership.service';
import { RbacService } from './rbac.service';

@Global()
@Module({
  providers: [RbacService, IssueOwnershipService],
  exports: [RbacService, IssueOwnershipService],
})
export class RbacModule {}
