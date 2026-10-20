import { extractMentionIds } from '@tirapro/shared';

/** Người có thể được tin: danh sách người XEM được dự án (`useAssigneeOptions`). */
export interface AudiencePerson {
  id: string;
  name: string;
  avatarUrl?: string | null;
}
interface UserLike {
  id: string;
  displayName: string;
  avatarUrl?: string | null;
}

type AudienceReason = 'mentioned' | 'assignee' | 'watcher';
export interface AudienceEntry {
  id: string;
  name: string;
  avatarUrl: string | null;
  reason: AudienceReason;
}

/**
 * Ai sẽ nhận thông báo khi gửi bình luận `draft` — PHẢN CHIẾU quy tắc của máy chủ (tối đa nỗ lực, chưa tính cài đặt tắt
 * loại thông báo của từng người và gộp 60 giây):
 *  1. người được @ — chỉ người máy chủ giữ lại (thành viên xem được dự án) = giao với `people`; id lạ trong token tự gõ
 *     bị bỏ im lặng (KHÔNG tra user theo id tuỳ ý; tên lấy từ `people`, không tin tên trong token);
 *  2. người được giao — nếu không phải tác giả và chưa được @ (máy chủ không báo "bình luận mới" thêm lần nữa);
 *  3. người theo dõi — mọi watcher trừ tác giả, không trùng người đã nằm trong danh sách (máy chủ gộp thông báo trùng).
 * Chính mình (`meId`) luôn bị loại.
 */
export function commentAudience(input: {
  draft: string;
  people: readonly AudiencePerson[];
  assignee: UserLike | null | undefined;
  watchers: readonly UserLike[] | undefined;
  meId: string | undefined;
}): AudienceEntry[] {
  const { draft, people, assignee, watchers, meId } = input;
  const out: AudienceEntry[] = [];
  const seen = new Set<string>(meId ? [meId] : []);
  const add = (
    id: string,
    name: string,
    avatarUrl: string | null | undefined,
    reason: AudienceReason,
  ) => {
    if (seen.has(id)) return;
    seen.add(id);
    out.push({ id, name, avatarUrl: avatarUrl ?? null, reason });
  };

  if (draft.includes('(user:')) {
    const byId = new Map(people.map((p) => [p.id, p]));
    for (const id of extractMentionIds(draft)) {
      const p = byId.get(id);
      if (p) add(p.id, p.name, p.avatarUrl, 'mentioned');
    }
  }
  if (assignee) {
    const p = people.find((x) => x.id === assignee.id);
    add(
      assignee.id,
      p?.name ?? assignee.displayName,
      p?.avatarUrl ?? assignee.avatarUrl,
      'assignee',
    );
  }
  for (const w of watchers ?? []) add(w.id, w.displayName, w.avatarUrl, 'watcher');
  return out;
}

/** Câu đầy đủ (sr-only + title): nêu tên + lý do cho người được nhắc/giao, gộp người theo dõi thành số. */
export function audienceSummary(entries: readonly AudienceEntry[]): string {
  if (entries.length === 0) return '';
  const parts = entries
    .filter((e) => e.reason !== 'watcher')
    .map((e) => `${e.name} (${e.reason === 'mentioned' ? 'được nhắc' : 'người được giao'})`);
  const watchers = entries.filter((e) => e.reason === 'watcher').length;
  if (watchers > 0) parts.push(`${watchers} người theo dõi`);
  const head = parts.slice(0, -1).join(', ');
  const text = head ? `${head} và ${parts[parts.length - 1]}` : parts[0]!;
  return `Sẽ thông báo cho ${text}`;
}
