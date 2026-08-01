import { useRef, useState, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import {
  Boxes,
  Tag,
  Tags,
  Plus,
  Pencil,
  Trash2,
  Check,
  X,
  Rocket,
  Download,
  Upload,
  History,
  Image as ImageIcon,
  Users,
  SlidersHorizontal,
} from 'lucide-react';
import { toast } from 'sonner';
import { Avatar, Badge, EmptyState, Skeleton } from '@/components/ui/primitives';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { AvatarUploader } from '@/components/ui/AvatarUploader';
import { RoleBadge } from '@/components/ui/RoleBadge';
import { apiErrorMessage } from '@/lib/api';
import { pageContainer } from '@/components/layout/page';
import { cn } from '@/lib/utils';
import { useAuth } from '@/stores/auth';
import { useProject, useUploadProjectAvatar, useRemoveProjectAvatar } from '@/features/projects/api';
import { useRoles } from '@/features/roles/api';
import { EditRolesPopover } from '@/features/members/EditRolesPopover';
import {
  useProjectMembers,
  useRemoveProjectMember,
  useSetProjectMemberRoles,
} from '@/features/members/api';
import {
  useComponents,
  useCreateComponent,
  useUpdateComponent,
  useDeleteComponent,
  useVersions,
  useCreateVersion,
  useUpdateVersion,
  useDeleteVersion,
  useLabels,
  useCreateLabel,
  useUpdateLabel,
  useDeleteLabel,
  useImportJobs,
  useImportCsv,
  useImportJson,
  downloadProjectExport,
  type Component,
  type ComponentUpdateInput,
  type Version,
  type VersionStatus,
  type VersionUpdateInput,
  type Label,
  type LabelUpdateInput,
  type ImportJob,
  type ImportStatus,
  type ImportResult,
} from './api';

/** Màu mặc định cho nhãn mới (token primary). */
const DEFAULT_LABEL_COLOR = '#6366f1';

/** Nhãn + style cho từng trạng thái job import. */
const IMPORT_STATUS: Record<ImportStatus, { label: string; className: string }> = {
  PENDING: { label: 'Chờ xử lý', className: 'bg-surface-2 text-muted' },
  PROCESSING: { label: 'Đang xử lý', className: 'bg-primary-subtle text-primary' },
  COMPLETED: { label: 'Hoàn tất', className: 'bg-success/10 text-success' },
  FAILED: { label: 'Thất bại', className: 'bg-danger/10 text-danger' },
};

/** Định dạng ISO → ngày giờ ngắn gọn theo vi-VN. */
function formatDateTime(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Thông báo kết quả import (created / failed / total). */
function importResultToast(result: ImportResult) {
  const { created, failed, total } = result;
  if (failed > 0) {
    toast.warning(`Đã nhập ${created}/${total} công việc · ${failed} việc lỗi.`);
  } else {
    toast.success(`Đã nhập thành công ${created}/${total} công việc.`);
  }
}

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

/** Khóa nhận diện từng mục cấu hình trong submenu. */
type ConfigSectionId = 'general' | 'members' | 'components' | 'versions' | 'labels' | 'data';

interface ConfigSectionDef {
  id: ConfigSectionId;
  label: string;
  icon: ReactNode;
}

/** Các mục con của Cấu hình (submenu dọc). */
const CONFIG_NAV: ConfigSectionDef[] = [
  { id: 'general', label: 'Chung', icon: <SlidersHorizontal className="h-4 w-4" /> },
  { id: 'members', label: 'Thành viên', icon: <Users className="h-4 w-4" /> },
  { id: 'components', label: 'Thành phần', icon: <Boxes className="h-4 w-4" /> },
  { id: 'versions', label: 'Phiên bản', icon: <Tag className="h-4 w-4" /> },
  { id: 'labels', label: 'Nhãn', icon: <Tags className="h-4 w-4" /> },
  { id: 'data', label: 'Xuất / Nhập dữ liệu', icon: <Download className="h-4 w-4" /> },
];

export function ProjectConfigPage() {
  const { key = '' } = useParams();
  const { data: project } = useProject(key);
  const projectId = project?.id;

  const canAdmin = useAuth((s) => s.can('project:admin'));
  const canImport = useAuth((s) => s.can('import:run'));

  const [active, setActive] = useState<ConfigSectionId>('general');

  return (
    <div className="flex h-full min-h-0 flex-col lg:flex-row">
      {/* Submenu: rail dọc trên desktop, hàng pill cuộn ngang trên mobile */}
      <nav
        aria-label="Mục cấu hình dự án"
        className={cn(
          'shrink-0 border-border bg-surface',
          'flex gap-1 overflow-x-auto border-b px-3 py-2',
          'lg:w-60 lg:flex-col lg:gap-0.5 lg:overflow-y-auto lg:border-b-0 lg:border-r lg:px-3 lg:py-5',
        )}
      >
        <h1 className="hidden px-3 pb-2 text-xs font-semibold uppercase tracking-wide text-faint lg:block">
          Cấu hình
        </h1>
        {CONFIG_NAV.map((item) => {
          const isActive = active === item.id;
          return (
            <button
              key={item.id}
              type="button"
              aria-current={isActive ? 'page' : undefined}
              onClick={() => setActive(item.id)}
              className={cn(
                'flex shrink-0 items-center gap-2.5 whitespace-nowrap rounded-md px-3 py-2 text-left text-sm font-medium transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
                isActive
                  ? 'bg-primary-subtle text-primary'
                  : 'text-muted hover:bg-surface-2 hover:text-ink',
              )}
            >
              {item.icon}
              {item.label}
            </button>
          );
        })}
      </nav>

      <div className="min-w-0 flex-1 overflow-auto">
        <div className={pageContainer('sm')}>
          <header className="mb-8">
            <h1 className="text-2xl font-semibold tracking-tight text-ink-strong">
              {project?.name ?? 'Dự án'}
            </h1>
            <p className="mt-1 text-sm text-muted">
              Cấu hình · {CONFIG_NAV.find((s) => s.id === active)?.label}
            </p>
          </header>

          <div className="space-y-8">
            {active === 'general' && (
              <ProjectAvatarSection
                projectKey={key}
                name={project?.name ?? key}
                src={project?.avatarUrl}
              />
            )}
            {active === 'members' && <MembersSection projectId={projectId} />}
            {active === 'components' && <ComponentsSection projectId={projectId} canAdmin={canAdmin} />}
            {active === 'versions' && <VersionsSection projectId={projectId} canAdmin={canAdmin} />}
            {active === 'labels' && <LabelsSection projectId={projectId} canAdmin={canAdmin} />}
            {active === 'data' && <DataSection projectId={projectId} canImport={canImport} />}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Khung section                                                       */
/* ------------------------------------------------------------------ */

function SectionCard({
  icon,
  title,
  description,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-border bg-surface">
      <div className="flex items-start gap-3 border-b border-border px-5 py-4">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary-subtle text-primary">
          {icon}
        </span>
        <div>
          <h2 className="text-base font-semibold text-ink-strong">{title}</h2>
          {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
        </div>
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Section — Ảnh dự án                                                  */
/* ------------------------------------------------------------------ */

function ProjectAvatarSection({
  projectKey,
  name,
  src,
}: {
  projectKey: string;
  name: string;
  src?: string | null;
}) {
  const upload = useUploadProjectAvatar(projectKey);
  const remove = useRemoveProjectAvatar(projectKey);
  return (
    <SectionCard
      icon={<ImageIcon className="h-4 w-4" />}
      title="Ảnh dự án"
      description="Biểu tượng hiển thị cạnh tên dự án."
    >
      <AvatarUploader
        name={name}
        src={src}
        shape="rounded"
        size={64}
        uploadFn={(f) => upload.mutateAsync(f)}
        onRemove={src ? () => remove.mutateAsync() : undefined}
      />
    </SectionCard>
  );
}

/* ------------------------------------------------------------------ */
/* Section — Thành viên dự án                                          */
/* ------------------------------------------------------------------ */

function MembersSection({ projectId }: { projectId?: string }) {
  const can = useAuth((s) => s.can);
  const canAdmin = can('project:admin');

  // Thành viên dự án = TOÀN BỘ thành viên của không gian làm việc (dự án dùng chung tập người dùng).
  // `isOverride` cho biết vai trò đang là ĐẶT RIÊNG hay MẶC ĐỊNH theo vai trò chung.
  const { data: members, isLoading } = useProjectMembers(projectId);
  const { data: projectRoles } = useRoles('PROJECT');

  const setRoles = useSetProjectMemberRoles(projectId ?? '');
  const clearOverride = useRemoveProjectMember(projectId ?? '');

  const [q, setQ] = useState('');

  const list = members ?? [];
  const roleOptions = (projectRoles ?? []).map((r) => ({ id: r.id, name: r.name, color: r.color }));
  const query = q.trim().toLowerCase();
  const shown = query
    ? list.filter((m) => `${m.user.displayName} ${m.user.email}`.toLowerCase().includes(query))
    : list;

  function handleReset(name: string, uid: string) {
    if (!window.confirm(`Đưa ${name} về vai trò mặc định chung?`)) return;
    clearOverride.mutate(uid, {
      onSuccess: () => toast.success('Đã về vai trò mặc định'),
      onError: (e) => toast.error(apiErrorMessage(e)),
    });
  }

  return (
    <SectionCard
      icon={<Users className="h-4 w-4" />}
      title="Thành viên"
      description="Mọi thành viên của không gian làm việc đều tham gia dự án này. Có thể đặt vai trò riêng cho từng người khi cần."
    >
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : list.length === 0 ? (
        <EmptyState
          icon={<Users className="h-6 w-6" />}
          title="Chưa có thành viên nào"
          description="Thêm người vào không gian làm việc ở trang Thành viên — họ sẽ tự động tham gia mọi dự án."
        />
      ) : (
        <>
          <div className="mb-3 flex items-center justify-between gap-3">
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Tìm thành viên…"
              className="h-9 max-w-xs text-sm"
            />
            <span className="shrink-0 text-sm text-muted">{list.length} người</span>
          </div>
          <ul className="divide-y divide-border">
            {shown.map((m) => (
              <li key={m.user.id} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                <Avatar name={m.user.displayName} src={m.user.avatarUrl} size={32} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink">{m.user.displayName}</p>
                  <p className="truncate text-xs text-faint">{m.user.email}</p>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-1.5">
                  {m.roles.length > 0 ? (
                    m.roles.map((r) => <RoleBadge key={r.id} name={r.name} color={r.color} />)
                  ) : (
                    <span className="text-xs text-faint">Chỉ xem</span>
                  )}
                  <span
                    className={cn(
                      'rounded px-1.5 py-0.5 text-[10px] font-medium',
                      m.isOverride ? 'bg-primary-subtle text-primary' : 'bg-surface-2 text-faint',
                    )}
                    title={m.isOverride ? 'Vai trò đặt riêng cho dự án này' : 'Vai trò mặc định suy từ vai trò chung'}
                  >
                    {m.isOverride ? 'riêng' : 'mặc định'}
                  </span>
                </div>
                {canAdmin && (
                  <div className="flex shrink-0 items-center gap-1">
                    <EditRolesPopover
                      roles={roleOptions}
                      current={m.roles}
                      saving={setRoles.isPending}
                      onSave={(ids) => setRoles.mutateAsync({ userId: m.user.id, roleIds: ids })}
                      trigger={
                        <Button variant="ghost" size="icon" title="Đặt vai trò riêng cho dự án" aria-label={`Đặt vai trò riêng cho ${m.user.displayName}`}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                      }
                    />
                    {m.isOverride && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-muted hover:text-ink"
                        title="Về vai trò mặc định"
                        aria-label={`Đưa ${m.user.displayName} về vai trò mặc định`}
                        onClick={() => handleReset(m.user.displayName, m.user.id)}
                      >
                        <History className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                )}
              </li>
            ))}
            {shown.length === 0 && (
              <li className="py-6 text-center text-sm text-muted">Không tìm thấy ai khớp “{q}”.</li>
            )}
          </ul>
        </>
      )}
    </SectionCard>
  );
}

/* ------------------------------------------------------------------ */
/* Section — Components                                                 */
/* ------------------------------------------------------------------ */

function ComponentsSection({ projectId, canAdmin }: { projectId?: string; canAdmin: boolean }) {
  const { data, isLoading } = useComponents(projectId);
  const create = useCreateComponent(projectId ?? '');
  const update = useUpdateComponent(projectId ?? '');
  const remove = useDeleteComponent(projectId ?? '');

  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);

  const components = data ?? [];

  function resetAdd() {
    setName('');
    setDescription('');
    setAdding(false);
  }

  function submitAdd() {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error('Vui lòng nhập tên thành phần.');
      return;
    }
    const desc = description.trim();
    create.mutate(
      { name: trimmed, description: desc || undefined },
      { onSuccess: resetAdd, onError: (e) => toast.error(apiErrorMessage(e)) },
    );
  }

  function patch(id: string, body: ComponentUpdateInput, onDone?: () => void) {
    update.mutate(
      { id, patch: body },
      { onSuccess: () => onDone?.(), onError: (e) => toast.error(apiErrorMessage(e)) },
    );
  }

  function handleDelete(c: Component) {
    if (!window.confirm(`Xoá thành phần "${c.name}"? Hành động này không thể hoàn tác.`)) return;
    remove.mutate(c.id, { onError: (e) => toast.error(apiErrorMessage(e)) });
  }

  return (
    <SectionCard
      icon={<Boxes className="h-4 w-4" />}
      title="Thành phần"
      description="Chia công việc theo từng phần chức năng hoặc từng khối của dự án."
    >
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-11 w-full" />
          ))}
        </div>
      ) : components.length === 0 && !adding ? (
        <EmptyState
          icon={<Boxes className="h-6 w-6" />}
          title="Chưa có thành phần nào"
          description="Thành phần là một phần chức năng của dự án (vd Đăng nhập, Thanh toán). Thêm thành phần đầu tiên để chia công việc cho gọn."
          action={
            canAdmin ? (
              <Button size="sm" onClick={() => setAdding(true)} disabled={!projectId}>
                <Plus className="h-4 w-4" />
                Thêm thành phần
              </Button>
            ) : undefined
          }
        />
      ) : (
        <ul className="divide-y divide-border">
          {components.map((c) =>
            editingId === c.id ? (
              <ComponentEditRow
                key={c.id}
                component={c}
                saving={update.isPending}
                onCancel={() => setEditingId(null)}
                onSave={(body) => patch(c.id, body, () => setEditingId(null))}
              />
            ) : (
              <li key={c.id} className="flex items-center gap-3 py-2.5 first:pt-0">
                <div className="min-w-0">
                  <span className="block truncate text-sm font-medium text-ink">{c.name}</span>
                  {c.description && (
                    <span className="mt-0.5 block truncate text-xs text-faint">
                      {c.description}
                    </span>
                  )}
                </div>
                {canAdmin && (
                  <div className="ml-auto flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setEditingId(c.id)}
                      title="Chỉnh sửa"
                    >
                      <Pencil className="h-4 w-4" />
                      <span className="sr-only">Chỉnh sửa {c.name}</span>
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleDelete(c)}
                      title="Xoá"
                      className="text-muted hover:text-danger"
                    >
                      <Trash2 className="h-4 w-4" />
                      <span className="sr-only">Xoá {c.name}</span>
                    </Button>
                  </div>
                )}
              </li>
            ),
          )}
        </ul>
      )}

      {canAdmin && (adding ? (
        <div className="mt-4 rounded-md border border-border bg-surface-2 p-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[10rem] flex-1">
              <label htmlFor="comp-name" className="mb-1 block text-xs font-medium text-muted">
                Tên
              </label>
              <Input
                id="comp-name"
                value={name}
                autoFocus
                placeholder="VD: Thanh toán"
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submitAdd();
                  if (e.key === 'Escape') resetAdd();
                }}
              />
            </div>
            <div className="min-w-[12rem] flex-1">
              <label htmlFor="comp-desc" className="mb-1 block text-xs font-medium text-muted">
                Mô tả
              </label>
              <Input
                id="comp-desc"
                value={description}
                placeholder="Tuỳ chọn"
                onChange={(e) => setDescription(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submitAdd();
                  if (e.key === 'Escape') resetAdd();
                }}
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
        components.length > 0 && (
          <Button
            variant="secondary"
            size="sm"
            className="mt-4"
            onClick={() => setAdding(true)}
            disabled={!projectId}
          >
            <Plus className="h-4 w-4" />
            Thêm thành phần
          </Button>
        )
      ))}
    </SectionCard>
  );
}

function ComponentEditRow({
  component,
  saving,
  onSave,
  onCancel,
}: {
  component: Component;
  saving: boolean;
  onSave: (body: ComponentUpdateInput) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(component.name);
  const [description, setDescription] = useState(component.description ?? '');

  function save() {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error('Tên không được để trống.');
      return;
    }
    onSave({ name: trimmed, description: description.trim() });
  }

  return (
    <li className="flex flex-wrap items-end gap-3 py-3 first:pt-0">
      <div className="min-w-[10rem] flex-1">
        <Input
          value={name}
          autoFocus
          aria-label="Tên thành phần"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') save();
            if (e.key === 'Escape') onCancel();
          }}
        />
      </div>
      <div className="min-w-[12rem] flex-1">
        <Input
          value={description}
          aria-label="Mô tả thành phần"
          placeholder="Mô tả (tuỳ chọn)"
          onChange={(e) => setDescription(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') save();
            if (e.key === 'Escape') onCancel();
          }}
        />
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

/* ------------------------------------------------------------------ */
/* Section — Phiên bản (Versions)                                      */
/* ------------------------------------------------------------------ */

function VersionsSection({ projectId, canAdmin }: { projectId?: string; canAdmin: boolean }) {
  const { data, isLoading } = useVersions(projectId);
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

  function handleDelete(v: Version) {
    if (!window.confirm(`Xoá phiên bản "${v.name}"? Hành động này không thể hoàn tác.`)) return;
    remove.mutate(v.id, { onError: (e) => toast.error(apiErrorMessage(e)) });
  }

  return (
    <SectionCard
      icon={<Tag className="h-4 w-4" />}
      title="Phiên bản"
      description="Theo dõi các mốc phát hành (release) của dự án."
    >
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-11 w-full" />
          ))}
        </div>
      ) : versions.length === 0 && !adding ? (
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
      ) : (
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

      {canAdmin && (adding ? (
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
            <div className="w-40">
              <label htmlFor="ver-status" className="mb-1 block text-xs font-medium text-muted">
                Trạng thái
              </label>
              <StatusSelect
                id="ver-status"
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

  function save() {
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
    <li className="flex flex-wrap items-end gap-3 py-3 first:pt-0">
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
      <div className="w-40">
        <label className="mb-1 block text-xs font-medium text-muted">Trạng thái</label>
        <StatusSelect value={status} onChange={(s) => setStatus(s)} />
      </div>
      <div className="w-40">
        <label className="mb-1 block text-xs font-medium text-muted">Ngày phát hành</label>
        <Input
          type="date"
          aria-label="Ngày phát hành"
          value={releaseDate}
          onChange={(e) => setReleaseDate(e.target.value)}
        />
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
  id,
  value,
  onChange,
}: {
  id?: string;
  value: VersionStatus;
  onChange: (status: VersionStatus) => void;
}) {
  return (
    <select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value as VersionStatus)}
      className={cn(
        'h-9 w-full rounded-md border border-border bg-bg px-3 text-sm text-ink',
        'transition-colors duration-150',
        'focus-visible:outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
        'disabled:opacity-50',
      )}
    >
      {STATUS_OPTIONS.map((s) => (
        <option key={s} value={s}>
          {VERSION_STATUS[s].label}
        </option>
      ))}
    </select>
  );
}

/* ------------------------------------------------------------------ */
/* Section — Nhãn (Labels)                                             */
/* ------------------------------------------------------------------ */

function LabelsSection({ projectId, canAdmin }: { projectId?: string; canAdmin: boolean }) {
  const { data, isLoading } = useLabels(projectId);
  const create = useCreateLabel(projectId ?? '');
  const update = useUpdateLabel(projectId ?? '');
  const remove = useDeleteLabel(projectId ?? '');

  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [color, setColor] = useState(DEFAULT_LABEL_COLOR);
  const [editingId, setEditingId] = useState<string | null>(null);

  const labels = data ?? [];

  function resetAdd() {
    setName('');
    setColor(DEFAULT_LABEL_COLOR);
    setAdding(false);
  }

  function submitAdd() {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error('Vui lòng nhập tên nhãn.');
      return;
    }
    create.mutate(
      { name: trimmed, color },
      { onSuccess: resetAdd, onError: (e) => toast.error(apiErrorMessage(e)) },
    );
  }

  function patch(id: string, body: LabelUpdateInput, onDone?: () => void) {
    update.mutate(
      { id, patch: body },
      { onSuccess: () => onDone?.(), onError: (e) => toast.error(apiErrorMessage(e)) },
    );
  }

  function handleDelete(l: Label) {
    if (!window.confirm(`Xoá nhãn "${l.name}"? Hành động này không thể hoàn tác.`)) return;
    remove.mutate(l.id, { onError: (e) => toast.error(apiErrorMessage(e)) });
  }

  return (
    <SectionCard
      icon={<Tags className="h-4 w-4" />}
      title="Nhãn"
      description="Gắn nhãn cho công việc để nhóm và lọc theo cách của riêng bạn."
    >
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-11 w-full" />
          ))}
        </div>
      ) : labels.length === 0 && !adding ? (
        <EmptyState
          icon={<Tags className="h-6 w-6" />}
          title="Chưa có nhãn nào"
          description="Nhãn là từ khoá tự đặt để nhóm và lọc công việc. Thêm nhãn đầu tiên để bắt đầu gắn."
          action={
            canAdmin ? (
              <Button size="sm" onClick={() => setAdding(true)} disabled={!projectId}>
                <Plus className="h-4 w-4" />
                Thêm nhãn
              </Button>
            ) : undefined
          }
        />
      ) : (
        <ul className="divide-y divide-border">
          {labels.map((l) =>
            editingId === l.id ? (
              <LabelEditRow
                key={l.id}
                label={l}
                saving={update.isPending}
                onCancel={() => setEditingId(null)}
                onSave={(body) => patch(l.id, body, () => setEditingId(null))}
              />
            ) : (
              <li key={l.id} className="flex items-center gap-3 py-2.5 first:pt-0">
                <span
                  className="h-3 w-3 shrink-0 rounded-full border border-border"
                  style={{ background: l.color ?? DEFAULT_LABEL_COLOR }}
                  aria-hidden
                />
                <span className="min-w-0 truncate text-sm font-medium text-ink">{l.name}</span>
                {canAdmin && (
                  <div className="ml-auto flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setEditingId(l.id)}
                      title="Chỉnh sửa"
                    >
                      <Pencil className="h-4 w-4" />
                      <span className="sr-only">Chỉnh sửa {l.name}</span>
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleDelete(l)}
                      title="Xoá"
                      className="text-muted hover:text-danger"
                    >
                      <Trash2 className="h-4 w-4" />
                      <span className="sr-only">Xoá {l.name}</span>
                    </Button>
                  </div>
                )}
              </li>
            ),
          )}
        </ul>
      )}

      {canAdmin && (adding ? (
        <div className="mt-4 rounded-md border border-border bg-surface-2 p-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[10rem] flex-1">
              <label htmlFor="label-name" className="mb-1 block text-xs font-medium text-muted">
                Tên
              </label>
              <Input
                id="label-name"
                value={name}
                autoFocus
                placeholder="VD: cần-xem-lại"
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submitAdd();
                  if (e.key === 'Escape') resetAdd();
                }}
              />
            </div>
            <div className="w-24">
              <label htmlFor="label-color" className="mb-1 block text-xs font-medium text-muted">
                Màu
              </label>
              <input
                id="label-color"
                type="color"
                value={color}
                aria-label="Màu nhãn"
                onChange={(e) => setColor(e.target.value)}
                className="h-9 w-full cursor-pointer rounded-md border border-border bg-bg px-1"
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
        labels.length > 0 && (
          <Button
            variant="secondary"
            size="sm"
            className="mt-4"
            onClick={() => setAdding(true)}
            disabled={!projectId}
          >
            <Plus className="h-4 w-4" />
            Thêm nhãn
          </Button>
        )
      ))}
    </SectionCard>
  );
}

function LabelEditRow({
  label,
  saving,
  onSave,
  onCancel,
}: {
  label: Label;
  saving: boolean;
  onSave: (body: LabelUpdateInput) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(label.name);
  const [color, setColor] = useState(label.color ?? DEFAULT_LABEL_COLOR);

  function save() {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error('Tên không được để trống.');
      return;
    }
    onSave({ name: trimmed, color });
  }

  return (
    <li className="flex flex-wrap items-end gap-3 py-3 first:pt-0">
      <div className="min-w-[10rem] flex-1">
        <Input
          value={name}
          autoFocus
          aria-label="Tên nhãn"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') save();
            if (e.key === 'Escape') onCancel();
          }}
        />
      </div>
      <div className="w-24">
        <input
          type="color"
          value={color}
          aria-label="Màu nhãn"
          onChange={(e) => setColor(e.target.value)}
          className="h-9 w-full cursor-pointer rounded-md border border-border bg-bg px-1"
        />
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

/* ------------------------------------------------------------------ */
/* Section — Xuất / Nhập dữ liệu                                       */
/* ------------------------------------------------------------------ */

const CSV_HEADER_HINT = 'Summary, Type, Description, Priority, Story Points';

function DataSection({ projectId, canImport }: { projectId?: string; canImport: boolean }) {
  const { data: jobsData, isLoading: jobsLoading } = useImportJobs();
  const importCsv = useImportCsv();
  const importJson = useImportJson();

  const [exporting, setExporting] = useState(false);
  const [csv, setCsv] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const jobs = jobsData ?? [];
  const importing = importCsv.isPending || importJson.isPending;

  async function handleExport() {
    if (!projectId) return;
    setExporting(true);
    try {
      await downloadProjectExport(projectId);
    } catch (e) {
      toast.error(apiErrorMessage(e));
    } finally {
      setExporting(false);
    }
  }

  function handleImportCsv() {
    if (!projectId) return;
    const trimmed = csv.trim();
    if (!trimmed) {
      toast.error('Vui lòng dán nội dung CSV.');
      return;
    }
    importCsv.mutate(
      { projectId, csv: trimmed },
      {
        onSuccess: (result) => {
          importResultToast(result);
          setCsv('');
        },
        onError: (e) => toast.error(apiErrorMessage(e)),
      },
    );
  }

  function handleImportJsonFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Cho phép chọn lại cùng một file lần nữa.
    e.target.value = '';
    if (!file || !projectId) return;

    void file
      .text()
      .then((text) => {
        let data: unknown;
        try {
          data = JSON.parse(text);
        } catch {
          toast.error('File JSON không hợp lệ.');
          return;
        }
        importJson.mutate(
          { projectId, data },
          {
            onSuccess: (result) => importResultToast(result),
            onError: (err) => toast.error(apiErrorMessage(err)),
          },
        );
      })
      .catch(() => toast.error('Không đọc được file.'));
  }

  return (
    <SectionCard
      icon={<Download className="h-4 w-4" />}
      title="Xuất / Nhập dữ liệu"
      description="Sao lưu dự án ra tệp JSON, hoặc nhập công việc hàng loạt từ tệp CSV / JSON."
    >
      <div className="space-y-6">
        {!canImport && (
          <p className="rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-muted">
            Bạn không có quyền xuất/nhập dữ liệu. Liên hệ quản trị chung nếu cần.
          </p>
        )}

        {/* Xuất */}
        {canImport && (
        <>
        <div>
          <h3 className="text-sm font-medium text-ink-strong">Xuất dữ liệu</h3>
          <p className="mt-0.5 text-sm text-muted">
            Tải toàn bộ công việc và cấu hình dự án về dưới dạng tệp JSON.
          </p>
          <Button
            variant="secondary"
            size="sm"
            className="mt-3"
            onClick={handleExport}
            loading={exporting}
            disabled={!projectId}
          >
            <Download className="h-4 w-4" />
            Tải JSON
          </Button>
        </div>

        <hr className="border-border" />

        {/* Nhập */}
        <div>
          <h3 className="text-sm font-medium text-ink-strong">Nhập dữ liệu</h3>

          <div className="mt-3">
            <label htmlFor="import-csv" className="mb-1 block text-xs font-medium text-muted">
              Dán CSV
            </label>
            <textarea
              id="import-csv"
              value={csv}
              rows={5}
              spellCheck={false}
              placeholder={`${CSV_HEADER_HINT}\nĐăng nhập lỗi,Bug,Không vào được,High,3`}
              onChange={(e) => setCsv(e.target.value)}
              className={cn(
                'w-full rounded-md border border-border bg-bg px-3 py-2 font-mono text-sm text-ink',
                'placeholder:text-faint transition-colors duration-150 resize-y',
                'focus-visible:outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
                'disabled:opacity-50',
              )}
              disabled={!projectId || importing}
            />
            <p className="mt-1 text-xs text-faint">
              Cột: <span className="font-mono">{CSV_HEADER_HINT}</span>
            </p>
            <Button
              size="sm"
              className="mt-3"
              onClick={handleImportCsv}
              loading={importCsv.isPending}
              disabled={!projectId || importJson.isPending}
            >
              <Upload className="h-4 w-4" />
              Nhập CSV
            </Button>
          </div>

          <div className="mt-5">
            <span className="mb-1 block text-xs font-medium text-muted">Tải lên JSON export</span>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json,.json"
              onChange={handleImportJsonFile}
              disabled={!projectId || importing}
              className="sr-only"
            />
            <Button
              variant="secondary"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              loading={importJson.isPending}
              disabled={!projectId || importCsv.isPending}
            >
              <Upload className="h-4 w-4" />
              Chọn file JSON…
            </Button>
          </div>
        </div>
        </>
        )}

        {canImport && <hr className="border-border" />}

        {/* Lịch sử import */}
        <div>
          <h3 className="flex items-center gap-2 text-sm font-medium text-ink-strong">
            <History className="h-4 w-4 text-muted" />
            Lịch sử nhập
          </h3>

          {jobsLoading ? (
            <div className="mt-3 space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : jobs.length === 0 ? (
            <p className="mt-3 text-sm text-muted">Chưa có lần nhập nào.</p>
          ) : (
            <ul className="mt-3 divide-y divide-border">
              {jobs.map((job) => (
                <ImportJobRow key={job.id} job={job} />
              ))}
            </ul>
          )}
        </div>
      </div>
    </SectionCard>
  );
}

function ImportJobRow({ job }: { job: ImportJob }) {
  const status = IMPORT_STATUS[job.status];
  return (
    <li className="flex flex-wrap items-center gap-3 py-2.5 first:pt-0">
      <Badge className="bg-surface-2 font-mono text-faint">{job.source}</Badge>
      <Badge className={status.className}>{status.label}</Badge>
      <span className="text-sm text-muted">
        {job.processedItems}/{job.totalItems} mục
      </span>
      <span className="ml-auto font-mono text-xs text-faint">
        {formatDateTime(job.completedAt ?? job.createdAt)}
      </span>
    </li>
  );
}
