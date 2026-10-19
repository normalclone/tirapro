import { useState } from 'react';
import { DocsLink } from '@/components/ui/DocsLink';
import { Link } from 'react-router-dom';
import { AlarmClock, Plus, Trash2, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import { apiErrorMessage } from '@/lib/api';
import { PageFrame } from '@/components/layout/PageFrame';
import { PageHeader } from '@/components/layout/PageHeader';
import { SectionCard } from '@/components/ui/SectionCard';
import { Avatar, Badge, EmptyState, Skeleton } from '@/components/ui/primitives';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { useConfirm } from '@/components/ui/useConfirm';
import { Input } from '@/components/ui/Input';
import { SearchSelect } from '@/components/ui/SearchSelect';
import { useAuth } from '@/stores/auth';
import { useProjects } from '@/features/projects/api';
import { cn } from '@/lib/utils';
import { QueryBoundary } from '@/components/ui/QueryBoundary';
import { fmtDateTime } from '@/lib/dateFormat';
import {
  useSlaBoard,
  useSlaPolicies,
  useCreateSlaPolicy,
  useUpdateSlaPolicy,
  useDeleteSlaPolicy,
  fmtMins,
  type SlaPolicyDto,
  type SlaBoardRow,
  SLA_SOON_MINS,
  SLA_SOON_LABEL,
} from './api';
import { PriorityIcon } from '@/components/ui/PriorityIcon';
import { usePriorityRanks } from '@/features/issue-meta/usePriorityRanks';
import { MANAGE_LABELS, SETTINGS_LABELS } from '@/lib/navLabels';

/** Bảng theo dõi công việc sắp trễ / đã trễ hạn cam kết (dùng trong mục Danh mục). */
export function SlaBoardPage() {
  return (
    <PageFrame size="xl">
      <PageHeader
        title={MANAGE_LABELS.responseTime}
        description="Công việc đang chạy đồng hồ theo cam kết; sắp tới hạn tô vàng, quá hạn tô đỏ."
      />
      <SlaBoard />
    </PageFrame>
  );
}

/** Cấu hình cam kết thời gian xử lý (dùng trong Cài đặt). */
export function SlaPoliciesPage() {
  const canManage = useAuth((s) => s.can('sla:manage'));
  const [open, setOpen] = useState(false);
  return (
    <PageFrame size="sm">
      <PageHeader
        title={SETTINGS_LABELS.responseTime}
        description={
          <>
            Đặt thời hạn phản hồi và xử lý xong cho từng nhóm công việc.{' '}
            <DocsLink anchor="quan-ly-nang-cao" />
          </>
        }
        actions={
          canManage ? (
            <Button size="sm" onClick={() => setOpen(true)}>
              <Plus className="h-4 w-4" /> Thêm cam kết
            </Button>
          ) : undefined
        }
      />
      <SlaPolicies canManage={canManage} open={open} onOpenChange={setOpen} />
    </PageFrame>
  );
}

function SlaBoard() {
  const boardQuery = useSlaBoard();
  return (
    <QueryBoundary
      query={boardQuery}
      skeleton={
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      }
      empty={(d) => d.length === 0}
      emptyState={
        <EmptyState
          icon={<AlarmClock className="h-6 w-6" />}
          title="Chưa có công việc nào đang tính giờ"
          description="Đồng hồ chỉ chạy với công việc khớp một cam kết đang bật. Hãy đặt cam kết thời gian xử lý trong Cài đặt để bắt đầu theo dõi."
        />
      }
    >
      {(rows) => <SlaBoardTable rows={rows} />}
    </QueryBoundary>
  );
}

function SlaBoardTable({ rows }: { rows: SlaBoardRow[] }) {
  const ranks = usePriorityRanks();
  const breached = rows.filter((r) => r.resolveBreached).length;
  const soon = rows.filter((r) => !r.resolveBreached && r.remainingMins <= SLA_SOON_MINS).length;

  return (
    <SectionCard
      title="Đang chạy đồng hồ"
      description="Đồng hồ chạy từ lúc công việc được tạo cho tới khi xử lý xong."
      bare
      actions={
        <>
          <span className="text-sm text-muted">{rows.length} công việc</span>
          {breached > 0 && (
            <Badge className="bg-danger/10 text-danger">{breached} đã quá hạn</Badge>
          )}
          {soon > 0 && (
            <Badge className="bg-warning/15 text-warning">
              {soon} {SLA_SOON_LABEL}
            </Badge>
          )}
        </>
      }
    >
      <ul className="divide-y divide-border">
        {rows.map((r) => {
          const late = r.resolveBreached;
          const soonRow = !late && r.remainingMins <= SLA_SOON_MINS;
          return (
            <li key={r.issueId} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-5 py-3">
              <Link
                to={`/issue/${r.key}`}
                className="shrink-0 font-mono text-xs text-primary hover:underline"
              >
                {r.key}
              </Link>
              <span className="min-w-0 flex-1 truncate text-sm text-ink">{r.summary}</span>
              {r.priority && (
                <span className="hidden shrink-0 items-center text-xs text-muted sm:flex">
                  <PriorityIcon
                    withLabel
                    name={r.priority.name}
                    rank={r.priority.rank}
                    ranks={ranks}
                    color={r.priority.color}
                  />
                </span>
              )}
              <span
                className="hidden shrink-0 text-xs text-faint md:inline"
                title="Cam kết thời gian xử lý đang áp dụng cho công việc này."
              >
                {r.policyName}
              </span>
              {!r.responded && <Badge className="bg-surface-2 text-muted">chưa phản hồi</Badge>}
              <span
                className={cn(
                  'shrink-0 rounded px-1.5 py-0.5 text-xs font-medium',
                  late
                    ? 'bg-danger/10 text-danger'
                    : soonRow
                      ? 'bg-warning/15 text-warning'
                      : 'bg-surface-2 text-muted',
                )}
                title={
                  late
                    ? `Đã quá hạn xử lý. Hạn là ${fmtDateTime(r.resolveDueAt)}.`
                    : `Thời gian còn lại trước khi phải xử lý xong, hạn là ${fmtDateTime(r.resolveDueAt)}.`
                }
              >
                {late ? (
                  <span className="inline-flex items-center gap-1">
                    <TriangleAlert className="h-3 w-3" /> quá hạn {fmtMins(r.remainingMins)}
                  </span>
                ) : (
                  `còn ${fmtMins(r.remainingMins)}`
                )}
              </span>
              {r.assignee ? (
                <span
                  className="flex shrink-0 items-center gap-1.5"
                  title={`Người xử lý: ${r.assignee.displayName}`}
                >
                  <Avatar name={r.assignee.displayName} src={r.assignee.avatarUrl} size={20} />
                </span>
              ) : (
                <span
                  className="shrink-0 text-[11px] text-faint"
                  title="Chưa ai nhận việc này — hãy giao người để đồng hồ có chủ."
                >
                  Chưa giao
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </SectionCard>
  );
}

function SlaPolicies({
  canManage,
  open,
  onOpenChange,
}: {
  canManage: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const policiesQuery = useSlaPolicies();
  const { data } = policiesQuery;
  const { data: projects } = useProjects();
  const create = useCreateSlaPolicy();
  const update = useUpdateSlaPolicy();
  const remove = useDeleteSlaPolicy();
  const confirm = useConfirm();
  const [name, setName] = useState('');
  const [projectId, setProjectId] = useState('');
  const [responseH, setResponseH] = useState('4');
  const [resolveH, setResolveH] = useState('24');

  const list = data ?? [];

  function submit() {
    const n = name.trim();
    if (!n) return toast.error('Hãy nhập tên cam kết để dễ nhận ra sau này');
    create.mutate(
      {
        name: n,
        projectId: projectId || null,
        responseMins: Math.max(1, Math.round(Number(responseH) * 60)),
        resolveMins: Math.max(1, Math.round(Number(resolveH) * 60)),
      },
      {
        onSuccess: () => {
          toast.success('Đã tạo cam kết');
          onOpenChange(false);
          setName('');
          setProjectId('');
        },
        onError: (e) => toast.error(apiErrorMessage(e)),
      },
    );
  }

  return (
    <SectionCard
      title="Danh sách cam kết"
      description="Mỗi cam kết áp cho một dự án cụ thể, hoặc cho mọi dự án nếu bạn không chọn dự án nào."
    >
      <QueryBoundary
        query={policiesQuery}
        skeleton={
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        }
        empty={() => list.length === 0}
        emptyState={
          <EmptyState
            icon={<AlarmClock className="h-6 w-6" />}
            title="Chưa đặt cam kết nào"
            description={
              canManage
                ? 'Cam kết là thời hạn bạn tự đặt cho việc phản hồi và xử lý xong. Tạo cam kết đầu tiên để hệ thống bắt đầu bấm giờ.'
                : 'Cam kết là thời hạn cho việc phản hồi và xử lý xong. Quản trị viên chưa đặt cam kết nào.'
            }
          />
        }
      >
        {() => (
          <ul className="divide-y divide-border">
            {list.map((p: SlaPolicyDto) => (
              <li
                key={p.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-3 first:pt-0 last:pb-0"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-ink-strong">
                    {p.name}
                  </span>
                  <span className="block truncate text-xs text-muted">
                    {p.project ? `Dự án ${p.project.key}` : 'Mọi dự án'}
                    {p.priority ? ` · ${p.priority.name}` : ''}
                  </span>
                </span>
                <span
                  className="shrink-0 text-xs text-muted"
                  title="Tính từ lúc công việc được tạo, phải có phản hồi đầu tiên trong khoảng này."
                >
                  Phản hồi trong <b className="text-ink">{fmtMins(p.responseMins)}</b>
                </span>
                <span
                  className="shrink-0 text-xs text-muted"
                  title="Tính từ lúc công việc được tạo, phải xử lý xong trong khoảng này."
                >
                  Xử lý xong trong <b className="text-ink">{fmtMins(p.resolveMins)}</b>
                </span>
                <Badge
                  className={p.active ? 'bg-success/10 text-success' : 'bg-surface-2 text-muted'}
                >
                  {p.active ? 'Đang áp dụng' : 'Đang tắt'}
                </Badge>
                {canManage && (
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      title={
                        p.active
                          ? 'Ngừng bấm giờ cho công việc mới khớp cam kết này'
                          : 'Bấm giờ trở lại cho công việc mới khớp cam kết này'
                      }
                      aria-label={p.active ? `Tắt cam kết ${p.name}` : `Bật cam kết ${p.name}`}
                      onClick={() =>
                        update.mutate(
                          { id: p.id, active: !p.active },
                          { onError: (e) => toast.error(apiErrorMessage(e)) },
                        )
                      }
                    >
                      {p.active ? 'Tắt' : 'Bật'}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-muted hover:text-danger"
                      title="Xoá cam kết"
                      aria-label={`Xoá cam kết ${p.name}`}
                      onClick={async () => {
                        if (
                          !(await confirm({
                            title: `Xoá cam kết “${p.name}”?`,
                            description:
                              'Các công việc đang tính giờ theo cam kết này sẽ ngừng được theo dõi.',
                            destructive: true,
                          }))
                        )
                          return;
                        remove.mutate(p.id, { onError: (e) => toast.error(apiErrorMessage(e)) });
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </QueryBoundary>

      <Dialog
        open={open}
        onOpenChange={onOpenChange}
        title="Thêm cam kết thời gian"
        onSubmit={submit}
        footer={
          <>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Huỷ
            </Button>
            <Button onClick={submit} loading={create.isPending} disabled={!name.trim()}>
              Tạo cam kết
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-muted">Tên cam kết</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ví dụ: Hỗ trợ tiêu chuẩn"
              title="Tên hiện trên bảng theo dõi để bạn biết công việc đang chạy theo cam kết nào."
              autoFocus
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-muted">
              Dự án <span className="font-normal text-faint">(để trống = áp cho mọi dự án)</span>
            </label>
            <SearchSelect
              value={projectId}
              onChange={setProjectId}
              options={[
                { value: '', label: 'Mọi dự án' },
                ...(projects ?? []).map((p) => ({ value: p.id, label: p.name, hint: p.key })),
              ]}
              placeholder="Mọi dự án"
              searchPlaceholder="Tìm dự án…"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-muted">
                Phải phản hồi trong (giờ)
              </label>
              <Input
                type="number"
                min={0.5}
                step={0.5}
                value={responseH}
                onChange={(e) => setResponseH(e.target.value)}
                title="Tính từ lúc công việc được tạo cho tới phản hồi đầu tiên."
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-muted">
                Phải xử lý xong trong (giờ)
              </label>
              <Input
                type="number"
                min={1}
                step={1}
                value={resolveH}
                onChange={(e) => setResolveH(e.target.value)}
                title="Tính từ lúc công việc được tạo cho tới khi chuyển sang trạng thái đã xong."
              />
            </div>
          </div>
        </div>
      </Dialog>
    </SectionCard>
  );
}
