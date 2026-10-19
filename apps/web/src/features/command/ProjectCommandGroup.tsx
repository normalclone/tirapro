import { useMemo, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Command } from 'cmdk';
import { BarChart3, GanttChartSquare, Inbox, Play, Repeat, ShieldAlert } from 'lucide-react';
import { useProjectSprints } from '@/features/backlog/api';
import { useProject } from '@/features/projects/api';
import { useCan, useProjectCan } from '@/features/projects/permissions';
import { ActionItem } from './ActionItem';
import { buildProjectCommands, type ProjectCommand } from './projectCommands';

const ICONS: Record<ProjectCommand['icon'], ReactNode> = {
  sprint: <Play className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />,
  report: <BarChart3 className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />,
  gantt: <GanttChartSquare className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />,
  triage: <Inbox className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />,
  risks: <ShieldAlert className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />,
  automation: <Repeat className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />,
};

/**
 * Nhóm "Dự án hiện tại": tạo/bắt đầu/kết thúc sprint, mở Báo cáo/Lịch trình/Việc mới vào/Wiki/Rủi ro/Tự động hoá.
 * Chỉ dựng khi bảng lệnh mở (Radix không dựng nội dung khi đóng) nên không tải sprint/quyền lúc chưa cần.
 * Lệnh theo quyền + trạng thái sprint do `buildProjectCommands` quyết định.
 */
export function ProjectCommandGroup({
  projectKey,
  runAction,
}: {
  projectKey: string;
  runAction: (fn: () => void) => void;
}) {
  const navigate = useNavigate();
  const { data: project } = useProject(projectKey);
  const { data: sprints } = useProjectSprints(project?.id);
  // Dự án lưu trữ: chỉ còn quyền đọc → không có lệnh sprint/tự động hoá.
  const can = useProjectCan(project);
  const canSprint = can('sprint:manage');
  const canAutomation = can('automation:manage');
  // Việc mới vào xem được cả ở dự án lưu trữ (chỉ không duyệt được) → quyền thô `useCan`, không phải bản đã trừ lưu trữ.
  const canTriage = useCan(project?.id)('issue:triage');

  const commands = useMemo(
    () =>
      project
        ? buildProjectCommands({
            projectKey: project.key,
            projectId: project.id,
            sprints: sprints ?? [],
            canSprint,
            canAutomation,
            canTriage,
          })
        : [],
    [project, sprints, canSprint, canAutomation, canTriage],
  );
  if (commands.length === 0) return null;

  return (
    <Command.Group
      heading={`Dự án ${project?.name ?? projectKey}`}
      className="text-faint [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-faint"
    >
      {commands.map((c, i) => (
        <ActionItem
          key={c.id}
          // Hậu tố thứ tự (không phải id thật) để hai lệnh trùng từ khoá — vd hai sprint cùng tên — không trùng `value` của cmdk.
          value={`${c.keywords} ~${i}`}
          icon={ICONS[c.icon]}
          label={c.label}
          onSelect={() => runAction(() => navigate(c.to))}
        />
      ))}
    </Command.Group>
  );
}
