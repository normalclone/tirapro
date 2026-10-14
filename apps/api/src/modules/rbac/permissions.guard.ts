import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { PermissionKey } from '@tirapro/types';
import { PERMISSIONS_KEY } from '../../common/decorators/permissions.decorator';
import { PROJECT_REF_KEY, type ProjectRefMeta } from '../../common/decorators/project-ref.decorator';
import { ForbiddenAppException, NotFoundAppException } from '../../common/exceptions/app.exception';
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
    if (!user.workspaceId) throw new ForbiddenAppException('Bạn chưa chọn không gian làm việc — hãy chọn một không gian rồi thử lại');

    const projectId = await this.resolveProject(context, req, user.workspaceId);

    const effective = await this.rbac.getEffectivePermissions(user.id, user.workspaceId, projectId);
    user.permissions = [...effective] as PermissionKey[];

    const ok = required.every((p) => effective.has(p) || effective.has(`${p}:own`));
    if (!ok) throw new ForbiddenAppException('Bạn không có quyền thực hiện hành động này');
    return true;
  }

  /**
   * Xác định projectId để tính quyền. KHÔNG bao giờ tin projectId từ query (client tự chọn
   * được → leo thang đặc quyền). Tài nguyên (issue/sprint/…) → lấy projectId thật từ DB;
   * projectId thô (params/body) → bắt buộc thuộc workspace hiện tại.
   */
  private async resolveProject(
    context: ExecutionContext,
    req: AuthedRequest,
    workspaceId: string,
  ): Promise<string | null> {
    const ref = this.reflector.getAllAndOverride<ProjectRefMeta | undefined>(PROJECT_REF_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (ref) {
      const { kind, param } = ref;
      if (kind === 'param' || kind === 'body' || kind === 'query') {
        const source = kind === 'param' ? req.params : kind === 'body' ? req.body : req.query;
        return this.checkedProjectId(source?.[param], workspaceId);
      }
      const value = req.params?.[param];
      if (typeof value !== 'string' || !value) throw new NotFoundAppException('Tài nguyên');
      const projectId = await this.rbac.resolveProjectId(workspaceId, kind, value);
      if (!projectId) throw new NotFoundAppException('Tài nguyên');
      return projectId;
    }

    // Không khai báo @ProjectRef: chỉ chấp nhận params/body (không đọc query).
    return this.checkedProjectId(req.params?.projectId ?? req.body?.projectId, workspaceId);
  }

  private async checkedProjectId(raw: unknown, workspaceId: string): Promise<string | null> {
    if (typeof raw !== 'string' || !raw) return null;
    await this.rbac.assertProjectInWorkspace(raw, workspaceId);
    return raw;
  }
}
