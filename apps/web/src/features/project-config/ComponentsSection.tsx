import { useState } from 'react';
import { Boxes, Plus, Pencil, Trash2, Check, X } from 'lucide-react';
import { toast } from 'sonner';
import { EmptyState, Skeleton } from '@/components/ui/primitives';
import { useConfirm } from '@/components/ui/useConfirm';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { apiErrorMessage } from '@/lib/api';
import {
  useComponents,
  useCreateComponent,
  useUpdateComponent,
  useDeleteComponent,
  type Component,
  type ComponentUpdateInput,
} from './api';
import { QueryBoundary } from '@/components/ui/QueryBoundary';
import { SectionCard } from './SectionCard';

/* ------------------------------------------------------------------ */
/* Section — Components                                                 */
/* ------------------------------------------------------------------ */

export function ComponentsSection({
  projectId,
  canAdmin,
}: {
  projectId?: string;
  canAdmin: boolean;
}) {
  const confirm = useConfirm();
  const componentsQuery = useComponents(projectId);
  const { data } = componentsQuery;
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

  async function handleDelete(c: Component) {
    if (
      !(await confirm({
        title: `Xoá thành phần "${c.name}"? Hành động này không thể hoàn tác.`,
        destructive: true,
      }))
    )
      return;
    remove.mutate(c.id, { onError: (e) => toast.error(apiErrorMessage(e)) });
  }

  return (
    <SectionCard
      icon={<Boxes className="h-4 w-4" />}
      title="Thành phần"
      description="Chia công việc theo từng phần chức năng hoặc từng khối của dự án."
    >
      <QueryBoundary
        query={componentsQuery}
        skeleton={
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-11 w-full" />
            ))}
          </div>
        }
        empty={() => components.length === 0 && !adding}
        emptyState={
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
        }
      >
        {() => (
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
      </QueryBoundary>

      {canAdmin &&
        (adding ? (
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
