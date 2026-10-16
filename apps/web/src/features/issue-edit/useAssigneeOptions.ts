import { useEffect, useMemo, useState } from 'react';
import { rememberPeople, type PersonOption } from '@/components/ui/PeoplePicker';
import { useProjectMembers, useSearchUsers } from '@/features/members/api';
import { useTeams } from '@/features/teams/api';
import { useDebouncedValue } from '@/lib/useDebouncedValue';
import { showTypeToSearchHint } from '@/features/members/userSearch';

/**
 * Danh sách người có thể gán (assignee) trong ngữ cảnh 1 dự án, kèm:
 *  - vị trí = (các) vai trò dự án của họ,
 *  - nhóm = các team họ thuộc.
 * Gộp `search` để dropdown tìm theo tên / vị trí / nhóm cùng lúc.
 * Tự giảm cấp: thiếu dữ liệu vai trò/nhóm vẫn trả về danh sách người (chỉ tên).
 */
export function useAssigneeOptions(
  projectId?: string,
  opts: {
    /** Từ khoá tìm phía máy chủ (đã debounce ở nơi gọi). */
    search?: string;
    enabled?: boolean;
    /** Gồm cả tài khoản đã khoá — chỉ cho bộ lọc theo người, KHÔNG cho chọn người để giao. */
    includeInactive?: boolean;
    limit?: number;
  } = {},
): PersonOption[] {
  // Máy chủ lọc theo dự án (dự án riêng tư chỉ người xem được), bỏ tài khoản đã khoá, tìm theo từ khoá.
  const { data: users } = useSearchUsers({ projectId, ...opts });
  const { data: members } = useProjectMembers(projectId);
  const { data: teams } = useTeams();

  const options = useMemo(() => {
    const roleByUser = new Map<string, string[]>();
    for (const m of members ?? [])
      roleByUser.set(
        m.user.id,
        m.roles.map((r) => r.name),
      );

    const teamByUser = new Map<string, { name: string; color?: string | null }[]>();
    for (const t of teams ?? []) {
      for (const u of t.members ?? []) {
        const arr = teamByUser.get(u.id) ?? [];
        arr.push({ name: t.name, color: t.color });
        teamByUser.set(u.id, arr);
      }
    }

    return (users ?? []).map((u) => {
      const roleNames = roleByUser.get(u.id) ?? [];
      const position = roleNames.join(' · ');
      const userTeams = teamByUser.get(u.id) ?? [];
      const search = [u.displayName, u.email, position, ...userTeams.map((t) => t.name)]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return {
        id: u.id,
        name: u.displayName,
        avatarUrl: u.avatarUrl,
        email: u.email,
        position,
        roleNames,
        teams: userTeams,
        search,
      };
    });
  }, [users, members, teams]);
  useEffect(() => rememberPeople(options), [options]);
  return options;
}

/** Debounce từ khoá tìm người trước khi hỏi máy chủ. */
const SEARCH_DEBOUNCE_MS = 200;

/**
 * Bộ chọn người được giao có tìm phía máy chủ: `{...picker}` rải thẳng vào `<PeoplePicker>` (options + onSearchChange
 * + moreHint). Chưa gõ → 50 người đầu của dự án; gõ → máy chủ lọc (kể cả người ngoài 50 dòng đầu).
 */
export function useAssigneePicker(projectId?: string) {
  const [q, setQ] = useState('');
  const search = useDebouncedValue(q, SEARCH_DEBOUNCE_MS);
  const options = useAssigneeOptions(projectId, { search });
  // Chỉ để TRA TÊN: người đang chọn/chủ cũ đã khoá hoặc ngoài 50 dòng đầu vẫn hiện tên (tự ghi nhớ vào PeoplePicker).
  useAssigneeOptions(projectId, { includeInactive: true, limit: 200 });
  return {
    options,
    onSearchChange: setQ,
    moreHint: showTypeToSearchHint(options.length, q),
  };
}
