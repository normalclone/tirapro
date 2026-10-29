import type { ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { Bug, Eye, EyeOff, FolderPlus, Plus, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { useProject, useProjects } from '@/features/projects/api';
import { useIssue } from '@/features/issues/api';
import { useToggleWatch, useWatchState } from '@/features/issue-widgets/api';
import { CreateProjectModal } from '@/features/projects/CreateProjectModal';
import { GenerateIssuesDialog } from '@/features/ai/GenerateIssuesDialog';
import { useAi } from '@/stores/ai';
import { useCreateDialogs } from '@/stores/createDialogs';
import { useCreateIssueModal } from '@/stores/createIssue';
import { useReportIssueModal } from '@/stores/reportIssue';
import type { QuickActionKey } from '@/stores/quickActions';
import { apiErrorMessage } from '@/lib/api';
import { createPresetFromTarget } from '@/lib/currentProject';
import { keyLabel } from '@/lib/shortcuts';
import { useCreateTarget } from '@/lib/useCreateTarget';

function projectKeyFromPath(pathname: string): string {
  const parts = pathname.split('/').filter(Boolean);
  if (parts[0] === 'p' && parts[1]) return parts[1].toUpperCase();
  // Trang /issue/:key — mã theo LOẠI, không suy ra project key từ chuỗi; resolve theo projectId.
  return '';
}
function issueKeyFromPath(pathname: string): string {
  const parts = pathname.split('/').filter(Boolean);
  return parts[0] === 'issue' && parts[1] ? parts[1].toUpperCase() : '';
}

export interface CreateAction {
  key: Exclude<QuickActionKey, 'command'>;
  icon: ReactNode;
  label: string;
  /** Phím tắt (chỉ nút nổi desktop hiện; sheet mobile bỏ). */
  kbd?: string;
  /** Thực thi tác vụ (nơi gọi tự lo đóng menu/sheet). */
  perform: () => void;
}

/** Dự án / công việc đang xem, suy ra từ URL — dùng chung cho danh sách tác vụ và hộp thoại tạo bằng AI. */
function useCreateContext() {
  const loc = useLocation();
  const projectKey = projectKeyFromPath(loc.pathname);
  const issueKey = issueKeyFromPath(loc.pathname);
  const { data: issue } = useIssue(issueKey || null);
  const { data: projects } = useProjects();
  const { data: projectByKey } = useProject(projectKey);
  // Trên /p/:key dùng key; trên trang issue resolve project theo projectId của issue.
  const project =
    projectByKey ?? (issue ? (projects?.find((p) => p.id === issue.projectId) ?? null) : null);
  return { project, issueId: issue?.id ?? '' };
}

/**
 * Danh sách tác vụ "Tạo" theo ngữ cảnh — NGUỒN DUY NHẤT cho nút nổi (từ lg) và sheet "Tạo" (dưới lg), nên điều kiện
 * hiện/ẩn luôn giống nhau: Tạo công việc · Tạo bằng AI (trong dự án + AI bật) · Báo lỗi (trong dự án) ·
 * Theo dõi/Bỏ theo dõi (trên /issue/:key) · Tạo dự án. "Lệnh nhanh" và "Tuỳ biến" là việc riêng của nút nổi.
 */
export function useCreateActions(): CreateAction[] {
  const { project, issueId } = useCreateContext();
  const openCreate = useCreateIssueModal((s) => s.openCreate);
  const openReport = useReportIssueModal((s) => s.openReport);
  const openProjectDialog = useCreateDialogs((s) => s.openProject);
  const openAiDialog = useCreateDialogs((s) => s.openAi);
  const aiEnabled = useAi((s) => s.enabled);
  const { data: watchState } = useWatchState(issueId);
  const watchToggle = useToggleWatch(issueId);

  const hasProject = !!project?.id;
  const onIssue = !!issueId;
  const watching = watchState?.watching ?? false;
  // Tạo công việc = mở form tạo việc (popup toàn cục) vào dự án hiện tại. Dự án đang xem đã lưu trữ (không nằm trong danh
  // sách hoạt động) → dự án hoạt động dùng gần nhất; không có thì mở form với ô Dự án trống để tự chọn; không còn dự án hoạt động nào → chặn.
  const { target: createTarget, access: createAccess, canCreate } = useCreateTarget();

  return [
    createAccess !== 'deny' && {
      key: 'issue',
      icon: <Plus className="h-5 w-5" />,
      label: 'Tạo công việc',
      kbd: keyLabel('global.create'),
      perform: () => {
        if (createTarget.notice) toast.info(createTarget.notice);
        if (createTarget.block) return;
        if (createTarget.projectKey || createTarget.pickProject)
          openCreate(createPresetFromTarget(createTarget));
        else toast.error('Chưa có dự án nào — hãy tạo một dự án trước, rồi thêm công việc vào đó.');
      },
    },
    hasProject &&
      !project?.archivedAt &&
      canCreate !== false &&
      aiEnabled && {
        key: 'ai',
        icon: <Sparkles className="h-5 w-5 text-primary" />,
        label: 'Tạo bằng AI',
        perform: openAiDialog,
      },
    hasProject &&
      !project?.archivedAt &&
      createAccess !== 'deny' &&
      canCreate !== false && {
        key: 'report',
        icon: <Bug className="h-5 w-5" />,
        label: 'Báo lỗi',
        perform: () => openReport({ projectKey: project.key, kind: 'BUG' }),
      },
    onIssue && {
      key: 'watch',
      icon: watching ? <Eye className="h-5 w-5 text-primary" /> : <EyeOff className="h-5 w-5" />,
      label: watching ? 'Bỏ theo dõi' : 'Theo dõi',
      perform: () =>
        void watchToggle
          .mutateAsync(watching)
          .catch((e: unknown) => toast.error(apiErrorMessage(e))),
    },
    {
      key: 'project',
      icon: <FolderPlus className="h-5 w-5" />,
      label: 'Tạo dự án',
      perform: openProjectDialog,
    },
  ].filter(Boolean) as CreateAction[];
}

/**
 * Hộp thoại "Tạo dự án" + "Tạo bằng AI", mount MỘT lần ở khung ứng dụng. Trước đây nằm trong nút nổi — dưới `lg`
 * nút nổi không còn mount nên hộp thoại phải đứng ở nơi luôn có mặt để sheet "Tạo" mở được.
 */
export function CreateDialogsHost() {
  const { project } = useCreateContext();
  const aiEnabled = useAi((s) => s.enabled);
  const { projectOpen, aiOpen, closeProject, closeAi } = useCreateDialogs();
  return (
    <>
      <CreateProjectModal open={projectOpen} onClose={closeProject} />
      {project?.id && aiEnabled && (
        <GenerateIssuesDialog
          projectKey={project.key}
          projectId={project.id}
          open={aiOpen}
          onClose={closeAi}
        />
      )}
    </>
  );
}
