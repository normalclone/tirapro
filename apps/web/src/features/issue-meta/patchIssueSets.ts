import type { QueryClient } from '@tanstack/react-query';
import type { IssueSetsChangedPayload } from '@tirapro/shared';
import type { IssueDto } from '@tirapro/types';
import { keys } from '@/lib/queryKeys';

type Sets = Pick<IssueDto, 'components' | 'fixVersions'>;
/** Phần của việc được vá lạc quan: tập Thành phần/Phiên bản hoặc nhãn. */
type Patch = Partial<Sets & Pick<IssueDto, 'labels'>>;

/**
 * Áp `fn` lên MỘT công việc ở MỌI cache đang giữ nó: chi tiết (`byKey`), danh sách dự án (`byProject`) và các board có
 * bộ lọc (`byBoard`). Chỉ sửa cache đã có; cố ý KHÔNG đổi `version` — máy chủ không tăng version khi gắn/bỏ thành
 * phần-phiên bản (khác `optimisticPatchIssue`), tăng ở FE sẽ làm lệch OCC ở lần sửa kế tiếp.
 */
function mapIssueEverywhere(
  qc: QueryClient,
  ref: { id: string; key: string; projectId: string },
  fn: (i: IssueDto) => Patch,
): void {
  const apply = (i: IssueDto): IssueDto => ({ ...i, ...fn(i) });
  qc.setQueryData<IssueDto>(keys.issues.byKey(ref.key), (o) => (o ? apply(o) : o));
  qc.setQueryData<IssueDto[]>(keys.issues.byProject(ref.projectId), (l) =>
    l?.map((i) => (i.id === ref.id ? apply(i) : i)),
  );
  qc.setQueriesData<IssueDto[]>({ queryKey: [keys.issues.all[0], 'board'] }, (l) =>
    Array.isArray(l) ? l.map((i) => (i.id === ref.id ? apply(i) : i)) : l,
  );
}

/**
 * Vá lạc quan tập Thành phần/Phiên bản. Trả hàm hoàn lại là PHÉP NGƯỢC (`inverse`) áp lên trạng thái hiện tại — không
 * khôi phục ảnh chụp cũ — nên hai thao tác liên tiếp mà thao tác đầu lỗi chỉ lùi đúng thao tác đó.
 */
export function patchIssueSets(
  qc: QueryClient,
  issue: IssueDto,
  fn: (i: IssueDto) => Sets,
  inverse: (i: IssueDto) => Sets,
): () => void {
  mapIssueEverywhere(qc, issue, fn);
  return () => mapIssueEverywhere(qc, issue, inverse);
}

/**
 * Vá lạc quan NHÃN của một việc (cùng cơ chế `patchIssueSets`: mọi cache giữ việc, không đổi `version`, trả phép ngược).
 * Dùng cho chip nhãn tạm lúc "tạo nhãn khi gắn" — máy chủ không tăng version khi gắn nhãn.
 */
export function patchIssueLabels(
  qc: QueryClient,
  issue: IssueDto,
  fn: (i: IssueDto) => Pick<IssueDto, 'labels'>,
  inverse: (i: IssueDto) => Pick<IssueDto, 'labels'>,
): () => void {
  mapIssueEverywhere(qc, issue, fn);
  return () => mapIssueEverywhere(qc, issue, inverse);
}

/** issue:sets_changed (realtime): thay thẳng tập đầy đủ theo id; idempotent nên echo của chính mình vô hại. */
export function applyIssueSets(qc: QueryClient, p: IssueSetsChangedPayload): void {
  mapIssueEverywhere(qc, { id: p.issueId, key: p.issueKey, projectId: p.projectId }, () => ({
    components: p.components,
    fixVersions: p.fixVersions,
  }));
}
