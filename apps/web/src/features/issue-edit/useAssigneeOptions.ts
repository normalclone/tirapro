import { useMemo } from 'react';
import type { PersonOption } from '@/components/ui/PeoplePicker';
import { useWorkspaceUsers, useProjectMembers } from '@/features/members/api';
import { useTeams } from '@/features/teams/api';

/**
 * Danh sách người có thể gán (assignee) trong ngữ cảnh 1 dự án, kèm:
 *  - vị trí = (các) vai trò dự án của họ,
 *  - nhóm = các team họ thuộc.
 * Gộp `search` để dropdown tìm theo tên / vị trí / nhóm cùng lúc.
 * Tự giảm cấp: thiếu dữ liệu vai trò/nhóm vẫn trả về danh sách người (chỉ tên).
 */
export function useAssigneeOptions(projectId?: string): PersonOption[] {
  const { data: users } = useWorkspaceUsers();
  const { data: members } = useProjectMembers(projectId);
  const { data: teams } = useTeams();

  return useMemo(() => {
    const roleByUser = new Map<string, string[]>();
    for (const m of members ?? []) roleByUser.set(m.user.id, m.roles.map((r) => r.name));

    const teamByUser = new Map<string, { name: string; color?: string | null }[]>();
    for (const t of teams ?? []) {
      for (const u of t.members ?? []) {
        const arr = teamByUser.get(u.id) ?? [];
        arr.push({ name: t.name, color: t.color });
        teamByUser.set(u.id, arr);
      }
    }

    return (users ?? []).map((u) => {
      const position = (roleByUser.get(u.id) ?? []).join(' · ');
      const userTeams = teamByUser.get(u.id) ?? [];
      const search = [u.displayName, u.email, position, ...userTeams.map((t) => t.name)]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return { id: u.id, name: u.displayName, avatarUrl: u.avatarUrl, email: u.email, position, teams: userTeams, search };
    });
  }, [users, members, teams]);
}
