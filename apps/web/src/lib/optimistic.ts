import type { QueryClient } from '@tanstack/react-query';
import type { IssueDto } from '@tirapro/types';
import { keys } from './queryKeys';

/**
 * Ảnh chụp issue trước khi vá lạc quan — chỉ giữ ĐÚNG issue bị đụng (không chụp cả danh sách),
 * nên rollback một mutation lỗi không đè mất thay đổi hợp lệ của issue khác (realtime, mutation song song).
 */
export interface IssueSnapshot {
  projectId: string | undefined;
  /** Mã issue (dùng cho cache chi tiết `keys.issues.byKey`); lấy từ danh sách nếu không truyền. */
  issueKey: string | undefined;
  issueId: string;
  prevListItem: IssueDto | undefined;
  prevDetail: IssueDto | undefined;
}

export type IssuePatch = Partial<IssueDto> | ((issue: IssueDto) => Partial<IssueDto>);

/** Các field phẳng của IssueDto có thể vá lạc quan trực tiếp từ body PATCH (field quan hệ như priorityId cần object nên bỏ qua). */
const SCALAR_FIELDS = [
  'summary',
  'description',
  'descriptionFormat',
  'storyPoints',
  'originalEstimate',
  'remainingEstimate',
  'dueDate',
  'startDate',
  'sprintId',
  'assigneeId',
  'parentId',
  'epicId',
] as const;

/** Lọc body PATCH API thành phần vá lạc quan an toàn cho IssueDto. */
export function scalarIssuePatch(body: Record<string, unknown>): Partial<IssueDto> {
  const out: Record<string, unknown> = {};
  for (const f of SCALAR_FIELDS) if (f in body) out[f] = body[f];
  return out;
}

function apply(issue: IssueDto, patch: IssuePatch): IssueDto {
  const p = typeof patch === 'function' ? patch(issue) : patch;
  // Máy chủ luôn tăng version khi ghi → vá lạc quan cũng tăng, để thao tác kế tiếp gửi đúng version (OCC).
  return { ...issue, ...p, version: issue.version + 1 };
}

/**
 * Vá lạc quan một issue ở cả cache danh sách project lẫn cache chi tiết (nếu đang có), rồi trả snapshot
 * để rollback. Gọi trong `onMutate`. Không tạo cache mới nếu chưa có (chỉ sửa cái đang giữ).
 */
export async function optimisticPatchIssue(
  qc: QueryClient,
  projectId: string | undefined,
  id: string,
  patch: IssuePatch,
  issueKey?: string,
): Promise<IssueSnapshot> {
  const listKey = projectId ? keys.issues.byProject(projectId) : undefined;
  const prevListItem = listKey
    ? qc.getQueryData<IssueDto[]>(listKey)?.find((i) => i.id === id)
    : undefined;
  const key = issueKey ?? prevListItem?.key;
  const detailKey = key ? keys.issues.byKey(key) : undefined;

  // Huỷ fetch đang bay để kết quả cũ không đè lên bản vá.
  await Promise.all([
    listKey ? qc.cancelQueries({ queryKey: listKey }) : undefined,
    detailKey ? qc.cancelQueries({ queryKey: detailKey }) : undefined,
  ]);

  const prevDetail = detailKey ? qc.getQueryData<IssueDto>(detailKey) : undefined;
  if (listKey) {
    qc.setQueryData<IssueDto[]>(listKey, (old) =>
      old?.map((i) => (i.id === id ? apply(i, patch) : i)),
    );
  }
  if (detailKey) {
    qc.setQueryData<IssueDto>(detailKey, (old) => (old && old.id === id ? apply(old, patch) : old));
  }
  return { projectId, issueKey: key, issueId: id, prevListItem, prevDetail };
}

/**
 * Hoàn tác bản vá lạc quan. Chỉ trả lại khi issue vẫn đang ở đúng trạng thái lạc quan của mình
 * (version = trước + 1); nếu đã có bản mới hơn (realtime, mutation khác) thì để nguyên và
 * `invalidateIssue` sẽ nạp lại bản thật.
 */
export function rollbackIssue(qc: QueryClient, snap: IssueSnapshot | undefined): void {
  if (!snap) return;
  const { projectId, issueKey, issueId, prevListItem, prevDetail } = snap;
  if (projectId && prevListItem) {
    qc.setQueryData<IssueDto[]>(keys.issues.byProject(projectId), (old) =>
      old?.map((i) =>
        i.id === issueId && i.version === prevListItem.version + 1 ? prevListItem : i,
      ),
    );
  }
  if (issueKey && prevDetail) {
    qc.setQueryData<IssueDto>(keys.issues.byKey(issueKey), (old) =>
      old && old.version === prevDetail.version + 1 ? prevDetail : old,
    );
  }
}

/** Làm mới HẸP: chỉ danh sách project chứa issue + chi tiết issue đó (không quét mọi cache issue). */
export function invalidateIssue(
  qc: QueryClient,
  projectId: string | undefined,
  issueKey: string | undefined,
): void {
  if (projectId) void qc.invalidateQueries({ queryKey: keys.issues.byProject(projectId) });
  if (issueKey) void qc.invalidateQueries({ queryKey: keys.issues.byKey(issueKey) });
}

/** Ghi bản issue THẬT (response của PATCH) vào cả danh sách lẫn chi tiết — thay cho invalidate. */
export function writeIssue(qc: QueryClient, projectId: string | undefined, issue: IssueDto): void {
  const pid = projectId ?? issue.projectId;
  // Không ghi đè bản mới hơn (vd realtime vừa vá version cao hơn response này).
  qc.setQueryData<IssueDto[]>(keys.issues.byProject(pid), (old) =>
    old?.map((i) => (i.id === issue.id && issue.version >= i.version ? { ...i, ...issue } : i)),
  );
  qc.setQueryData<IssueDto>(keys.issues.byKey(issue.key), (old) =>
    old && issue.version >= old.version ? { ...old, ...issue } : old,
  );
}
