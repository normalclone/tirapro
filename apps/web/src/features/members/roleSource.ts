import type { MemberDto, RoleRefDto } from '@tirapro/types';

/**
 * NGUỒN của từng vai trò dự án (API trả `direct` + `teams` ở từng vai trò của thành viên có dòng ghi đè):
 *  - `direct`: gán trực tiếp ("trực tiếp"; thêm "+ qua Team X" nếu cùng vai trò còn đến từ team);
 *  - `team`: chỉ nhờ team được gắn vào dự án ("qua Team QA");
 *  - `orgDefault`: vai trò mặc định suy từ vai trò tổ chức, cộng thêm cho người chỉ có vai trò nhờ team ở dự án công khai
 *    (API trả dòng này không kèm `direct`/`teams`) — "mặc định theo tổ chức".
 * Thành viên KHÔNG có dòng ghi đè (`isOverride` false) chỉ dùng vai trò mặc định: không có nhãn nguồn từng vai trò (hàng đã có thẻ "mặc định").
 */
type RoleSourceKind = 'direct' | 'team' | 'orgDefault';

export interface RoleSource {
  kind: RoleSourceKind;
  /** Nhãn ngắn hiện cạnh vai trò. */
  label: string;
  /** Giải nghĩa khi rê chuột. */
  title: string;
}

type RowLike = Pick<MemberDto, 'roles' | 'isOverride'>;

const teamList = (r: RoleRefDto): string => (r.teams ?? []).map((t) => t.name).join(', ');

/** Dòng có thông tin nguồn (API mới) — thành viên cũ chưa có dòng nối thì không có `direct` ở bất kỳ vai trò nào. */
const hasSourceInfo = (m: RowLike): boolean => m.roles.some((r) => r.direct !== undefined);

export function roleSourceOf(role: RoleRefDto, m: RowLike): RoleSource | null {
  if (!m.isOverride) return null;
  const teams = teamList(role);
  if (role.direct === true) {
    return teams
      ? {
          kind: 'direct',
          label: `trực tiếp + qua Team ${teams}`,
          title: `Vai trò được gán trực tiếp cho người này, và cũng có nhờ Team ${teams}. Gỡ team thì vai trò vẫn còn.`,
        }
      : {
          kind: 'direct',
          label: 'trực tiếp',
          title: 'Vai trò được gán trực tiếp cho người này trong dự án.',
        };
  }
  if (teams) {
    return {
      kind: 'team',
      label: `qua Team ${teams}`,
      title: `Có vai trò này vì thuộc Team ${teams} đã gắn vào dự án. Rời team (hoặc gỡ team khỏi dự án) thì mất vai trò này.`,
    };
  }
  if (hasSourceInfo(m)) {
    return {
      kind: 'orgDefault',
      label: 'mặc định theo tổ chức',
      title:
        'Vai trò mặc định suy từ vai trò của người này ở tổ chức. Vẫn được cộng thêm khi người này thuộc team được gắn vào dự án.',
    };
  }
  // Ghi đè cũ (chưa có thông tin nguồn): xem như gán trực tiếp.
  return {
    kind: 'direct',
    label: 'trực tiếp',
    title: 'Vai trò được gán trực tiếp cho người này trong dự án.',
  };
}

/** Có vai trò gán trực tiếp (nút "gỡ vai trò riêng" chỉ có nghĩa khi có). Ghi đè cũ không có thông tin nguồn = có. */
export function memberHasDirectRoles(m: RowLike): boolean {
  if (!m.isOverride) return false;
  return hasSourceInfo(m) ? m.roles.some((r) => r.direct === true) : true;
}

/**
 * Vai trò GÁN TRỰC TIẾP của thành viên (phần mà "đặt / gỡ vai trò riêng" tác động; vai trò nhờ team và vai trò mặc định theo tổ chức
 * thì không). Không có ghi đè → rỗng; ghi đè cũ chưa có thông tin nguồn → tất cả đều là trực tiếp.
 */
export function directRolesOf(m: RowLike): RoleRefDto[] {
  if (!m.isOverride) return [];
  return hasSourceInfo(m) ? m.roles.filter((r) => r.direct === true) : m.roles;
}

/** Tên các team đang cho người này vai trò ở dự án (khử trùng, giữ thứ tự xuất hiện). */
export function memberTeamNames(m: Pick<MemberDto, 'roles'>): string[] {
  return [...new Set(m.roles.flatMap((r) => (r.teams ?? []).map((t) => t.name)))];
}

/** Chỉ có vai trò nhờ team (không vai trò gán trực tiếp) — lưu vai trò sẽ biến chúng thành "đặt riêng". */
export function isTeamOnlyMember(m: RowLike): boolean {
  return (
    m.isOverride === true &&
    hasSourceInfo(m) &&
    !m.roles.some((r) => r.direct === true) &&
    memberTeamNames(m).length > 0
  );
}

/**
 * Gỡ team `teamId` khỏi dự án: những ai sẽ MẤT HẲN tư cách thành viên dự án riêng tư (mọi vai trò chỉ nhờ team này, không có
 * vai trò gán trực tiếp, không nhờ team khác) và những ai chỉ mất bớt (vẫn còn vai trò khác). Dự án công khai: "rời" nghĩa là về
 * vai trò mặc định theo tổ chức.
 */
export function unlinkImpact(
  members: readonly Pick<MemberDto, 'roles' | 'isOverride' | 'user'>[],
  teamId: string,
): { leaving: string[]; reduced: string[] } {
  const leaving: string[] = [];
  const reduced: string[] = [];
  for (const m of members) {
    if (!m.isOverride) continue;
    const viaThis = m.roles.filter((r) => r.teams?.some((t) => t.id === teamId));
    if (viaThis.length === 0) continue;
    const keeps = m.roles.some(
      (r) => r.direct === true || (r.teams ?? []).some((t) => t.id !== teamId),
    );
    (keeps ? reduced : leaving).push(m.user.displayName);
  }
  return { leaving, reduced };
}
