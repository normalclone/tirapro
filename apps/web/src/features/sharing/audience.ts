import { fmtNumber } from '@/lib/locale';
import type { ShareKind } from './shareModel';

/** Tối đa chừng này avatar trong khối "Ai có quyền"; phần còn lại gộp thành "+N". */
export const AUDIENCE_AVATAR_LIMIT = 5;

export interface AudiencePerson {
  id: string;
  name: string;
  avatarUrl: string | null;
}

interface UserLike {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  status?: string;
}

/** Người dùng → người trong danh sách: bỏ người đã vô hiệu hoá, bỏ trống/trùng (giữ thứ tự gặp đầu tiên). */
export function activePeople(users: readonly (UserLike | null | undefined)[]): AudiencePerson[] {
  const seen = new Set<string>();
  const out: AudiencePerson[] = [];
  for (const u of users) {
    if (!u || u.status === 'DEACTIVATED' || seen.has(u.id)) continue;
    seen.add(u.id);
    out.push({ id: u.id, name: u.displayName, avatarUrl: u.avatarUrl });
  }
  return out;
}

export function splitPeople(
  people: readonly AudiencePerson[],
  limit: number = AUDIENCE_AVATAR_LIMIT,
): { shown: AudiencePerson[]; extra: number } {
  return { shown: people.slice(0, limit), extra: Math.max(0, people.length - limit) };
}

export interface AudienceInput {
  scope: ShareKind;
  /** Số thành viên đang hoạt động của không gian (`/auth/workspaces`); thiếu khi API cũ. */
  memberCount?: number;
  /** Nhóm đang chọn (đã có `members` từ `useTeams`), `null` = chưa chọn. */
  team?: { name: string; lead?: UserLike | null; members: readonly UserLike[] } | null;
  /** Dự án đang chọn, `null` = chưa chọn. */
  project?: { name: string; isPrivate: boolean } | null;
  /** Thành viên dự án RIÊNG TƯ (`GET /projects/:id/members`). */
  projectMembers?: { status: 'loading' | 'error' | 'ready'; people: readonly AudiencePerson[] };
}

export interface AudienceView {
  headline: string;
  /** Dòng phụ nhỏ dưới tiêu đề (vd dự án công khai/riêng tư), `null` nếu không có. */
  note: string | null;
  /** Tối đa `AUDIENCE_AVATAR_LIMIT` người. */
  people: AudiencePerson[];
  /** Số người còn lại sau các avatar ("+N"). */
  extra: number;
  /** MỘT câu cho trình đọc màn hình thay cho avatar (trang trí): tên người hiện ra + "và N người khác". */
  names: string | null;
}

const withCount = (label: string, n: number | undefined) =>
  n === undefined ? label : `${label} (${fmtNumber(n)})`;
const WORKSPACE_LABEL = 'Mọi thành viên không gian';
/**
 * Quản trị viên (không gian / hệ thống) thấy MỌI mục đã chia sẻ theo nhóm hoặc dự án, kể cả dự án riêng tư và nhóm họ không
 * thuộc (`dashboardVisibleWhere`, `visibilityScope` ← `visibleWhere` = `{}` cho admin). Mục RIÊNG TƯ thì không: admin không thấy.
 */
const WITH_ADMINS = ' và Quản trị chung';
/** Ghi chú dưới mức "Dự án" riêng tư — khớp tiêu đề: Quản trị chung vẫn thấy (xem `WITH_ADMINS`). */
export const PRIVATE_PROJECT_NOTE = 'Người ngoài dự án không thấy (trừ Quản trị chung).';

function view(headline: string, note: string | null, all: readonly AudiencePerson[]): AudienceView {
  const { shown, extra } = splitPeople(all);
  const names =
    shown.length === 0
      ? null
      : `Gồm ${shown.map((p) => p.name).join(', ')}${extra > 0 ? ` và ${extra} người khác` : ''}.`;
  return { headline, note, people: shown, extra, names };
}

/** "Ai có quyền xem" theo mức đang chọn — chỉ dùng dữ liệu người xem vốn đã thấy (nhóm, thành viên dự án người xem được). */
export function audienceView(i: AudienceInput): AudienceView {
  switch (i.scope) {
    case 'PRIVATE':
      return view('Chỉ bạn', null, []);
    case 'GLOBAL':
      return view(withCount(WORKSPACE_LABEL, i.memberCount), null, []);
    case 'TEAM': {
      if (!i.team) return view('Chọn nhóm để xem ai có quyền', null, []);
      const people = activePeople([i.team.lead, ...i.team.members]);
      return view(
        `${withCount(`Thành viên nhóm ${i.team.name}`, people.length)}${WITH_ADMINS}`,
        null,
        people,
      );
    }
    case 'PROJECT': {
      const p = i.project;
      if (!p) return view('Chọn dự án để xem ai có quyền', null, []);
      if (!p.isPrivate) {
        // Không in `memberCount`: đó là số thành viên không gian, còn người chỉ có vai theo-dự-án (không có `project:view`
        // cấp không gian) KHÔNG thấy dự án công khai — nên số đó sẽ nói quá.
        return view(
          'Mọi thành viên có quyền xem dự án',
          `Dự án ${p.name} công khai nên mọi thành viên có quyền xem dự án đều thấy.`,
          [],
        );
      }
      const m = i.projectMembers;
      const label = `Thành viên dự án ${p.name}`;
      const full = (n: number | undefined) => `${withCount(label, n)}${WITH_ADMINS}`;
      if (!m || m.status === 'loading') {
        return view(full(undefined), 'Đang tải danh sách thành viên…', []);
      }
      if (m.status === 'error') {
        return view(full(undefined), 'Không tải được danh sách thành viên.', []);
      }
      return view(full(m.people.length), PRIVATE_PROJECT_NOTE, m.people);
    }
  }
}
