import { useEffect, useMemo, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Lock,
  Pause,
  Pencil,
  Play,
  Plus,
  Trash2,
  Zap,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge, EmptyState, Skeleton } from '@/components/ui/primitives';
import { Button } from '@/components/ui/Button';
import { QueryError } from '@/components/ui/QueryError';
import { SearchSelect } from '@/components/ui/SearchSelect';
import { ConfirmDialog } from '@/features/issues/ConfirmDialog';
import { useProjects } from '@/features/projects/api';
import { useProjectsCan } from '@/features/projects/permissions';
import { useAuth } from '@/stores/auth';
import { RuleEditor } from './RuleEditor';
import { RuleRunLog } from './RuleRunLog';
import {
  RULES_CHECK_BATCH,
  projectIdsToCheck,
  resolveRulesScope,
  nextCheckLimit,
} from './rulesScope';
import {
  ALL_RULES,
  summarizeRule,
  useDeleteRule,
  useRules,
  useUpdateRule,
  type AutomationRule,
} from './rules-api';
import { LOCALE } from '@/lib/locale';

const dateTime = (iso: string) =>
  new Date(iso).toLocaleString(LOCALE, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

/**
 * Quy tắc tự động hoá "Khi… Nếu… Thì…": danh sách, bật/tắt, lần chạy cuối, sửa/xoá, chạy thử và xem lịch sử chạy.
 * Cần quyền `automation:manage` (quy tắc cả workspace cần quyền cấp workspace).
 */
export function RulesPage() {
  const can = useAuth((s) => s.can);
  const canManageWorkspace = can('automation:manage');
  const { data: projects } = useProjects();
  // Quản trị cấp workspace thấy tất cả (không tra quyền từng dự án); người chỉ quản trị một dự án bắt đầu từ dự án đầu tiên
  // CÓ quyền — tra quyền theo từng đợt nhỏ thay vì bắn request cho mọi dự án.
  const [scopeChoice, setScopeChoice] = useState<string | null>(null);
  const [checkLimit, setCheckLimit] = useState(RULES_CHECK_BATCH);
  const projectCan = useProjectsCan(
    projectIdsToCheck({
      projects,
      choice: scopeChoice,
      canWorkspace: canManageWorkspace,
      limit: checkLimit,
    }),
    'automation:manage',
  );
  const nextLimit = nextCheckLimit({
    projects,
    choice: scopeChoice,
    canWorkspace: canManageWorkspace,
    limit: checkLimit,
    projectCan,
  });
  // Phụ thuộc cả `nextLimit` (đổi theo `checkLimit`): đợt kế đã có sẵn trong cache thì `shouldCheckMore` vẫn true nhưng
  // `nextLimit` đổi → effect vẫn chạy tiếp, không kẹt ở skeleton.
  useEffect(() => {
    if (nextLimit !== checkLimit) setCheckLimit(nextLimit);
  }, [nextLimit, checkLimit]);
  const { scope, canManage } = resolveRulesScope({
    choice: scopeChoice,
    canWorkspace: canManageWorkspace,
    projects,
    projectCan,
  });
  // Không có quyền ở phạm vi này → không gọi API (tránh 403 đỏ); đang tải quyền → chờ.
  const { data, isLoading, isError, error, refetch } = useRules(canManage ? scope : undefined);
  const noAccess = canManage === false;
  const update = useUpdateRule();
  const remove = useDeleteRule();

  const [editing, setEditing] = useState<AutomationRule | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [deleting, setDeleting] = useState<AutomationRule | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const projectName = useMemo(() => new Map((projects ?? []).map((p) => [p.id, p])), [projects]);
  const scopeOptions = [
    ...(canManageWorkspace ? [{ value: ALL_RULES, label: 'Tất cả quy tắc' }] : []),
    ...(projects ?? []).map((p) =>
      // Đã biết không có quyền → vô hiệu + nói rõ (chưa tra thì để chọn được, trang sẽ giải thích nếu thiếu quyền).
      projectCan(p.id) === false
        ? { value: p.id, label: p.name, hint: 'không có quyền', disabled: true }
        : { value: p.id, label: p.name, hint: p.key },
    ),
  ];

  function open(rule: AutomationRule | null) {
    setEditing(rule);
    setEditorOpen(true);
  }

  return (
    <section className="rounded-lg border border-border bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-ink-strong">Quy tắc tự động</h2>
          <p className="mt-0.5 text-sm text-muted">
            Khi có sự kiện, nếu thoả điều kiện thì hệ thống tự làm: giao việc, đổi trạng thái, bình
            luận, thông báo… Mỗi lần chạy đều được ghi lại.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-52">
            <SearchSelect
              value={scope ?? ''}
              onChange={setScopeChoice}
              options={scopeOptions}
              placeholder="Chọn phạm vi…"
              searchPlaceholder="Tìm dự án…"
              ariaLabel="Phạm vi quy tắc"
            />
          </div>
          {canManage && (
            <Button size="sm" onClick={() => open(null)}>
              <Plus className="h-4 w-4" /> Tạo quy tắc
            </Button>
          )}
        </div>
      </div>

      <div>
        {noAccess ? (
          <div className="p-5">
            {scope ? (
              <EmptyState
                icon={<Lock className="h-6 w-6" />}
                title="Bạn không có quyền quản lý quy tắc ở dự án này"
                description="Quy tắc tự động chỉ dành cho người có quyền quản lý tự động hoá. Hãy chọn dự án khác ở ô phạm vi, hoặc nhờ quản trị dự án cấp quyền cho bạn."
              />
            ) : (
              <EmptyState
                icon={<Lock className="h-6 w-6" />}
                title="Bạn chưa thuộc dự án nào"
                description="Quy tắc tự động gắn với dự án. Khi được thêm vào một dự án (hoặc tạo dự án mới), bạn sẽ quản lý quy tắc của dự án đó ở đây."
              />
            )}
          </div>
        ) : canManage === undefined || isLoading ? (
          <div className="space-y-2.5 p-5">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : isError ? (
          <div className="p-5">
            <QueryError error={error} onRetry={() => void refetch()} />
          </div>
        ) : !data?.length ? (
          <div className="p-5">
            <EmptyState
              icon={<Zap className="h-6 w-6" />}
              title="Chưa có quy tắc nào"
              description="Ví dụ: khi tạo việc có độ ưu tiên cao thì giao cho trưởng dự án và báo cho cả nhóm; mỗi sáng thứ hai nhắc những việc quá hạn."
              action={
                <Button size="sm" onClick={() => open(null)}>
                  <Plus className="h-4 w-4" /> Tạo quy tắc
                </Button>
              }
            />
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {data.map((r) => {
              const project = r.projectId ? projectName.get(r.projectId) : null;
              const isOpen = expanded === r.id;
              return (
                <li key={r.id}>
                  <div className="flex flex-wrap items-start gap-3 px-5 py-3">
                    <button
                      type="button"
                      className="mt-0.5 rounded p-0.5 text-muted hover:bg-surface-2 hover:text-ink"
                      onClick={() => setExpanded(isOpen ? null : r.id)}
                      aria-expanded={isOpen}
                      aria-label={
                        isOpen ? `Ẩn lịch sử ${r.name}` : `Xem lịch sử và chạy thử ${r.name}`
                      }
                      title="Lịch sử chạy & chạy thử"
                    >
                      {isOpen ? (
                        <ChevronDown className="h-4 w-4" />
                      ) : (
                        <ChevronRight className="h-4 w-4" />
                      )}
                    </button>
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink">
                        {r.name}
                        <Badge
                          className={
                            project ? 'bg-primary-subtle text-primary' : 'bg-surface-2 text-muted'
                          }
                        >
                          {project ? project.key : 'Toàn workspace'}
                        </Badge>
                        <Badge
                          className={
                            r.enabled ? 'bg-success/10 text-success' : 'bg-surface-2 text-muted'
                          }
                        >
                          {r.enabled ? 'Đang bật' : 'Đang tắt'}
                        </Badge>
                      </p>
                      <p className="mt-0.5 text-xs text-muted">{summarizeRule(r)}</p>
                      <p className="mt-0.5 text-xs text-faint">
                        {r.lastRunAt
                          ? `Chạy lần cuối: ${dateTime(r.lastRunAt)} · `
                          : 'Chưa chạy lần nào · '}
                        {r.runCount} lần chạy
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        title={
                          r.enabled
                            ? 'Tắt — quy tắc ngừng chạy'
                            : 'Bật lại — quy tắc chạy ở sự kiện kế tiếp'
                        }
                        aria-label={r.enabled ? `Tắt ${r.name}` : `Bật ${r.name}`}
                        disabled={update.isPending}
                        onClick={() =>
                          update.mutate(
                            { id: r.id, enabled: !r.enabled },
                            {
                              onSuccess: () =>
                                toast.success(r.enabled ? 'Đã tắt quy tắc' : 'Đã bật quy tắc', {
                                  duration: 2000,
                                }),
                            },
                          )
                        }
                      >
                        {r.enabled ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Sửa quy tắc"
                        aria-label={`Sửa ${r.name}`}
                        onClick={() => open(r)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-muted hover:text-danger"
                        title="Xoá quy tắc"
                        aria-label={`Xoá ${r.name}`}
                        onClick={() => setDeleting(r)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  {isOpen && <RuleRunLog rule={r} />}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <RuleEditor
        open={editorOpen}
        rule={editing}
        defaultProjectId={scope && scope !== ALL_RULES ? scope : ''}
        onClose={() => setEditorOpen(false)}
      />

      <ConfirmDialog
        open={!!deleting}
        title={deleting ? `Xoá quy tắc “${deleting.name}”?` : ''}
        description="Quy tắc và lịch sử chạy của nó sẽ bị xoá. Những thay đổi quy tắc đã làm trước đó vẫn giữ nguyên."
        confirmLabel="Xoá quy tắc"
        loading={remove.isPending}
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          if (!deleting) return;
          remove.mutate(deleting.id, {
            onSuccess: () => {
              setDeleting(null);
              toast.success('Đã xoá quy tắc');
            },
          });
        }}
      />
    </section>
  );
}
