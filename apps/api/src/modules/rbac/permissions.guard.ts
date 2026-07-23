import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { PermissionKey } from '@tirapro/types';
import { PERMISSIONS_KEY } from '../../common/decorators/permissions.decorator';
import { ForbiddenAppException } from '../../common/exceptions/app.exception';
import type { AuthedRequest } from '../../common/types/request';
import { RbacService } from './rbac.service';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly rbac: RbacService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<PermissionKey[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true; // chỉ cần đã xác thực

    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const user = req.user;
    if (!user) throw new ForbiddenAppException('Chưa xác thực');
    if (user.isSystemAdmin) return true;
    if (!user.workspaceId) throw new ForbiddenAppException('Chưa chọn workspace');

    const projectId =
      (req.params?.projectId as string) ??
      (req.body?.projectId as string) ??
      (req.query?.projectId as string) ??
      null;

    const effective = await this.rbac.getEffectivePermissions(user.id, user.workspaceId, projectId);
    user.permissions = [...effective] as PermissionKey[];

    const ok = required.every((p) => effective.has(p) || effective.has(`${p}:own`));
    if (!ok) throw new ForbiddenAppException('Bạn không có quyền thực hiện hành động này');
    return true;
  }
}
