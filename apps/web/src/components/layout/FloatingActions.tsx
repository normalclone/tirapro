import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { Plus, FolderPlus, Search, Sparkles, Bug, Eye, EyeOff, X, Settings2, Check } from 'lucide-react';
import { toast } from 'sonner';
import { useProject, useProjects } from '@/features/projects/api';
import { useIssue } from '@/features/issues/api';
import { useToggleWatch, useWatchState } from '@/features/issue-widgets/api';
import { useAi } from '@/stores/ai';
import { useQuickActions, type QuickActionKey } from '@/stores/quickActions';
import { useCreateIssueModal } from '@/stores/createIssue';
import { CreateProjectModal } from '@/features/projects/CreateProjectModal';
import { GenerateIssuesDialog } from '@/features/ai/GenerateIssuesDialog';
import { ReportIssueModal } from '@/features/intake/ReportIssueModal';
import { apiErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';

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

interface QuickAction {
  key: QuickActionKey;
  icon: ReactNode;
  label: string;
  kbd?: string;
  onClick: () => void;
}

/** Nhãn cho trình tuỳ biến (tất cả tác vụ, kèm ghi chú ngữ cảnh). */
const ACTION_META: { key: QuickActionKey; label: string; hint?: string }[] = [
  { key: 'issue', label: 'Tạo issue' },
  { key: 'ai', label: 'Tạo bằng AI', hint: 'trong dự án' },
  { key: 'report', label: 'Báo lỗi', hint: 'trong dự án' },
  { key: 'watch', label: 'Theo dõi', hint: 'trong trang issue' },
  { key: 'project', label: 'Tạo dự án' },
  { key: 'command', label: 'Lệnh nhanh' },
];

export function FloatingActions() {
  const loc = useLocation();
  const openCreate = useCreateIssueModal((s) => s.openCreate);
  const aiEnabled = useAi((s) => s.enabled);
  const { enabled, toggle } = useQuickActions();
  const projectKey = projectKeyFromPath(loc.pathname);
  const issueKey = issueKeyFromPath(loc.pathname);
  const { data: issue } = useIssue(issueKey || null);
  const { data: projects } = useProjects();
  const { data: projectByKey } = useProject(projectKey);
  // Trên /p/:key dùng key; trên trang issue resolve project theo projectId của issue.
  const project = projectByKey ?? (issue ? projects?.find((p) => p.id === issue.projectId) ?? null : null);
  const issueId = issue?.id ?? '';
  const { data: watchState } = useWatchState(issueId);
  const watchToggle = useToggleWatch(issueId);

  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [customizing, setCustomizing] = useState(false);
  const [createProject, setCreateProject] = useState(false);
  const [genAi, setGenAi] = useState(false);
  const [report, setReport] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout>>();

  const hasProject = !!project?.id;
  const onIssue = !!issueId;
  const watching = watchState?.watching ?? false;
  // Tạo issue = mở TRANG tạo (không còn popup). Dùng dự án hiện tại, fallback dự án đầu tiên.
  const createTargetKey = project?.key ?? projects?.[0]?.key ?? '';

  // Đóng có chuyển động: chạy animate-out rồi mới unmount. Fallback tức thời khi
  // người dùng ưu tiên giảm chuyển động (đã có motion-reduce trên phần tử con).
  const close = useCallback(() => {
    setClosing(true);
    clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => {
      setOpen(false);
      setClosing(false);
      setCustomizing(false);
    }, 140);
  }, []);

  useEffect(() => () => clearTimeout(closeTimer.current), []);

  const run = (fn: () => void) => () => {
    // Thực thi tác vụ đóng ngay (mở modal…), không cần chờ hiệu ứng đóng.
    clearTimeout(closeTimer.current);
    setOpen(false);
    setClosing(false);
    setCustomizing(false);
    fn();
  };

  // Tác vụ khả dụng theo ngữ cảnh, lọc theo tuỳ chọn người dùng.
  const actions: QuickAction[] = [
    enabled.issue && {
      key: 'issue',
      icon: <Plus className="h-5 w-5" />,
      label: 'Tạo issue',
      onClick: run(() => {
        if (createTargetKey) openCreate({ projectKey: createTargetKey });
        else toast.error('Hãy tạo dự án trước khi tạo issue');
      }),
    },
    hasProject && aiEnabled && enabled.ai && { key: 'ai', icon: <Sparkles className="h-5 w-5 text-primary" />, label: 'Tạo bằng AI', onClick: run(() => setGenAi(true)) },
    hasProject && enabled.report && { key: 'report', icon: <Bug className="h-5 w-5" />, label: 'Báo lỗi', onClick: run(() => setReport(true)) },
    onIssue && enabled.watch && {
      key: 'watch',
      icon: watching ? <Eye className="h-5 w-5 text-primary" /> : <EyeOff className="h-5 w-5" />,
      label: watching ? 'Bỏ theo dõi' : 'Theo dõi',
      onClick: run(() =>
        watchToggle.mutateAsync(watching).catch((e: unknown) => toast.error(apiErrorMessage(e))),
      ),
    },
    enabled.project && { key: 'project', icon: <FolderPlus className="h-5 w-5" />, label: 'Tạo dự án', onClick: run(() => setCreateProject(true)) },
    enabled.command && { key: 'command', icon: <Search className="h-5 w-5" />, label: 'Lệnh nhanh', kbd: '⌘K', onClick: run(() => window.dispatchEvent(new Event('tirapro:command'))) },
  ].filter(Boolean) as QuickAction[];

  return (
    <>
      {open && (
        <button
          type="button"
          aria-label="Đóng menu thao tác"
          onClick={close}
          className="fixed inset-0 z-sticky cursor-default bg-transparent"
        />
      )}

      <div className="fixed bottom-6 right-6 z-sticky flex flex-col items-end gap-3">
        {open && customizing && (
          <div
            className={cn(
              'w-64 rounded-lg border border-border bg-surface p-2 shadow-lg',
              'origin-bottom-right animate-in fade-in zoom-in-95 duration-[120ms] ease-out-quart',
              'motion-reduce:animate-none motion-reduce:zoom-in-100',
            )}
          >
            <p className="px-2 py-1 text-xs font-semibold uppercase tracking-wide text-faint">Tuỳ biến nút nổi</p>
            <ul>
              {ACTION_META.map((m) => (
                <li key={m.key}>
                  <button
                    type="button"
                    onClick={() => toggle(m.key)}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-ink',
                      'transition-colors hover:bg-surface-2',
                      'active:bg-surface-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
                    )}
                    aria-pressed={enabled[m.key]}
                  >
                    <span
                      className={cn(
                        'grid h-4 w-4 shrink-0 place-items-center rounded border',
                        enabled[m.key] ? 'border-primary bg-primary text-primary-fg' : 'border-border',
                      )}
                    >
                      {enabled[m.key] && <Check className="h-3 w-3" />}
                    </span>
                    <span className="flex-1">{m.label}</span>
                    {m.hint && <span className="text-[11px] text-faint">{m.hint}</span>}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {open && !customizing && (
          <ul className="flex flex-col items-end gap-2">
            {actions.map((a, i) => (
              <li key={a.key} className="flex justify-end">
                <ActionButton
                  onClick={a.onClick}
                  label={a.label}
                  kbd={a.kbd}
                  icon={a.icon}
                  index={i}
                  closing={closing}
                />
              </li>
            ))}
            {/* Tuỳ biến */}
            <li className="flex justify-end">
              <ActionButton
                onClick={() => setCustomizing(true)}
                label="Tuỳ biến"
                icon={<Settings2 className="h-5 w-5" />}
                index={actions.length}
                closing={closing}
                dashed
                muted
              />
            </li>
          </ul>
        )}

        <button
          type="button"
          onClick={() => {
            if (open) {
              close();
            } else {
              setCustomizing(false);
              setClosing(false);
              setOpen(true);
            }
          }}
          aria-expanded={open}
          aria-label={open ? 'Đóng thao tác nhanh' : 'Thao tác nhanh'}
          title="Thao tác nhanh"
          className={cn(
            'grid h-14 w-14 place-items-center rounded-full bg-primary text-primary-fg shadow-lg',
            'transition-[background-color,transform] duration-[120ms] ease-out-quart',
            'hover:bg-primary-hover active:scale-95',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
            'motion-reduce:transition-none motion-reduce:active:scale-100',
          )}
        >
          <span
            className={cn(
              'grid place-items-center transition-transform duration-[120ms] ease-out-quart motion-reduce:transition-none',
              open && !closing ? 'rotate-45' : 'rotate-0',
            )}
          >
            {open && !closing ? <X className="h-6 w-6" /> : <Plus className="h-6 w-6" />}
          </span>
        </button>
      </div>

      <CreateProjectModal open={createProject} onClose={() => setCreateProject(false)} />
      {hasProject && (
        <>
          <ReportIssueModal projectKey={project!.key} projectId={project!.id} open={report} onClose={() => setReport(false)} />
          {aiEnabled && (
            <GenerateIssuesDialog projectKey={project!.key} projectId={project!.id} open={genAi} onClose={() => setGenAi(false)} />
          )}
        </>
      )}
    </>
  );
}

interface ActionButtonProps {
  onClick: () => void;
  label: string;
  icon: ReactNode;
  kbd?: string;
  /** Vị trí trong danh sách — dùng để so le hiệu ứng vào/ra. */
  index: number;
  /** Đang chạy hiệu ứng đóng: trượt xuống + mờ dần trước khi unmount. */
  closing: boolean;
  dashed?: boolean;
  muted?: boolean;
}

/**
 * Một tác vụ nhanh = MỘT <button> gồm nhãn (pill) + nút tròn biểu tượng, canh phải.
 * Bấm vào chữ hoạt động y như bấm vào biểu tượng.
 *
 * Reveal ổn định (không giật): dùng transition transform+opacity kích hoạt một lần
 * khi mount (state `shown`) thay vì keyframe `animate-in` — re-render giữ nguyên
 * trạng thái đích nên không tái khởi động hiệu ứng. So le bằng transition-delay.
 * Có fallback `motion-reduce`: hiện/ẩn tức thời, không transform.
 */
function ActionButton({ onClick, label, icon, kbd, index, closing, dashed, muted }: ActionButtonProps) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const visible = shown && !closing;
  const delay = closing ? 0 : index * 28;

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      style={{ transitionDelay: `${delay}ms`, willChange: 'transform, opacity' }}
      className={cn(
        'group flex items-center gap-2 rounded-full outline-none',
        'transition-[opacity,transform] duration-[180ms] ease-out-quart',
        visible ? 'translate-y-0 opacity-100' : 'translate-y-1.5 opacity-0',
        'motion-reduce:transition-none motion-reduce:translate-y-0',
      )}
    >
      <span
        className={cn(
          'flex items-center gap-1.5 rounded-md border bg-surface px-2.5 py-1 text-sm font-medium shadow-sm',
          'transition-colors duration-[120ms] ease-out-quart motion-reduce:transition-none',
          muted ? 'border-border text-muted group-hover:text-ink' : 'border-border text-ink',
          'group-hover:bg-surface-2',
        )}
      >
        {label}
        {kbd && <kbd className="rounded bg-surface-2 px-1 font-mono text-[10px] text-muted">{kbd}</kbd>}
      </span>
      <span
        className={cn(
          'grid h-11 w-11 shrink-0 place-items-center rounded-full border bg-surface shadow-md',
          'transition-[background-color,transform] duration-[120ms] ease-out-quart',
          'group-hover:bg-surface-2 group-active:scale-95',
          'group-focus-visible:ring-2 group-focus-visible:ring-[var(--ring)]',
          'motion-reduce:transition-none motion-reduce:group-active:scale-100',
          dashed ? 'border-dashed border-border' : 'border-border',
          muted ? 'text-muted group-hover:text-ink' : 'text-ink',
        )}
      >
        {icon}
      </span>
    </button>
  );
}
