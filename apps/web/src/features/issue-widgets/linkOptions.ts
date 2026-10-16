import type { IssueDto } from '@tirapro/types';
import type { LinkType } from './api';

export interface RelationOption {
  value: string;
  label: string;
  typeId: string;
  direction: 'outward' | 'inward';
}

/** Mọi quan hệ chọn được khi thêm liên kết: mỗi loại hai chiều ("blocks" / "is blocked by"); loại đối xứng chỉ một mục. */
export function relationOptions(types: LinkType[]): RelationOption[] {
  return types.flatMap((t) => {
    const out: RelationOption = {
      value: `${t.id}:out`,
      label: t.outwardName,
      typeId: t.id,
      direction: 'outward',
    };
    if (t.inwardName === t.outwardName) return [out];
    return [
      out,
      { value: `${t.id}:in`, label: t.inwardName, typeId: t.id, direction: 'inward' as const },
    ];
  });
}

export function parseRelationValue(
  v: string,
): { typeId: string; direction: 'outward' | 'inward' } | null {
  const m = /^(.+):(out|in)$/.exec(v);
  return m ? { typeId: m[1]!, direction: m[2] === 'in' ? 'inward' : 'outward' } : null;
}

/** Chuỗi gõ vào có dạng mã công việc (`DEMO-STORY-3`, `ABC-1`) — khi đó tra thẳng theo mã ngoài tìm toàn văn. */
export const looksLikeIssueKey = (s: string): boolean =>
  /^[A-Za-z][A-Za-z0-9]*(?:-[A-Za-z][A-Za-z0-9]*)*-\d+$/.test(s.trim());

/** Bỏ chính công việc đang xem và các công việc đã liên kết; giữ nguyên thứ tự. */
export const filterLinkCandidates = (
  results: IssueDto[],
  selfId: string,
  linkedIds: Set<string>,
): IssueDto[] => results.filter((i) => i.id !== selfId && !linkedIds.has(i.id));

/**
 * Gợi ý đang hiện có khớp ĐÚNG chuỗi người dùng gõ không (để Enter chọn mà không dính kết quả cũ):
 * debounce đã chốt (`typed` đã bỏ khoảng trắng == `settled`) và truy vấn không còn tải/đang giữ dữ liệu của chuỗi trước.
 */
export const suggestionsReady = (typed: string, settled: string, pending: boolean): boolean =>
  typed.trim() !== '' && typed.trim() === settled && !pending;
