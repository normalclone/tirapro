import { useState } from 'react';
import { Flag, Plus, Pencil, Trash2, Check, X, Star } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Badge, EmptyState, Skeleton } from '@/components/ui/primitives';
import { apiErrorMessage } from '@/lib/api';
import { useAuth } from '@/stores/auth';
import { SectionCard } from './SectionCard';
import {
  useSeverities,
  useCreateSeverity,
  useUpdateSeverity,
  useDeleteSeverity,
  type Severity,
  type SeverityUpdateInput,
} from './api';

const DEFAULT_COLOR = '#64748b';

export function SeveritySection() {
  const canManage = useAuth((s) => s.can('workspace:admin'));
  const { data, isLoading } = useSeverities();
  const create = useCreateSeverity();
  const update = useUpdateSeverity();
  const remove = useDeleteSeverity();

  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [color, setColor] = useState(DEFAULT_COLOR);
  const [rank, setRank] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);

  const severities = (data ?? []).slice().sort((a, b) => a.rank - b.rank);

  function resetAdd() {
    setName('');
    setColor(DEFAULT_COLOR);
    setRank('');
    setAdding(false);
  }

  function submitAdd() {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error('Vui lòng nhập tên mức độ.');
      return;
    }
    create.mutate(
      { name: trimmed, color, rank: rank.trim() === '' ? undefined : Number(rank) },
      { onSuccess: resetAdd, onError: (e) => toast.error(apiErrorMessage(e)) },
    );
  }

  function patch(id: string, body: SeverityUpdateInput, onDone?: () => void) {
    update.mutate(
      { id, patch: body },
      { onSuccess: () => onDone?.(), onError: (e) => toast.error(apiErrorMessage(e)) },
    );
  }

  function handleDelete(s: Severity) {
    if (!window.confirm(`Xoá mức độ "${s.name}"? Hành động này không thể hoàn tác.`)) return;
    remove.mutate(s.id, { onError: (e) => toast.error(apiErrorMessage(e)) });
  }

  return (
    <SectionCard
      icon={<Flag className="h-4 w-4" />}
      title="Mức độ nghiêm trọng"
      description="Định nghĩa các mức độ (severity) dùng để phân loại issue. Rank nhỏ = ưu tiên cao hơn."
    >
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-11 w-full" />
          ))}
        </div>
      ) : severities.length === 0 && !adding ? (
        <EmptyState
          icon={<Flag className="h-6 w-6" />}
          title="Chưa có mức độ nào"
          description={
            canManage
              ? 'Thêm mức độ đầu tiên để bắt đầu phân loại issue.'
              : 'Chưa có mức độ nào. Liên hệ quản trị workspace để thêm.'
          }
          action={
            canManage ? (
              <Button size="sm" onClick={() => setAdding(true)}>
                <Plus className="h-4 w-4" />
                Thêm mức độ
              </Button>
            ) : undefined
          }
        />
      ) : (
        <ul className="divide-y divide-border">
          {severities.map((s) =>
            editingId === s.id ? (
              <SeverityEditRow
                key={s.id}
                severity={s}
                saving={update.isPending}
                onCancel={() => setEditingId(null)}
                onSave={(body) => patch(s.id, body, () => setEditingId(null))}
              />
            ) : (
              <li key={s.id} className="flex items-center gap-3 py-2.5 first:pt-0">
                <span
                  className="h-3.5 w-3.5 shrink-0 rounded-full border border-border"
                  style={{ background: s.color }}
                  aria-hidden
                />
                <span className="truncate text-sm font-medium text-ink">{s.name}</span>
                <span className="font-mono text-xs text-faint">#{s.rank}</span>
                {s.isDefault && <Badge className="bg-primary-subtle text-primary">Mặc định</Badge>}
                {s.isSystem && <Badge className="bg-surface-2 text-muted">Hệ thống</Badge>}

                {canManage && (
                  <div className="ml-auto flex items-center gap-1">
                    {!s.isDefault && !s.isSystem && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => patch(s.id, { isDefault: true })}
                        loading={update.isPending}
                        title="Đặt làm mặc định"
                      >
                        <Star className="h-4 w-4" />
                        <span className="sr-only">Đặt mặc định</span>
                      </Button>
                    )}
                    {!s.isSystem && (
                      <>
                        <Button variant="ghost" size="icon" onClick={() => setEditingId(s.id)} title="Chỉnh sửa">
                          <Pencil className="h-4 w-4" />
                          <span className="sr-only">Chỉnh sửa {s.name}</span>
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDelete(s)}
                          title="Xoá"
                          className="text-muted hover:text-danger"
                        >
                          <Trash2 className="h-4 w-4" />
                          <span className="sr-only">Xoá {s.name}</span>
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

      {/* Form thêm mức độ — chỉ quản trị workspace */}
      {canManage && adding ? (
        <div className="mt-4 rounded-md border border-border bg-surface-2 p-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[10rem] flex-1">
              <label htmlFor="sev-name" className="mb-1 block text-xs font-medium text-muted">
                Tên
              </label>
              <Input
                id="sev-name"
                value={name}
                autoFocus
                placeholder="VD: Nghiêm trọng"
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submitAdd();
                  if (e.key === 'Escape') resetAdd();
                }}
              />
            </div>
            <div>
              <label htmlFor="sev-color" className="mb-1 block text-xs font-medium text-muted">
                Màu
              </label>
              <input
                id="sev-color"
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="h-9 w-12 cursor-pointer rounded-md border border-border bg-bg p-1"
              />
            </div>
            <div className="w-20">
              <label htmlFor="sev-rank" className="mb-1 block text-xs font-medium text-muted">
                Rank
              </label>
              <Input id="sev-rank" type="number" value={rank} placeholder="0" onChange={(e) => setRank(e.target.value)} />
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
        severities.length > 0 && (
          <Button variant="secondary" size="sm" className="mt-4" onClick={() => setAdding(true)}>
            <Plus className="h-4 w-4" />
            Thêm mức độ
          </Button>
        )
      )}
    </SectionCard>
  );
}

function SeverityEditRow({
  severity,
  saving,
  onSave,
  onCancel,
}: {
  severity: Severity;
  saving: boolean;
  onSave: (body: SeverityUpdateInput) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(severity.name);
  const [color, setColor] = useState(severity.color);
  const [rank, setRank] = useState(String(severity.rank));

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
          aria-label="Tên mức độ"
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
      <Input type="number" aria-label="Rank" value={rank} onChange={(e) => setRank(e.target.value)} className="w-20" />
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
