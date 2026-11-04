/**
 * DTO "quy trình theo loại việc" (workflow scheme): workspace ánh xạ loại việc → quy trình,
 * dự án có thể ghi đè riêng từng loại. Zero-dep; zod schema ở @tirapro/shared.
 */
import type { StatusCategory } from './enums';
import type { StatusDto } from './entities';

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
  /** Mọi loại việc của tổ chức (kể cả loại chưa có dòng cấu hình) — để giao diện vẽ đủ hàng. */
  issueTypes: SchemeIssueTypeDto[];
}

/** Loại việc rút gọn dùng trong bảng cấu hình quy trình. */
export interface SchemeIssueTypeDto {
  id: string;
  name: string;
  key: string | null;
  color: string | null;
  isSubtask: boolean;
  hierarchyLevel: number;
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
  issueTypes: SchemeIssueTypeDto[];
}

/** Trạng thái đích khi đổi loại việc giữa hai quy trình khác nhau. */
export interface StatusMappingChoiceDto {
  statusId: string;
  name: string;
  category: StatusCategory;
  /** Gợi ý mặc định: cùng tên, nếu không có thì trạng thái đầu tiên cùng nhóm. */
  isSuggested: boolean;
}

/** Một bước chuyển khả dụng từ trạng thái hiện tại của việc (quy trình của chính loại việc đó). */
export interface IssueTransitionOptionDto {
  id: string;
  name: string;
  toStatus: StatusDto;
}

/** `GET /issues/:id/transitions`. */
export interface IssueTransitionsDto {
  /** Quy trình theo loại việc của việc này; null khi loại việc chưa có quy trình. */
  workflowId: string | null;
  currentStatusId: string;
  transitions: IssueTransitionOptionDto[];
  /** Chỉ khi đang ở Pending: trạng thái mở ngay trước khi tạm dừng (theo lịch sử) — giao diện gợi ý quay về đó. */
  suggestedResumeStatusId?: string;
}

/** Một nhóm việc sẽ (hoặc đã) đổi trạng thái khi đổi quy trình của một loại việc. */
export interface WorkflowMoveRowDto {
  projectId: string;
  projectKey: string;
  issueTypeId: string;
  issueTypeName: string;
  fromStatusId: string;
  fromStatusName: string;
  /** null = chưa xác định được trạng thái đích (quy trình đích không có trạng thái nào). */
  toStatusId: string | null;
  toStatusName: string | null;
  count: number;
  /** true = đích do hệ thống gợi ý (cùng tên / cùng nhóm), người dùng chưa chọn trong `statusMap`. */
  suggested: boolean;
}

/** Quy tắc automation bị ảnh hưởng khi trạng thái đổi: được sửa lại id trạng thái, hoặc bị TẮT vì không ánh xạ được. */
export interface AffectedRuleDto {
  ruleId: string;
  name: string;
  projectId: string | null;
  /** Người tạo quy tắc — người nhận thông báo khi quy tắc bị tắt. */
  createdById: string;
  /** Quy tắc đang bật trước thay đổi (quy tắc đã tắt sẵn bị tắt tiếp thì không báo). */
  wasEnabled: boolean;
  /**
   * `needsReview`: quy tắc áp TOÀN TỔ CHỨC nhắc tới trạng thái bị đổi trong một thay đổi của riêng một dự án — không sửa/tắt, cần
   * Quản trị chung xem lại.
   */
  outcome: 'rewritten' | 'disabled' | 'needsReview';
  /** `disabled`: các trạng thái cũ không còn thay thế. */
  unmappableStatusIds?: string[];
  /** Trước → sau của từng trạng thái mà quy tắc nhắc tới (để người duyệt xem quy tắc sẽ khớp những trạng thái nào). */
  statusRefs?: Array<{ fromId: string; fromName: string; toIds: string[]; toNames: string[] }>;
}

/** Đối tượng lọc theo TÊN trạng thái trong JQL sẽ không còn khớp sau thay đổi (chỉ báo, không tự sửa). */
export interface NameRefDto {
  kind: 'savedFilter' | 'boardFilter' | 'widget' | 'rule' | 'keyResult';
  id: string;
  label: string;
  /** Tên trạng thái cũ xuất hiện trong JQL và không còn ở quy trình nào đang dùng. */
  names: string[];
}

/** Kết quả `PUT /workflow-schemes`, `PUT|DELETE /projects/:id/workflow-overrides`; `dryRun=1` chỉ xem trước, không ghi. */
export interface WorkflowChangeDto {
  dryRun: boolean;
  moves: WorkflowMoveRowDto[];
  totalIssues: number;
  /** Quy tắc automation tham chiếu trạng thái đổi: dryRun chỉ liệt kê, chạy thật đã sửa/tắt. */
  affectedRules: AffectedRuleDto[];
  /** Bộ lọc/bảng/widget/quy tắc/KR lọc theo TÊN trạng thái cũ trong JQL sẽ không còn khớp (chỉ báo). */
  nameRefs: NameRefDto[];
  /**
   * Chỉ khi áp dụng thật: cột bảng "ma" — chỉ còn trạng thái của quy trình cũ (còn việc ở đó hoặc là trạng thái cuối của cột nên
   * không tự gỡ được). Dạng "MÃ / Bảng / Cột"; người quản trị nên chuyển việc rồi dọn ở Cài đặt bảng.
   */
  ghostColumns?: string[];
}

/** `GET /workflows` → `usedBy`: nơi quy trình đang được dùng. */
export interface WorkflowUsageDto {
  /** Loại việc (khoá hệ thống, loại tuỳ chỉnh dùng tên) của tổ chức đang dùng quy trình này. */
  scheme: string[];
  /** Ghi đè của dự án (chỉ dự án người xem thấy). */
  overrides: Array<{ projectKey: string; typeKey: string }>;
  /** Dự án dùng quy trình này làm quy trình mặc định (`Project.defaultWorkflowId`). */
  projects: Array<{ id: string; key: string; name: string; deleted: boolean }>;
  /** Số ghi đè của dự án người xem không thấy (dự án riêng tư) — vẫn chặn xoá quy trình. */
  hiddenOverrideCount: number;
}
