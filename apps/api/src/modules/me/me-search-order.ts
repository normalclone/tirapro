import type { JqlFieldName, JqlOrderBy } from '@tirapro/shared';
import type { PersonalIssueDto } from '@tirapro/types';

type SortValue = string | number | null;

/** Thứ tự mặc định của `SearchService` khi JQL không có ORDER BY (và không có gợi ý xếp hạng full-text). */
const DEFAULT_ORDER: JqlOrderBy[] = [{ field: 'updated', direction: 'DESC' }];

/**
 * Giá trị sắp xếp của một việc theo trường JQL — PHẢI phản chiếu `compileOrder` của jql-compiler (cùng cột/quan hệ):
 * priority/status/type/resolution theo TÊN, severity theo `rank`, assignee/reporter theo id, nhãn/thành phần/phiên bản/text
 * rơi về `updatedAt`. `sprint` sắp theo tên sprint nhưng DTO danh sách chỉ có `sprintId` → không so được (null cho mọi việc:
 * thứ tự giữa các workspace chỉ theo khoá phụ; thứ tự BÊN TRONG mỗi workspace vẫn do DB quyết định).
 */
function sortValue(field: JqlFieldName, d: PersonalIssueDto): SortValue {
  switch (field) {
    case 'project':
      return d.projectKey;
    case 'workspace':
      return d.workspace.name;
    case 'type':
      return d.type.name;
    case 'status':
      return d.status.name;
    case 'statusCategory':
      return d.status.category;
    case 'priority':
      return d.priority?.name ?? null;
    case 'severity':
      return d.severity?.rank ?? null;
    case 'assignee':
      return d.assigneeId;
    case 'reporter':
      return d.reporterId;
    case 'resolution':
      return d.resolution?.name ?? null;
    case 'key':
      return d.key;
    case 'summary':
      return d.summary;
    case 'created':
      return d.createdAt;
    case 'due':
      return d.dueDate;
    case 'storyPoints':
      return d.storyPoints;
    case 'sprint':
      return null;
    default:
      // updated, labels, component, fixVersion, affectedVersion, text: compileOrder → updatedAt.
      return d.updatedAt;
  }
}

const collator = new Intl.Collator('vi');

function compareValues(a: Exclude<SortValue, null>, b: Exclude<SortValue, null>): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return collator.compare(String(a), String(b));
}

/**
 * So sánh hai việc theo ORDER BY của JQL rồi `id` tăng dần — cùng khoá với `IssuesService.queryOrdered`
 * (`[...orderBy, { id: 'asc' }]`). NULL theo mặc định Postgres: ASC → cuối, DESC → đầu; riêng `severity` luôn xuống cuối
 * (queryNullsLastBySeverity). Chỉ dùng để gộp NHIỀU workspace: trong một workspace, thứ tự do DB quyết định.
 */
export function buildComparator(
  orderBy: readonly JqlOrderBy[],
): (a: PersonalIssueDto, b: PersonalIssueDto) => number {
  const order = orderBy.length ? orderBy : DEFAULT_ORDER;
  return (a, b) => {
    for (const { field, direction } of order) {
      const av = sortValue(field, a);
      const bv = sortValue(field, b);
      if (av === bv) continue;
      const desc = direction === 'DESC';
      if (av === null || bv === null) {
        const nullsLast = field === 'severity' || !desc;
        const aNull = av === null;
        return aNull === nullsLast ? 1 : -1;
      }
      const c = compareValues(av, bv);
      if (c !== 0) return desc ? -c : c;
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  };
}
