import { SetMetadata } from '@nestjs/common';

export const PROJECT_REF_KEY = 'projectRef';

/** Loại tài nguyên mà guard tra DB để suy ra dự án (id nằm ở `req.params[param]`). */
export type ProjectResourceKind =
  | 'issue'
  | 'sprint'
  | 'board'
  | 'label'
  | 'component'
  | 'version'
  | 'comment'
  | 'attachment'
  | 'issueLink'
  | 'raid'
  | 'automationTemplate'
  | 'recurringIssue'
  | 'worklog'
  | 'automationRule'
  | 'customField'
  | 'repository'
  | 'projectKey';

/**
 * Nguồn để PermissionsGuard biết route này thuộc dự án nào:
 * - `ProjectResourceKind`: giá trị ở `req.params[param]` là id tài nguyên (riêng `projectKey` là key dự án);
 *   guard tra DB (giới hạn theo workspace) để lấy projectId THẬT. comment/attachment/issueLink đi qua
 *   issue cha; raid/automationTemplate/automationRule/customField/repository có thể thuộc workspace (không gắn dự án).
 * - `param | body | query`: projectId nằm thẳng ở `req.params | req.body | req.query[param]`;
 *   guard kiểm dự án đó thuộc workspace hiện tại.
 */
export type ProjectRefKind = ProjectResourceKind | 'param' | 'body' | 'query';

export interface ProjectRefMeta {
  kind: ProjectRefKind;
  param: string;
}

/** Tên tham số mặc định theo loại: tài nguyên → `id` (projectKey → `key`), còn lại → `projectId`. */
export function defaultProjectRefParam(kind: ProjectRefKind): string {
  if (kind === 'param' || kind === 'body' || kind === 'query') return 'projectId';
  return kind === 'projectKey' ? 'key' : 'id';
}

/**
 * Chỉ rõ projectId của route lấy từ đâu. Không bao giờ tin projectId do client
 * gửi ở query để cấp quyền — dùng decorator này thay vì để guard đoán.
 */
export const ProjectRef = (kind: ProjectRefKind, param?: string) =>
  SetMetadata(PROJECT_REF_KEY, {
    kind,
    param: param ?? defaultProjectRefParam(kind),
  } satisfies ProjectRefMeta);
