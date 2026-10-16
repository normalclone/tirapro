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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Người chưa ghép = không có khoá hoặc đang ở "— Chưa ghép —" (khác "Để trống" cố ý và đã ghép thành viên). */
const isUnmapped = (sel: UserSelection, name: string): boolean =>
  sel[name] === undefined || sel[name] === UNMAPPED;

/**
 * Email gửi API để nhớ người phụ trách chưa có (L28): chỉ người CHƯA ghép có email hợp lệ (chữ thường).
 * Người đã ghép / "Để trống" cố ý bị bỏ qua dù ô email còn chữ.
 */
export function buildPendingEmails(
  emails: Record<string, string>,
  sel: UserSelection,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, raw] of Object.entries(emails)) {
    const email = raw.trim().toLowerCase();
    if (isUnmapped(sel, name) && EMAIL_RE.test(email)) out[name] = email;
  }
  return out;
}

/** Điền sẵn ô email từ CSV (`analysis.users[].email`) cho người không tự ghép được. */
export function seedPendingEmails(
  users: JiraAnalyzeResult['users'],
  sel: UserSelection,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const u of users) if (u.email && isUnmapped(sel, u.name)) out[u.name] = u.email;
  return out;
}
