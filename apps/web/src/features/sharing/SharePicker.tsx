import { useMemo } from 'react';
import { RadioCard } from '@/components/ui/RadioCard';
import { SearchSelect } from '@/components/ui/SearchSelect';
import { useProjects } from '@/features/projects/api';
import { useTeams } from '@/features/teams/api';
import { useAuth } from '@/stores/auth';
import { PRIVATE_PROJECT_NOTE } from './audience';
import {
  projectOptionsFor,
  teamOptionsFor,
  type ShareCopy,
  type ShareKind,
  type ShareValue,
} from './shareModel';

const KIND_LABEL: Record<ShareKind, string> = {
  PRIVATE: 'Chỉ mình tôi',
  GLOBAL: 'Cả không gian làm việc',
  PROJECT: 'Thành viên dự án…',
  TEAM: 'Thành viên nhóm…',
};

function kindNote(kind: ShareKind, c: ShareCopy): string {
  switch (kind) {
    case 'PRIVATE':
      return `Chỉ bạn xem được ${c.noun} này.`;
    case 'GLOBAL':
      return `Mọi thành viên sẽ thấy ${c.noun} này; ${c.dataNote}.`;
    case 'PROJECT':
      return `Thành viên của dự án sẽ thấy ${c.noun} này; ${c.dataNote}.`;
    case 'TEAM':
      return `Thành viên của nhóm sẽ thấy ${c.noun} này; ${c.dataNote}.`;
  }
}

/**
 * Bộ chọn "ai xem được" dùng chung cho bảng tổng quan (4 mức) và bộ lọc (3 mức). Dự án chọn trong số dự án bạn thấy và chưa
 * lưu trữ; nhóm chọn trong số nhóm bạn thuộc (admin: mọi nhóm). `keep` = dự án/nhóm đang gắn (luôn hiện dù không còn trong
 * danh sách được mời chọn).
 */
export function SharePicker({
  value,
  onChange,
  kinds,
  copy,
  keep,
}: {
  value: ShareValue;
  onChange: (v: ShareValue) => void;
  kinds: readonly ShareKind[];
  copy: ShareCopy;
  keep?: { projectId?: string; teamId?: string };
}) {
  const user = useAuth((s) => s.user);
  const isAdmin = useAuth((s) => s.can('workspace:admin'));
  const { data: projects } = useProjects(true);
  const { data: teams } = useTeams();

  const projectOptions = useMemo(
    () => projectOptionsFor(projects, keep?.projectId ?? ''),
    [projects, keep?.projectId],
  );
  const teamOptions = useMemo(
    () =>
      teamOptionsFor(
        teams,
        { userId: user?.id, isAdmin: isAdmin || !!user?.isSystemAdmin },
        keep?.teamId ?? '',
      ),
    [teams, user, isAdmin, keep?.teamId],
  );
  const selectedProject = (projects ?? []).find((p) => p.id === value.projectId);

  function pick(scope: ShareKind) {
    onChange({
      scope,
      projectId: scope === 'PROJECT' ? value.projectId : '',
      teamId: scope === 'TEAM' ? value.teamId : '',
    });
  }

  return (
    <RadioCard
      ariaLabel="Mức chia sẻ"
      value={value.scope}
      onChange={pick}
      options={kinds.map((kind) => ({
        value: kind,
        label: KIND_LABEL[kind],
        description: kindNote(kind, copy),
        children:
          kind === 'PROJECT' ? (
            <>
              <SearchSelect
                value={value.projectId}
                onChange={(projectId) => onChange({ ...value, projectId })}
                options={projectOptions}
                placeholder="Chọn dự án…"
                searchPlaceholder="Tìm dự án…"
                ariaLabel="Dự án được chia sẻ"
              />
              {selectedProject?.isPrivate && (
                <p className="mt-1 text-xs text-muted">{PRIVATE_PROJECT_NOTE}</p>
              )}
            </>
          ) : kind === 'TEAM' ? (
            <SearchSelect
              value={value.teamId}
              onChange={(teamId) => onChange({ ...value, teamId })}
              options={teamOptions}
              placeholder="Chọn nhóm…"
              searchPlaceholder="Tìm nhóm…"
              ariaLabel="Nhóm được chia sẻ"
            />
          ) : undefined,
      }))}
    />
  );
}
