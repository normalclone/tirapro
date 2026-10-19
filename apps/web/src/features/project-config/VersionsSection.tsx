import { useRef, useState } from 'react';
import { Tag, Plus, Pencil, Trash2, Check, X, Rocket } from 'lucide-react';
import { toast } from 'sonner';
import { Badge, EmptyState, Skeleton } from '@/components/ui/primitives';
import { useConfirm } from '@/components/ui/useConfirm';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { DateInput } from '@/components/ui/DateInput';
import { apiErrorMessage } from '@/lib/api';
import {
  useVersions,
  useCreateVersion,
  useUpdateVersion,
  useDeleteVersion,
  type Version,
  type VersionStatus,
  type VersionUpdateInput,
} from './api';
import { QueryBoundary } from '@/components/ui/QueryBoundary';
import { SectionCard } from '@/components/ui/SectionCard';
import { blockOnInvalidDate } from '@/lib/dateGuard';
import { SegmentedControl } from '@/components/ui/SegmentedControl';

/** Nhãn + style cho từng trạng thái phiên bản. */
const VERSION_STATUS: Record<VersionStatus, { label: string; className: string }> = {
  UNRELEASED: { label: 'Chưa phát hành', className: 'bg-surface-2 text-muted' },
  RELEASED: { label: 'Đã phát hành', className: 'bg-primary-subtle text-primary' },
  ARCHIVED: { label: 'Lưu trữ', className: 'bg-surface-2 text-faint' },
};

const STATUS_OPTIONS: VersionStatus[] = ['UNRELEASED', 'RELEASED', 'ARCHIVED'];

/** Chuẩn hoá ISO string → giá trị input type=date (yyyy-mm-dd). */
function toDateInput(iso?: string | null): string {
  return iso ? iso.slice(0, 10) : '';
}

/** input type=date (yyyy-mm-dd) → ISO string để gửi lên API; rỗng → undefined. */
function toIso(value: string): string | undefined {
  if (!value) return undefined;
  return new Date(value).toISOString();
}

/* ------------------------------------------------------------------ */
/* Section — Phiên bản (Versions)                                      */
/* ------------------------------------------------------------------ */

export function VersionsSection({
  projectId,
  canAdmin,
}: {
  projectId?: string;
  canAdmin: boolean;
}) {
  const confirm = useConfirm();
  const versionsQuery = useVersions(projectId);
  const { data } = versionsQuery;
  const create = useCreateVersion(projectId ?? '');
  const update = useUpdateVersion(projectId ?? '');
  const remove = useDeleteVersion(projectId ?? '');

  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<VersionStatus>('UNRELEASED');
  const [editingId, setEditingId] = useState<string | null>(null);

  const versions = data ?? [];

  function resetAdd() {
    setName('');
    setDescription('');
    setStatus('UNRELEASED');
    setAdding(false);
  }

  function submitAdd() {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error('Vui lòng nhập tên phiên bản.');
      return;
    }
    const desc = description.trim();
    create.mutate(
      { name: trimmed, description: desc || undefined, status },
      { onSuccess: resetAdd, onError: (e) => toast.error(apiErrorMessage(e)) },
    );
  }

  function patch(id: string, body: VersionUpdateInput, onDone?: () => void) {
    update.mutate(
      { id, patch: body },
      { onSuccess: () => onDone?.(), onError: (e) => toast.error(apiErrorMessage(e)) },
    );
  }

  function handleRelease(v: Version) {
    patch(v.id, { status: 'RELEASED', releaseDate: new Date().toISOString() });
  }

  async function handleDelete(v: Version) {
    if (
      !(await confirm({
        title: `Xoá phiên bản "${v.name}"? Hành động này không thể hoàn tác.`,
        destructive: true,
      }))
    )
      return;
    remove.mutate(v.id, { onError: (e) => toast.error(apiErrorMessage(e)) });
  }

  return (
    <SectionCard
      icon={<Tag className="h-4 w-4" />}
      title="Phiên bản"
      description="Theo dõi các mốc phát hành (release) của dự án."
    >
      <QueryBoundary
        query={versionsQuery}
        skeleton={
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-11 w-full" />
            ))}
          </div>
        }
        empty={() => versions.length === 0 && !adding}
        emptyState={
          <EmptyState
            icon={<Tag className="h-6 w-6" />}
            title="Chưa có phiên bản nào"
            description="Thêm phiên bản đầu tiên để lập kế hoạch phát hành."
            action={
              canAdmin ? (
                <Button size="sm" onClick={() => setAdding(true)} disabled={!projectId}>
                  <Plus className="h-4 w-4" />
                  Thêm phiên bản
                </Button>
              ) : undefined
            }
          />
        }
      >
        {() => (
          <ul className="divide-y divide-border">
            {versions.map((v) =>
              editingId === v.id ? (
                <VersionEditRow
                  key={v.id}
                  version={v}
                  saving={update.isPending}
                  onCancel={() => setEditingId(null)}
                  onSave={(body) => patch(v.id, body, () => setEditingId(null))}
                />
              ) : (
                <li key={v.id} className="flex flex-wrap items-center gap-3 py-2.5 first:pt-0">
                  <span className="truncate text-sm font-medium text-ink">{v.name}</span>
                  <Badge className={VERSION_STATUS[v.status].className}>
                    {VERSION_STATUS[v.status].label}
                  </Badge>
                  {v.releaseDate && (
                    <span className="font-mono text-xs text-faint">
                      {toDateInput(v.releaseDate)}
                    </span>
                  )}

                  {canAdmin && (
                    <div className="ml-auto flex items-center gap-1">
                      {v.status !== 'RELEASED' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleRelease(v)}
                          loading={update.isPending}
                          title="Đánh dấu đã phát hành"
                        >
                          <Rocket className="h-4 w-4" />
                          Phát hành
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setEditingId(v.id)}
                        title="Chỉnh sửa"
                      >
                        <Pencil className="h-4 w-4" />
                        <span className="sr-only">Chỉnh sửa {v.name}</span>
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDelete(v)}
                        title="Xoá"
                        className="text-muted hover:text-danger"
                      >
                        <Trash2 className="h-4 w-4" />
                        <span className="sr-only">Xoá {v.name}</span>
                      </Button>
                    </div>
                  )}
                </li>
              ),
            )}
          </ul>
        )}
      </QueryBoundary>

      {canAdmin &&
        (adding ? (
          <div className="mt-4 rounded-md border border-border bg-surface-2 p-3">
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-[10rem] flex-1">
                <label htmlFor="ver-name" className="mb-1 block text-xs font-medium text-muted">
                  Tên
                </label>
                <Input
                  id="ver-name"
                  value={name}
                  autoFocus
                  placeholder="VD: 1.0.0"
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') submitAdd();
                    if (e.key === 'Escape') resetAdd();
                  }}
                />
              </div>
              <div className="min-w-[12rem] flex-1">
                <label htmlFor="ver-desc" className="mb-1 block text-xs font-medium text-muted">
                  Mô tả
                </label>
                <Input
                  id="ver-desc"
                  value={description}
                  placeholder="Tuỳ chọn"
                  onChange={(e) => setDescription(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') submitAdd();
                    if (e.key === 'Escape') resetAdd();
                  }}
                />
              </div>
              <div>
                <span id="ver-status-label" className="mb-1 block text-xs font-medium text-muted">
                  Trạng thái
                </span>
                <StatusSelect
                  ariaLabelledby="ver-status-label"
                  value={status}
                  onChange={(s) => setStatus(s)}
                />
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" onClick={submitAdd} loading={create.isPending}>
                  Lưu
                </Button>
                <Button size="sm" variant="ghost" onClick={resetAdd} disabled={create.isPending}>
                  Huỷ
                </Button>
              </div>
            </div>
          </div>
        ) : (
          versions.length > 0 && (
            <Button
              variant="secondary"
              size="sm"
              className="mt-4"
              onClick={() => setAdding(true)}
              disabled={!projectId}
            >
              <Plus className="h-4 w-4" />
              Thêm phiên bản
            </Button>
          )
        ))}
    </SectionCard>
  );
}

function VersionEditRow({
  version,
  saving,
  onSave,
  onCancel,
}: {
  version: Version;
  saving: boolean;
  onSave: (body: VersionUpdateInput) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(version.name);
  const [description, setDescription] = useState(version.description ?? '');
  const [status, setStatus] = useState<VersionStatus>(version.status);
  const [releaseDate, setReleaseDate] = useState(toDateInput(version.releaseDate));
  const rowRef = useRef<HTMLLIElement>(null);

  function save() {
    if (blockOnInvalidDate(rowRef.current)) return;
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error('Tên không được để trống.');
      return;
    }
    onSave({
      name: trimmed,
      description: description.trim(),
      status,
      releaseDate: toIso(releaseDate),
    });
  }

  return (
    <li ref={rowRef} className="flex flex-wrap items-end gap-3 py-3 first:pt-0">
      <div className="min-w-[9rem] flex-1">
        <label className="mb-1 block text-xs font-medium text-muted">Tên</label>
        <Input
          value={name}
          autoFocus
          aria-label="Tên phiên bản"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') save();
            if (e.key === 'Escape') onCancel();
          }}
        />
      </div>
      <div className="min-w-[10rem] flex-1">
        <label className="mb-1 block text-xs font-medium text-muted">Mô tả</label>
        <Input
          value={description}
          aria-label="Mô tả phiên bản"
          placeholder="Tuỳ chọn"
          onChange={(e) => setDescription(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') save();
            if (e.key === 'Escape') onCancel();
          }}
        />
      </div>
      <div>
        <span id="ver-edit-status-label" className="mb-1 block text-xs font-medium text-muted">
          Trạng thái
        </span>
        <StatusSelect
          ariaLabelledby="ver-edit-status-label"
          value={status}
          onChange={(s) => setStatus(s)}
        />
      </div>
      <div className="w-40">
        <label className="mb-1 block text-xs font-medium text-muted">Ngày phát hành</label>
        <DateInput ariaLabel="Ngày phát hành" value={releaseDate} onChange={setReleaseDate} />
      </div>
      <div className="flex items-center gap-1">
        <Button size="icon" onClick={save} loading={saving} title="Lưu">
          <Check className="h-4 w-4" />
          <span className="sr-only">Lưu</span>
        </Button>
        <Button size="icon" variant="ghost" onClick={onCancel} disabled={saving} title="Huỷ">
          <X className="h-4 w-4" />
          <span className="sr-only">Huỷ</span>
        </Button>
      </div>
    </li>
  );
}

function StatusSelect({
  ariaLabelledby,
  value,
  onChange,
}: {
  ariaLabelledby: string;
  value: VersionStatus;
  onChange: (status: VersionStatus) => void;
}) {
  return (
    <SegmentedControl<VersionStatus>
      ariaLabelledby={ariaLabelledby}
      size="sm"
      value={value}
      onChange={onChange}
      options={STATUS_OPTIONS.map((s) => ({ value: s, label: VERSION_STATUS[s].label }))}
    />
  );
}
