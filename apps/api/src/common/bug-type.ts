import { Prisma } from '@prisma/client';

/**
 * MỘT định nghĩa của "bug": loại công việc có `key = 'BUG'` HOẶC tên "Bug" (không phân biệt hoa thường) — loại tuỳ biến tên
 * "Bug" không có key cũng tính. Dùng chung cho báo cáo QA, KR tự đo `OPEN_BUGS`, CSV preset `bugs` và số Bug ở Tổng quan để
 * các màn không ra số khác nhau. Cùng nghĩa với `isBugType` ở FE.
 */
export const BUG_TYPE_WHERE: Prisma.IssueTypeWhereInput = {
  OR: [{ key: 'BUG' }, { name: { equals: 'Bug', mode: 'insensitive' } }],
};

/** Mảnh SQL của cùng định nghĩa; `alias` = bí danh bảng IssueType (mặc định `t`). Literal nên không ép kiểu CỘT. */
export function bugTypeSql(alias = 't'): Prisma.Sql {
  const key = Prisma.raw(`${alias}."key"`);
  const name = Prisma.raw(`${alias}."name"`);
  return Prisma.sql`(${key} = 'BUG' OR lower(${name}) = 'bug')`;
}

/** Cùng định nghĩa ở dạng hàm (cho code đã có sẵn dòng loại công việc). */
export function isBugType(type: { key?: string | null; name?: string | null }): boolean {
  return type.key === 'BUG' || (type.name ?? '').toLowerCase() === 'bug';
}
