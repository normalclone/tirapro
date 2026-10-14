import { SetMetadata } from '@nestjs/common';

export const PROJECT_REF_KEY = 'projectRef';

/**
 * Nguồn để PermissionsGuard biết route này thuộc dự án nào:
 * - `issue | sprint | board | label | component | version | comment | attachment | issueLink`: id tài nguyên nằm ở `req.params[param]`;
 *   guard tra DB (có giới hạn theo workspace) để lấy projectId THẬT của tài nguyên (comment/attachment/issueLink đi qua issue cha).
 * - `param | body | query`: projectId nằm thẳng ở `req.params | req.body | req.query[param]`;
 *   guard kiểm dự án đó thuộc workspace hiện tại.
 */
export type ProjectRefKind =
  | 'issue'
  | 'sprint'
  | 'board'
  | 'label'
  | 'component'
  | 'comment'
  | 'attachment'
  | 'issueLink'
  | 'version'
  | 'param'
  | 'body'
  | 'query';

export interface ProjectRefMeta {
  kind: ProjectRefKind;
  param: string;
}

/** Tên tham số mặc định theo loại: tài nguyên → `id`, còn lại → `projectId`. */
export function defaultProjectRefParam(kind: ProjectRefKind): string {
  return kind === 'param' || kind === 'body' || kind === 'query' ? 'projectId' : 'id';
}

/**
 * Chỉ rõ projectId của route lấy từ đâu. Không bao giờ tin projectId do client
 * gửi ở query để cấp quyền — dùng decorator này thay vì để guard đoán.
 */
export const ProjectRef = (kind: ProjectRefKind, param?: string) =>
  SetMetadata(PROJECT_REF_KEY, { kind, param: param ?? defaultProjectRefParam(kind) } satisfies ProjectRefMeta);
