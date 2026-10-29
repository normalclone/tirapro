/**
 * Câu JQL của Trợ lý — dựng bằng chuỗi từ ngữ pháp JQL có sẵn (`@tirapro/shared`), KHÔNG endpoint mới. Giá trị người dùng
 * gõ luôn được đặt trong nháy kép và thoát `\` `"` (test kiểm bằng chính `parseJql`).
 */
const quote = (s: string): string => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

const and = (...parts: (string | false | undefined)[]): string =>
  parts.filter(Boolean).join(' AND ');

const scope = (projectKey?: string | null): string | undefined =>
  projectKey ? `project = ${quote(projectKey)}` : undefined;

/** Việc đang giao cho tôi và chưa xong. */
export const myIssuesJql = (projectKey?: string | null): string =>
  `${and(scope(projectKey), 'assignee = currentUser()', 'statusCategory != DONE')} ORDER BY updated DESC`;

/** Việc chưa xong có hạn trước hôm nay. */
export const overdueJql = (projectKey?: string | null): string =>
  `${and(scope(projectKey), 'due < startOfDay()', 'statusCategory != DONE')} ORDER BY due ASC`;

/** Việc chưa xong đến hạn từ hôm nay tới hết tuần này / hết hôm nay. */
export const dueJql = (period: 'week' | 'today', projectKey?: string | null): string =>
  `${and(
    scope(projectKey),
    'due >= startOfDay()',
    period === 'week' ? 'due <= endOfWeek()' : 'due <= endOfDay()',
    'statusCategory != DONE',
  )} ORDER BY due ASC`;

/** Tìm văn bản (tiêu đề, mô tả) — cùng trường `text` với ô tìm kiếm của ứng dụng. */
export const searchJql = (query: string, projectKey?: string | null): string =>
  `${and(scope(projectKey), `text ~ ${quote(query.trim())}`)} ORDER BY updated DESC`;

/** Việc của một sprint trong dự án (đếm theo nhóm trạng thái). */
export const sprintIssuesJql = (projectKey: string, sprintName: string): string =>
  and(scope(projectKey), `sprint = ${quote(sprintName)}`);

/** Liên kết "Xem tất cả" → trang Bộ lọc (`/filters?jql=`). */
export const filtersHref = (jql: string): string => `/filters?jql=${encodeURIComponent(jql)}`;
