import { useState } from 'react';
import { SignalHigh, Flag, Plus, Pencil, Trash2, Check, X, Star } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Badge, EmptyState, Skeleton } from '@/components/ui/primitives';
import { apiErrorMessage } from '@/lib/api';
import { useAuth } from '@/stores/auth';
import {
  usePriorities,
  useCreatePriority,
  useUpdatePriority,
  useDeletePriority,
  type Priority,
  type PriorityUpdateInput,
} from './api';

const DEFAULT_COLOR = '#64748b';

/** Card khung — giữ đúng vocabulary với SettingsPage (icon trong ô bo tròn primary-subtle). */
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

export function PrioritiesSection() {
  const canManage = useAuth((s) => s.can('workspace:admin'));
  const { data, isLoading } = usePriorities();
  const create = useCreatePriority();
  const update = useUpdatePriority();
  const remove = useDeletePriority();

  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [color, setColor] = useState(DEFAULT_COLOR);
  const [rank, setRank] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);

  const priorities = (data ?? []).slice().sort((a, b) => a.rank - b.rank);

  function resetAdd() {
    setName('');
    setColor(DEFAULT_COLOR);
    setRank('');
    setAdding(false);
  }

  function submitAdd() {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error('Vui lòng nhập tên độ ưu tiên.');
      return;
    }
    create.mutate(
      {
        name: trimmed,
        color,
        rank: rank.trim() === '' ? undefined : Number(rank),
      },
      {
        onSuccess: resetAdd,
        onError: (e) => toast.error(apiErrorMessage(e)),
      },
    );
  }

  function patch(id: string, body: PriorityUpdateInput, onDone?: () => void) {
    update.mutate(
      { id, patch: body },
      {
        onSuccess: () => onDone?.(),
        onError: (e) => toast.error(apiErrorMessage(e)),
      },
    );
  }

  function handleDelete(p: Priority) {
    if (!window.confirm(`Xoá độ ưu tiên "${p.name}"? Hành động này không thể hoàn tác.`)) return;
    remove.mutate(p.id, { onError: (e) => toast.error(apiErrorMessage(e)) });
  }

  return (
    <SectionCard
      icon={<SignalHigh className="h-4 w-4" />}
      title="Độ ưu tiên"
      description="Định nghĩa các mức độ ưu tiên (priority) dùng để sắp xếp issue. Rank nhỏ = ưu tiên cao hơn."
    >
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-11 w-full" />
          ))}
        </div>
      ) : priorities.length === 0 && !adding ? (
        <EmptyState
          icon={<Flag className="h-6 w-6" />}
          title="Chưa có độ ưu tiên nào"
          description={
            canManage
              ? 'Thêm độ ưu tiên đầu tiên để bắt đầu sắp xếp issue.'
              : 'Chưa có độ ưu tiên nào. Liên hệ quản trị workspace để thêm.'
          }
          action={
            canManage ? (
              <Button size="sm" onClick={() => setAdding(true)}>
                <Plus className="h-4 w-4" />
                Thêm độ ưu tiên
              </Button>
            ) : undefined
          }
        />
      ) : (
        <ul className="divide-y divide-border">
          {priorities.map((p) =>
            editingId === p.id ? (
              <PriorityEditRow
                key={p.id}
                priority={p}
                saving={update.isPending}
                onCancel={() => setEditingId(null)}
                onSave={(body) => patch(p.id, body, () => setEditingId(null))}
              />
            ) : (
              <li key={p.id} className="flex items-center gap-3 py-2.5 first:pt-0">
                <span
                  className="h-3.5 w-3.5 shrink-0 rounded-full border border-border"
                  style={{ background: p.color }}
                  aria-hidden
                />
                <span className="truncate text-sm font-medium text-ink">{p.name}</span>
                <span className="font-mono text-xs text-faint">#{p.rank}</span>
                {p.isDefault && (
                  <Badge className="bg-primary-subtle text-primary">Mặc định</Badge>
                )}
                {p.isSystem && <Badge className="bg-surface-2 text-muted">Hệ thống</Badge>}

                {canManage && (
                  <div className="ml-auto flex items-center gap-1">
                    {!p.isDefault && !p.isSystem && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => patch(p.id, { isDefault: true })}
                        loading={update.isPending}
                        title="Đặt làm mặc định"
                      >
                        <Star className="h-4 w-4" />
                        <span className="sr-only">Đặt mặc định</span>
                      </Button>
                    )}
                    {!p.isSystem && (
                      <>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setEditingId(p.id)}
                          title="Chỉnh sửa"
                        >
                          <Pencil className="h-4 w-4" />
                          <span className="sr-only">Chỉnh sửa {p.name}</span>
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDelete(p)}
                          title="Xoá"
                          className="text-muted hover:text-danger"
                        >
                          <Trash2 className="h-4 w-4" />
                          <span className="sr-only">Xoá {p.name}</span>
                        </Button>
                      </>
                    )}
                  </div>
                )}
              </li>
            ),
          )}
        </ul>
      )}

      {/* Form thêm độ ưu tiên — chỉ quản trị workspace */}
      {canManage && adding ? (
        <div className="mt-4 rounded-md border border-border bg-surface-2 p-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[10rem] flex-1">
              <label htmlFor="prio-name" className="mb-1 block text-xs font-medium text-muted">
                Tên
              </label>
              <Input
                id="prio-name"
                value={name}
                autoFocus
                placeholder="VD: Khẩn cấp"
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submitAdd();
                  if (e.key === 'Escape') resetAdd();
                }}
              />
            </div>
            <div>
              <label htmlFor="prio-color" className="mb-1 block text-xs font-medium text-muted">
                Màu
              </label>
              <input
                id="prio-color"
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="h-9 w-12 cursor-pointer rounded-md border border-border bg-bg p-1"
              />
            </div>
            <div className="w-20">
              <label htmlFor="prio-rank" className="mb-1 block text-xs font-medium text-muted">
                Rank
              </label>
              <Input
                id="prio-rank"
                type="number"
                value={rank}
                placeholder="0"
                onChange={(e) => setRank(e.target.value)}
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
        canManage &&
        priorities.length > 0 && (
          <Button variant="secondary" size="sm" className="mt-4" onClick={() => setAdding(true)}>
            <Plus className="h-4 w-4" />
            Thêm độ ưu tiên
          </Button>
        )
      )}
    </SectionCard>
  );
}

function PriorityEditRow({
  priority,
  saving,
  onSave,
  onCancel,
}: {
  priority: Priority;
  saving: boolean;
  onSave: (body: PriorityUpdateInput) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(priority.name);
  const [color, setColor] = useState(priority.color);
  const [rank, setRank] = useState(String(priority.rank));

  function save() {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error('Tên không được để trống.');
      return;
    }
    onSave({ name: trimmed, color, rank: Number(rank) });
  }

  return (
    <li className="flex flex-wrap items-end gap-3 py-3 first:pt-0">
      <div className="min-w-[10rem] flex-1">
        <Input
          value={name}
          autoFocus
          aria-label="Tên độ ưu tiên"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') save();
            if (e.key === 'Escape') onCancel();
          }}
        />
      </div>
      <input
        type="color"
        aria-label="Màu"
        value={color}
        onChange={(e) => setColor(e.target.value)}
        className="h-9 w-12 cursor-pointer rounded-md border border-border bg-bg p-1"
      />
      <Input
        type="number"
        aria-label="Rank"
        value={rank}
        onChange={(e) => setRank(e.target.value)}
        className="w-20"
      />
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
