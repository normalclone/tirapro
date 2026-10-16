import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { PermissionKey } from '@tirapro/types';
import { PERMISSIONS_KEY } from '../../common/decorators/permissions.decorator';
import {
  PROJECT_REF_KEY,
  type ProjectRefMeta,
} from '../../common/decorators/project-ref.decorator';
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
    req.ownOnly = new Set(); // luôn đặt lại, không để lại giá trị từ lần chạy trước
    const user = req.user;
    if (!user) throw new ForbiddenAppException('Chưa xác thực');
    if (user.isSystemAdmin) return true;
    if (!user.workspaceId)
      throw new ForbiddenAppException(
        'Bạn chưa chọn không gian làm việc — hãy chọn một không gian rồi thử lại',
      );

    const projectId = await this.resolveProject(context, req, user.workspaceId);
    // Dự án riêng tư: người ngoài nhận 404 TRƯỚC khi tính quyền (không lộ sự tồn tại, không phân biệt 403/404).
    if (projectId) await this.rbac.assertProjectVisible(user.id, user.workspaceId, projectId);

    const effective = await this.rbac.getEffectivePermissions(user.id, user.workspaceId, projectId);
    user.permissions = [...effective] as PermissionKey[];

    const ok = required.every((p) => effective.has(p) || effective.has(`${p}:own`));
    if (!ok) throw new ForbiddenAppException('Bạn không có quyền thực hiện hành động này');
    // Quyền chỉ thoả bằng `:own` → đánh dấu để service kiểm quyền sở hữu tài nguyên (guard không biết chủ sở hữu).
    req.ownOnly = new Set(required.filter((p) => !effective.has(p)));
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
        const raw: unknown = source?.[param];
        // `?projectId=none` là sentinel "mục dùng chung" (vd /automation/templates) → không có dự án,
        // chỉ tính quyền cấp workspace. Chuỗi rỗng đã được checkedProjectId coi là null.
        if (kind === 'query' && raw === 'none') return null;
        return this.checkedProjectId(raw, workspaceId);
      }
      const value = req.params?.[param];
      if (typeof value !== 'string' || !value) throw new NotFoundAppException('Tài nguyên');
      const resolved = await this.rbac.resolveProjectId(workspaceId, kind, value);
      if (!resolved) throw new NotFoundAppException('Tài nguyên');
      return resolved.projectId; // null = tài nguyên cấp workspace
    }

    // Không khai báo @ProjectRef: dùng params.projectId. body.projectId CHỈ được tin khi route
    // không có tham số định danh nào khác (vd POST tạo mới) — nếu có `:id`, client không được
    // lái dự án bằng body (PUT /x/:id với body.projectId của dự án mình có quyền).
    if (req.params?.projectId !== undefined)
      return this.checkedProjectId(req.params.projectId, workspaceId);
    const hasOtherParams = Object.keys(req.params ?? {}).length > 0;
    if (hasOtherParams) return null;
    return this.checkedProjectId(req.body?.projectId, workspaceId);
  }

  private async checkedProjectId(raw: unknown, workspaceId: string): Promise<string | null> {
    if (raw === undefined || raw === null || raw === '') return null;
    // Mảng/đối tượng (vd ?projectId=a&projectId=b) là đầu vào không hợp lệ → coi như không tồn tại.
    if (typeof raw !== 'string') throw new NotFoundAppException('Dự án');
    await this.rbac.assertProjectInWorkspace(raw, workspaceId);
    return raw;
  }
}
