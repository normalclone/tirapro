import type { NameRefDto, WorkflowMoveRowDto } from '@tirapro/types';
import type { Workflow } from './api';

/** Một nhóm việc cùng loại, cùng trạng thái cũ (gộp mọi dự án): người dùng chọn MỘT trạng thái mới cho cả nhóm. */
export interface MoveGroup {
  /** `${loại}:${trạng thái cũ}` — khoá ổn định của dòng. */
  key: string;
  typeId: string;
  typeName: string;
  fromStatusId: string;
  fromStatusName: string;
  /** Đích gợi ý (hoặc đã chọn) từ máy chủ; null = quy trình đích không có trạng thái nào. */
  toStatusId: string | null;
  total: number;
  projects: Array<{ key: string; count: number }>;
  /** Gợi ý hệ thống (cùng tên/cùng nhóm), chưa phải người dùng chọn. */
  suggested: boolean;
}

/** Gộp các dòng "việc sẽ chuyển" theo (loại việc, trạng thái cũ) — thứ tự theo lần xuất hiện, dự án theo mã. */
export function groupMoves(moves: WorkflowMoveRowDto[]): MoveGroup[] {
  const groups = new Map<string, MoveGroup>();
  for (const m of moves) {
    const key = `${m.issueTypeId}:${m.fromStatusId}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        key,
        typeId: m.issueTypeId,
        typeName: m.issueTypeName,
        fromStatusId: m.fromStatusId,
        fromStatusName: m.fromStatusName,
        toStatusId: m.toStatusId,
        total: 0,
        projects: [],
        suggested: m.suggested,
      };
      groups.set(key, g);
    }
    g.total += m.count;
    g.projects.push({ key: m.projectKey, count: m.count });
  }
  return [...groups.values()].map((g) => ({
    ...g,
    projects: [...g.projects].sort((a, b) => a.key.localeCompare(b.key)),
  }));
}

/** Đích đã chọn cho nhóm: lựa chọn của người dùng, không có thì gợi ý của máy chủ. */
export function targetOf(g: MoveGroup, choices: Record<string, string>): string | null {
  return choices[g.key] ?? g.toStatusId;
}

/** `statusMapByType` cho PUT /workflow-schemes: loại → (trạng thái cũ → trạng thái mới). Nhóm chưa có đích bị bỏ (máy chủ báo 422). */
export function buildStatusMapByType(
  groups: MoveGroup[],
  choices: Record<string, string>,
): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  for (const g of groups) {
    const to = targetOf(g, choices);
    if (!to) continue;
    (out[g.typeId] ??= {})[g.fromStatusId] = to;
  }
  return out;
}

/** `statusMap` phẳng cho PUT ghi đè dự án (một loại việc nên không cần tách theo loại). */
export function buildFlatStatusMap(
  groups: MoveGroup[],
  choices: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const g of groups) {
    const to = targetOf(g, choices);
    if (to) out[g.fromStatusId] = to;
  }
  return out;
}

/** Nhóm chưa có trạng thái đích (không thể xác nhận). */
export function unmappedGroups(groups: MoveGroup[], choices: Record<string, string>): MoveGroup[] {
  return groups.filter((g) => !targetOf(g, choices));
}

/** Câu tóm tắt một nhóm, vd "12 Bug: Chờ test → Ready for Retest (KYHOP 8, GSDA 4)". */
export function describeGroup(g: MoveGroup, toName: string | null): string {
  const where = g.projects.map((p) => `${p.key} ${p.count}`).join(', ');
  return `${g.total} ${g.typeName}: ${g.fromStatusName} → ${toName ?? '(chưa chọn)'} (${where})`;
}

/** Trạng thái của quy trình chứa trạng thái `statusId` (để liệt kê đích chọn được); không thấy → `fallbackWorkflowId`. */
export function statusOptionsFor(
  workflows: Workflow[],
  statusId: string | null,
  fallbackWorkflowId?: string,
): Array<{ id: string; name: string }> {
  const owner =
    (statusId ? workflows.find((w) => w.statuses.some((s) => s.id === statusId)) : undefined) ??
    workflows.find((w) => w.id === fallbackWorkflowId);
  return [...(owner?.statuses ?? [])]
    .sort((a, b) => a.order - b.order)
    .map((s) => ({ id: s.id, name: s.name }));
}

export const NAME_REF_LABEL: Record<NameRefDto['kind'], string> = {
  savedFilter: 'Bộ lọc đã lưu',
  boardFilter: 'Bộ lọc của bảng việc',
  widget: 'Thẻ trên bảng tổng quan',
  rule: 'Điều kiện JQL của quy tắc',
  keyResult: 'Kết quả đo của mục tiêu',
};

/** Quy trình chọn được cho loại việc của tổ chức: chung của tổ chức, không phải mẫu, không phải quy trình riêng của dự án. */
export function selectableWorkflows(workflows: Workflow[]): Workflow[] {
  return workflows.filter((w) => !w.isTemplate && w.projectId === null);
}
