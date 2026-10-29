import { sprintActionPath } from '@/features/backlog/sprintAction';
import { configSectionPath } from '@/features/project-config/configSections';
import { TRIAGE_TITLE } from '@/features/triage/triageLogic';
import { CONNECT_LABELS, MANAGE_LABELS } from '@/lib/navLabels';

/**
 * Một lệnh của nhóm "Dự án hiện tại" trong Cmd+K: `to` = điều hướng. `keywords` không dấu để gõ không cần dấu
 * (bộ lọc `commandFilter` bỏ dấu cả hai phía, nên có thể kèm tên có dấu).
 */
export interface ProjectCommand {
  id: string;
  label: string;
  keywords: string;
  to: string;
  icon: 'sprint' | 'report' | 'gantt' | 'triage' | 'risks' | 'automation' | 'import';
}

interface SprintLike {
  id: string;
  name: string;
  state: string;
  sequence?: number;
}

export interface ProjectCommandInput {
  projectKey: string;
  projectId: string;
  sprints: readonly SprintLike[];
  /** `sprint:manage` (dự án lưu trữ → false). */
  canSprint: boolean;
  /** `automation:manage`. */
  canAutomation: boolean;
  /** `issue:triage` (tính bằng `useCan`, không phải bản "đã trừ lưu trữ"): ẩn lệnh Việc mới vào nếu thiếu. */
  canTriage: boolean;
  /** `import:run` (dự án lưu trữ → false). */
  canImport: boolean;
}

/** Số sprint chưa bắt đầu tối đa được liệt kê thành lệnh "Bắt đầu sprint". */
const MAX_START_COMMANDS = 5;

/**
 * Lệnh theo dự án hiện tại. Lệnh sprint chỉ khi có quyền: "Kết thúc sprint" cho sprint ACTIVE; "Bắt đầu sprint" cho
 * sprint FUTURE CHỈ khi chưa có sprint ACTIVE (API từ chối nếu đã có). Lệnh sprint đi qua Việc chờ kèm `?action=` để dùng
 * lại hộp xác nhận/quyền của trang đó. Không có "Báo lỗi": đã nằm ở nhóm Hành động của bảng lệnh.
 */
export function buildProjectCommands(input: ProjectCommandInput): ProjectCommand[] {
  const { projectKey: k, projectId, sprints } = input;
  const out: ProjectCommand[] = [];

  if (input.canSprint) {
    out.push({
      id: 'sprint.create',
      label: 'Tạo sprint',
      keywords: 'tao sprint moi create sprint',
      to: sprintActionPath(k, { action: 'create-sprint' }),
      icon: 'sprint',
    });
    const active = sprints.find((s) => s.state === 'ACTIVE');
    if (active) {
      out.push({
        id: `sprint.complete.${active.id}`,
        label: `Kết thúc sprint “${active.name}”`,
        keywords: `ket thuc sprint hoan thanh complete sprint ${active.name}`,
        to: sprintActionPath(k, { action: 'complete', sprintId: active.id }),
        icon: 'sprint',
      });
    } else {
      sprints
        .filter((s) => s.state === 'FUTURE')
        .sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0))
        .slice(0, MAX_START_COMMANDS)
        .forEach((s) =>
          out.push({
            id: `sprint.start.${s.id}`,
            label: `Bắt đầu sprint “${s.name}”`,
            keywords: `bat dau sprint chay start sprint ${s.name}`,
            to: sprintActionPath(k, { action: 'start', sprintId: s.id }),
            icon: 'sprint',
          }),
        );
    }
  }

  out.push(
    {
      id: 'nav.reports',
      label: 'Mở Báo cáo dự án',
      keywords: 'bao cao du an reports burndown velocity',
      to: `/p/${k}/reports`,
      icon: 'report',
    },
    {
      id: 'nav.gantt',
      label: 'Mở Lịch trình (Gantt)',
      keywords: 'lich trinh gantt timeline',
      to: `/p/${k}/gantt`,
      icon: 'gantt',
    },
  );
  if (input.canTriage)
    out.push({
      id: 'nav.triage',
      label: `Mở ${TRIAGE_TITLE}`,
      keywords: 'viec moi vao triage hop thu intake',
      to: `/p/${k}/triage`,
      icon: 'triage',
    });
  out.push({
    id: 'nav.risks',
    label: `Mở ${MANAGE_LABELS.risks}`,
    keywords: 'rui ro vuong mac risks raid',
    to: `/manage/risks?project=${projectId}`,
    icon: 'risks',
  });
  if (input.canImport)
    out.push({
      id: 'import.excel',
      label: 'Nhập công việc từ Excel',
      keywords: 'nhap cong viec tu excel xlsx import bieu mau hang loat',
      to: configSectionPath(k, 'data'),
      icon: 'import',
    });
  if (input.canAutomation)
    out.push({
      id: 'nav.automation',
      label: `Mở ${CONNECT_LABELS.automation}`,
      keywords: 'tu dong hoa automation quy tac rule',
      to: `/connect/automation?project=${projectId}`,
      icon: 'automation',
    });
  return out;
}
