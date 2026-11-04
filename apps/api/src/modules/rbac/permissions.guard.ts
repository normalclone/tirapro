import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { PermissionKey } from '@tirapro/types';
import {
  PERMISSIONS_ANY_KEY,
  PERMISSIONS_KEY,
} from '../../common/decorators/permissions.decorator';
import {
  PROJECT_REF_KEY,
  type ProjectRefMeta,
} from '../../common/decorators/project-ref.decorator';
import { ForbiddenAppException, NotFoundAppException } from '../../common/exceptions/app.exception';
import type { AuthedRequest } from '../../common/types/request';
import { RbacService } from './rbac.service';

/** Dự án để tính quyền + nhãn dùng cho 404 (khớp với nhãn của đường "không tồn tại" cùng loại). */
interface ResolvedProject {
  projectId: string | null;
  notFoundLabel: string;
}

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly rbac: RbacService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    const required = this.reflector.getAllAndOverride<PermissionKey[]>(PERMISSIONS_KEY, targets);
    const anyOf =
      this.reflector.getAllAndOverride<PermissionKey[] | undefined>(PERMISSIONS_ANY_KEY, targets) ??
      [];
    if ((!required || required.length === 0) && anyOf.length === 0) return true; // chỉ cần đã xác thực

    const req = context.switchToHttp().getRequest<AuthedRequest>();
    req.ownOnly = new Set(); // luôn đặt lại, không để lại giá trị từ lần chạy trước
    const user = req.user;
    if (!user) throw new ForbiddenAppException('Chưa xác thực');
    if (user.isSystemAdmin) return true;
    if (!user.organizationId)
      throw new ForbiddenAppException('Bạn chưa chọn tổ chức — hãy chọn một tổ chức rồi thử lại');

    const { projectId, notFoundLabel } = await this.resolveProject(
      context,
      req,
      user.organizationId,
    );
    // Dự án người gọi không xem được (riêng tư không là thành viên; hoặc vai thiếu `project:view` cấp tổ chức) nhận 404
    // TRƯỚC khi tính quyền, với CÙNG nhãn như khi tài nguyên không tồn tại
    // (cùng code/message/shape) — không lộ sự tồn tại của dự án/khoá dự án riêng tư.
    if (projectId)
      await this.rbac.assertProjectVisible(
        user.id,
        user.organizationId,
        projectId,
        notFoundLabel,
        false,
      );

    const effective = await this.rbac.getEffectivePermissions(
      user.id,
      user.organizationId,
      projectId,
    );
    user.permissions = [...effective] as PermissionKey[];

    const has = (p: PermissionKey) => effective.has(p) || effective.has(`${p}:own`);
    const all = required ?? [];
    // `anyOf`: chỉ cần MỘT quyền (vd quyền cấp tổ chức HOẶC quản trị chính dự án ở route này).
    // Nghiêm: quyền `:own` KHÔNG thoả `anyOf` (không có bước kiểm sở hữu cho nhóm này nên `:own` sẽ thành quyền đầy đủ).
    const ok = all.every(has) && (anyOf.length === 0 || anyOf.some((p) => effective.has(p)));
    if (!ok) throw new ForbiddenAppException('Bạn không có quyền thực hiện hành động này');
    // Quyền chỉ thoả bằng `:own` → đánh dấu để service kiểm quyền sở hữu tài nguyên (guard không biết chủ sở hữu).
    req.ownOnly = new Set(all.filter((p) => !effective.has(p)));
    return true;
  }

  /**
   * Xác định projectId để tính quyền. KHÔNG bao giờ tin projectId từ query (client tự chọn
   * được → leo thang đặc quyền). Tài nguyên (issue/sprint/…) → lấy projectId thật từ DB;
   * projectId thô (params/body) → bắt buộc thuộc tổ chức hiện tại.
   */
  private async resolveProject(
    context: ExecutionContext,
    req: AuthedRequest,
    organizationId: string,
  ): Promise<ResolvedProject> {
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
        // chỉ tính quyền cấp organization. Chuỗi rỗng đã được checkedProjectId coi là null.
        if (kind === 'query' && raw === 'none') return { projectId: null, notFoundLabel: 'Dự án' };
        return {
          projectId: await this.checkedProjectId(raw, organizationId),
          notFoundLabel: 'Dự án',
        };
      }
      // Nhãn 404 của đường này: khoá dự án → "Dự án"; còn lại là tài nguyên theo id → "Tài nguyên".
      const notFoundLabel = kind === 'projectKey' ? 'Dự án' : 'Tài nguyên';
      const value = req.params?.[param];
      if (typeof value !== 'string' || !value) throw new NotFoundAppException(notFoundLabel);
      const resolved = await this.rbac.resolveProjectId(organizationId, kind, value);
      if (!resolved) throw new NotFoundAppException(notFoundLabel);
      return { projectId: resolved.projectId, notFoundLabel }; // projectId null = tài nguyên cấp tổ chức
    }

    // Không khai báo @ProjectRef: dùng params.projectId. body.projectId CHỈ được tin khi route
    // không có tham số định danh nào khác (vd POST tạo mới) — nếu có `:id`, client không được
    // lái dự án bằng body (PUT /x/:id với body.projectId của dự án mình có quyền).
    if (req.params?.projectId !== undefined)
      return {
        projectId: await this.checkedProjectId(req.params.projectId, organizationId),
        notFoundLabel: 'Dự án',
      };
    const hasOtherParams = Object.keys(req.params ?? {}).length > 0;
    if (hasOtherParams) return { projectId: null, notFoundLabel: 'Dự án' };
    return {
      projectId: await this.checkedProjectId(req.body?.projectId, organizationId),
      notFoundLabel: 'Dự án',
    };
  }

  private async checkedProjectId(raw: unknown, organizationId: string): Promise<string | null> {
    if (raw === undefined || raw === null || raw === '') return null;
    // Mảng/đối tượng (vd ?projectId=a&projectId=b) là đầu vào không hợp lệ → coi như không tồn tại.
    if (typeof raw !== 'string') throw new NotFoundAppException('Dự án');
    await this.rbac.assertProjectInOrganization(raw, organizationId);
    return raw;
  }
}
