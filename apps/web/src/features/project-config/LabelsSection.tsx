import { useState } from 'react';
import { Tags, Plus, Pencil, Trash2, Check, X } from 'lucide-react';
import { toast } from 'sonner';
import { EmptyState, Skeleton } from '@/components/ui/primitives';
import { useConfirm } from '@/components/ui/useConfirm';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { apiErrorMessage } from '@/lib/api';
import {
  useLabels,
  useCreateLabel,
  useUpdateLabel,
  useDeleteLabel,
  type Label,
  type LabelUpdateInput,
} from './api';
import { QueryBoundary } from '@/components/ui/QueryBoundary';
import { SectionCard } from '@/components/ui/SectionCard';

/** Màu mặc định cho nhãn mới (token primary). */
const DEFAULT_LABEL_COLOR = '#6366f1';

/* ------------------------------------------------------------------ */
/* Section — Nhãn (Labels)                                             */
/* ------------------------------------------------------------------ */

export function LabelsSection({ projectId, canAdmin }: { projectId?: string; canAdmin: boolean }) {
  const confirm = useConfirm();
  const labelsQuery = useLabels(projectId);
  const { data } = labelsQuery;
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

  async function handleDelete(l: Label) {
    if (
      !(await confirm({
        title: `Xoá nhãn "${l.name}"? Hành động này không thể hoàn tác.`,
        destructive: true,
      }))
    )
      return;
    remove.mutate(l.id, { onError: (e) => toast.error(apiErrorMessage(e)) });
  }

  return (
    <SectionCard
      icon={<Tags className="h-4 w-4" />}
      title="Nhãn"
      description="Gắn nhãn cho công việc để nhóm và lọc theo cách của riêng bạn."
    >
      <QueryBoundary
        query={labelsQuery}
        skeleton={
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-11 w-full" />
            ))}
          </div>
        }
        empty={() => labels.length === 0 && !adding}
        emptyState={
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
        }
      >
        {() => (
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
      </QueryBoundary>

      {canAdmin &&
        (adding ? (
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
