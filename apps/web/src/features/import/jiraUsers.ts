import type { JiraAnalyzeResult, JiraImportTargets } from '@tirapro/types';

/** Giá trị ô chọn: "Để trống" có chủ đích. */
export const BLANK = '';
/** Giá trị ô chọn khi CHƯA ghép (không có khoá trong mapping → API coi là không khớp và cảnh báo). */
export const UNMAPPED = '__unmapped__';

export type UserSelection = Record<string, string>;

/**
 * Gợi ý người dùng: khớp email, rồi tên hiển thị. Không khớp thì BỎ KHOÁ (chưa ghép) — khác với "Để trống" do người dùng
 * chọn: API cảnh báo việc bị bỏ gán cho người chưa ghép, còn "Để trống" có chủ đích thì không.
 */
export function autoMapUsers(
  users: JiraAnalyzeResult['users'],
  members: JiraImportTargets['members'],
): UserSelection {
  const out: UserSelection = {};
  for (const u of users) {
    const email = (u.email ?? '').toLowerCase();
    const hit =
      (email && members.find((m) => m.email.toLowerCase() === email)) ||
      members.find((m) => m.displayName.toLowerCase() === u.name.toLowerCase());
    if (hit) out[u.name] = hit.id;
  }
  return out;
}

/**
 * Mapping gửi API: chưa ghép (UNMAPPED hoặc chưa có khoá) → BỎ khoá; "Để trống" thật sự chọn → `null`; còn lại → id thành viên.
 * Tách hai trường hợp này để API chỉ cảnh báo khi người dùng chưa ghép.
 */
export function buildUserMapping(sel: UserSelection): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const [name, id] of Object.entries(sel))
    if (id !== UNMAPPED) out[name] = id === BLANK ? null : id;
  return out;
}
