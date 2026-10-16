import type { IssueComponentRefDto, IssueVersionRefDto } from '@tirapro/types';

/**
 * Hàm thuần cho tập Thành phần/Phiên bản của một công việc — bất biến, idempotent (khớp API: gắn trùng /
 * gỡ cái không có đều trả `{ ok: true }`). Dùng để vá cache lạc quan mà KHÔNG đổi `version` của việc.
 */

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);

export const withComponent = (list: IssueComponentRefDto[], c: IssueComponentRefDto) =>
  list.some((x) => x.id === c.id) ? list : [...list, c].sort(byName);

export const withoutComponent = (list: IssueComponentRefDto[], id: string) =>
  list.filter((x) => x.id !== id);

export const withVersion = (list: IssueVersionRefDto[], v: IssueVersionRefDto) =>
  list.some((x) => x.id === v.id && x.type === v.type)
    ? list
    : [...list, v].sort((a, b) => byName(a, b) || a.type.localeCompare(b.type));

export const withoutVersion = (
  list: IssueVersionRefDto[],
  id: string,
  type: IssueVersionRefDto['type'],
) => list.filter((x) => !(x.id === id && x.type === type));

/** Danh mục trừ phần đã gắn; với phiên bản truyền `type` để chỉ trừ các mục cùng loại. */
export function availableToAdd<T extends { id: string; name: string }>(
  catalog: T[],
  attached: Array<{ id: string; type?: string }>,
  type?: string,
): T[] {
  return catalog.filter(
    (c) => !attached.some((a) => a.id === c.id && (type === undefined || a.type === type)),
  );
}
