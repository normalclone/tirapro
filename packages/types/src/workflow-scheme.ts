/**
 * DTO "quy trình theo loại việc" (workflow scheme): workspace ánh xạ loại việc → quy trình,
 * dự án có thể ghi đè riêng từng loại. Zero-dep; zod schema ở @tirapro/shared.
 */
import type { StatusCategory } from './enums';

/** Khoá ba quy trình mặc định (Standard / Bug / Epic Workflow). */
export type WorkflowDefaultKey = 'STANDARD' | 'BUG' | 'EPIC';

/** Một dòng ánh xạ loại việc → quy trình. */
export interface WorkflowSchemeItemDto {
  issueTypeId: string;
  workflowId: string;
}

/** Cấu hình quy trình của workspace (GET/PUT). */
export interface WorkspaceWorkflowSchemeDto {
  items: WorkflowSchemeItemDto[];
}

/** Ghi đè của một dự án cho một loại việc. */
export interface ProjectWorkflowOverrideDto extends WorkflowSchemeItemDto {
  projectId: string;
}

/** Quy trình hiệu lực của một loại việc trong một dự án. */
export interface ProjectWorkflowSchemeItemDto extends WorkflowSchemeItemDto {
  /** true = dự án dùng quy trình riêng; false = theo workspace. */
  isOverride: boolean;
  /** Quy trình theo workspace (để hiển thị "Theo workspace: …" khi đang ghi đè). */
  workspaceWorkflowId: string | null;
}

export interface ProjectWorkflowSchemeDto {
  projectId: string;
  items: ProjectWorkflowSchemeItemDto[];
}

/** Trạng thái đích khi đổi loại việc giữa hai quy trình khác nhau. */
export interface StatusMappingChoiceDto {
  statusId: string;
  name: string;
  category: StatusCategory;
  /** Gợi ý mặc định: cùng tên, nếu không có thì trạng thái đầu tiên cùng nhóm. */
  isSuggested: boolean;
}
