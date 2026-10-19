import type { IssueComponentRefDto, IssueVersionRefDto } from '@tirapro/types';

/** `select` để đọc tập thành phần/phiên bản đang gắn của một việc (dùng chung `issueInclude`, ComponentsService). */
export const issueSetsSelect = {
  components: { select: { component: { select: { id: true, name: true } } } },
  fixVersions: { select: { type: true, version: { select: { id: true, name: true } } } },
} as const;

interface IssueSetsRow {
  components: { component: { id: string; name: string } }[];
  fixVersions: { type: 'FIX' | 'AFFECTS'; version: { id: string; name: string } }[];
}

/** Tập đã gắn dưới dạng DTO, sắp ổn định (theo tên, phiên bản theo tên rồi loại). */
export function mapIssueSets(row: IssueSetsRow): {
  components: IssueComponentRefDto[];
  fixVersions: IssueVersionRefDto[];
} {
  return {
    components: row.components
      .map((c) => ({ id: c.component.id, name: c.component.name }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    fixVersions: row.fixVersions
      .map((v) => ({ id: v.version.id, name: v.version.name, type: v.type }))
      .sort((a, b) => a.name.localeCompare(b.name) || a.type.localeCompare(b.type)),
  };
}
