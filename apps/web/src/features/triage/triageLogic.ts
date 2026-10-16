import type { IssueEnvironment, SprintDto, TriageKind } from '@tirapro/types';
import { ENV_KIND_LABEL } from '@/features/issue-edit/environment';

export const kindLabel = (k: TriageKind | null): string =>
  k === 'BUG'
    ? 'Bug'
    : k === 'FEATURE'
      ? 'Yêu cầu tính năng'
      : k === 'QUESTION'
        ? 'Câu hỏi'
        : 'Yêu cầu';

/** Khoá IssueType mặc định khi nhận một yêu cầu theo loại người gửi chọn (không có loại → giữ loại hiện tại). */
export const defaultTypeKeyForKind = (k: TriageKind | null): 'BUG' | 'STORY' | 'TASK' | null =>
  k === 'BUG' ? 'BUG' : k === 'FEATURE' ? 'STORY' : k === 'QUESTION' ? 'TASK' : null;

export const DECLINE_QUICK_REASONS = [
  'Trùng với việc khác',
  'Ngoài phạm vi hiện tại',
  'Thiếu thông tin — vui lòng bổ sung',
  'Không tái hiện được',
];

/** Người gửi cần biết vì sao bị từ chối: tối thiểu 3 ký tự thật (API vẫn cho trống để tương thích client cũ). */
export const isDeclineReasonValid = (s: string): boolean => s.trim().length >= 3;

export interface AcceptCurrent {
  typeId: string;
  priorityId: string | null;
  sprintId: string | null;
  assigneeId: string | null;
  version: number;
}
export interface AcceptForm {
  typeId: string;
  priorityId: string;
  sprintId: string;
  assigneeId: string;
}
export interface AcceptPayload {
  version: number;
  typeId?: string;
  priorityId?: string;
  sprintId?: string | null;
  assigneeId?: string;
}

/** Chỉ gửi trường người duyệt đã đổi; không đổi gì thì chỉ còn `version` (Nhận một chạm). */
export function buildAcceptPayload(cur: AcceptCurrent, f: AcceptForm): AcceptPayload {
  return {
    version: cur.version,
    ...(f.typeId && f.typeId !== cur.typeId ? { typeId: f.typeId } : {}),
    ...(f.priorityId && f.priorityId !== (cur.priorityId ?? '')
      ? { priorityId: f.priorityId }
      : {}),
    ...((f.sprintId || null) !== cur.sprintId ? { sprintId: f.sprintId || null } : {}),
    ...(f.assigneeId && f.assigneeId !== (cur.assigneeId ?? '')
      ? { assigneeId: f.assigneeId }
      : {}),
  };
}

/** Môi trường gói trong một dòng ("Production · Chrome 130 · macOS · 1440×900"); không có gì → null. */
export function formatEnvironmentLine(e: IssueEnvironment | null | undefined): string | null {
  if (!e) return null;
  const parts = [
    e.env ? ENV_KIND_LABEL[e.env] : null,
    e.browser,
    e.os,
    e.build ? `Build ${e.build}` : null,
    e.viewport,
  ].filter((p): p is string => !!p);
  return parts.length ? parts.join(' · ') : null;
}

const TRIAGE_BACKLOG_LABEL = 'Việc chờ — chưa vào sprint';

/** Lựa chọn sprint khi nhận: Việc chờ + các sprint chưa đóng (sprint đóng không nhận việc mới). */
export function triageSprintOptions(
  sprints: SprintDto[] | undefined,
): Array<{ value: string; label: string }> {
  const out = [{ value: '', label: TRIAGE_BACKLOG_LABEL }];
  for (const s of sprints ?? []) {
    if (s.state === 'CLOSED') continue;
    out.push({ value: s.id, label: s.state === 'ACTIVE' ? `${s.name} · đang chạy` : s.name });
  }
  return out;
}

const MAX_PREVIEW_LINES = 12;
const MAX_PREVIEW_CHARS = 700;

/** Mô tả dài hơn ~12 dòng / 700 ký tự thì phần xem trước bị cắt và hiện "Xem đầy đủ". */
export const isLongDescription = (d: string | null | undefined): boolean =>
  !!d && (d.split('\n').length > MAX_PREVIEW_LINES || d.length > MAX_PREVIEW_CHARS);
