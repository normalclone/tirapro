import { useState } from 'react';
import { LayoutList, Plus, Pencil, Trash2, Check, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { SearchSelect } from '@/components/ui/SearchSelect';
import { Badge, EmptyState, Skeleton } from '@/components/ui/primitives';
import { apiErrorMessage } from '@/lib/api';
import { useAuth } from '@/stores/auth';
import {
  useCustomFields,
  useCreateCustomField,
  useUpdateCustomField,
  useDeleteCustomField,
  type CustomField,
  type CustomFieldType,
} from './api';

/** Nhãn tiếng Việt cho từng loại trường, giữ đúng thứ tự enum backend. */
const FIELD_TYPES: { value: CustomFieldType; label: string }[] = [
  { value: 'TEXT', label: 'Văn bản ngắn' },
  { value: 'TEXTAREA', label: 'Văn bản dài' },
  { value: 'NUMBER', label: 'Số' },
  { value: 'DATE', label: 'Ngày' },
  { value: 'DATETIME', label: 'Ngày giờ' },
  { value: 'SELECT', label: 'Chọn một' },
  { value: 'MULTI_SELECT', label: 'Chọn nhiều' },
  { value: 'CHECKBOX', label: 'Ô đánh dấu' },
  { value: 'USER', label: 'Người dùng' },
  { value: 'URL', label: 'Đường dẫn (URL)' },
];

const TYPE_LABELS: Record<CustomFieldType, string> = FIELD_TYPES.reduce(
  (acc, t) => {
    acc[t.value] = t.label;
    return acc;
  },
  {} as Record<CustomFieldType, string>,
);

function hasOptions(type: CustomFieldType): boolean {
  return type === 'SELECT' || type === 'MULTI_SELECT';
}

/** Card khung — giữ đúng vocabulary với SettingsPage. */
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

export function CustomFieldsAdminSection() {
  const canManage = useAuth((s) => s.can('customfield:manage'));
  const { data, isLoading } = useCustomFields();
  const create = useCreateCustomField();
  const update = useUpdateCustomField();
  const remove = useDeleteCustomField();

  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Trạng thái form thêm
  const [name, setName] = useState('');
  const [type, setType] = useState<CustomFieldType>('TEXT');
  const [isRequired, setIsRequired] = useState(false);
  const [options, setOptions] = useState<string[]>(['']);

  const fields = data ?? [];

  function resetAdd() {
    setName('');
    setType('TEXT');
    setIsRequired(false);
    setOptions(['']);
    setAdding(false);
  }

  function submitAdd() {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error('Vui lòng nhập tên trường.');
      return;
    }

    let optionPayload: { value: string }[] | undefined;
    if (hasOptions(type)) {
      const values = options.map((o) => o.trim()).filter((o) => o !== '');
      if (values.length === 0) {
        toast.error('Vui lòng thêm ít nhất một lựa chọn.');
        return;
      }
      optionPayload = values.map((value) => ({ value }));
    }

    create.mutate(
      {
        name: trimmed,
        type,
        isRequired,
        options: optionPayload,
      },
      {
        onSuccess: resetAdd,
        onError: (e) => toast.error(apiErrorMessage(e)),
      },
    );
  }

  function handleDelete(f: CustomField) {
    if (!window.confirm(`Xoá trường "${f.name}"? Trường sẽ bị ẩn khỏi các issue.`)) return;
    remove.mutate(f.id, { onError: (e) => toast.error(apiErrorMessage(e)) });
  }

  function setOptionAt(index: number, value: string) {
    setOptions((prev) => prev.map((o, i) => (i === index ? value : o)));
  }

  function addOption() {
    setOptions((prev) => [...prev, '']);
  }

  function removeOption(index: number) {
    setOptions((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== index)));
  }

  return (
    <SectionCard
      icon={<LayoutList className="h-4 w-4" />}
      title="Trường tuỳ chỉnh"
      description="Định nghĩa các trường bổ sung gắn vào issue. Không thể đổi loại trường sau khi tạo."
    >
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-11 w-full" />
          ))}
        </div>
      ) : fields.length === 0 && !adding ? (
        <EmptyState
          icon={<LayoutList className="h-6 w-6" />}
          title="Chưa có trường tuỳ chỉnh nào"
          description={
            canManage
              ? 'Thêm trường đầu tiên để thu thập thêm thông tin trên issue.'
              : 'Chưa có trường tuỳ chỉnh nào. Liên hệ quản trị để thêm.'
          }
          action={
            canManage ? (
              <Button size="sm" onClick={() => setAdding(true)}>
                <Plus className="h-4 w-4" />
                Thêm trường
              </Button>
            ) : undefined
          }
        />
      ) : (
        <ul className="divide-y divide-border">
          {fields.map((f) =>
            editingId === f.id ? (
              <CustomFieldEditRow
                key={f.id}
                field={f}
                saving={update.isPending}
                onCancel={() => setEditingId(null)}
                onSave={(patch) =>
                  update.mutate(
                    { id: f.id, patch },
                    {
                      onSuccess: () => setEditingId(null),
                      onError: (e) => toast.error(apiErrorMessage(e)),
                    },
                  )
                }
              />
            ) : (
              <li key={f.id} className="flex items-center gap-3 py-2.5 first:pt-0">
                <span className="truncate text-sm font-medium text-ink">{f.name}</span>
                <Badge className="bg-surface-2 text-muted">{TYPE_LABELS[f.type] ?? f.type}</Badge>
                {f.isRequired && (
                  <Badge className="bg-danger/10 text-danger">Bắt buộc</Badge>
                )}
                <span className="truncate text-xs text-faint">
                  {f.projectId ? `Dự án ${f.projectId}` : 'Toàn workspace'}
                </span>

                {canManage && (
                  <div className="ml-auto flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setEditingId(f.id)}
                      title="Chỉnh sửa"
                    >
                      <Pencil className="h-4 w-4" />
                      <span className="sr-only">Chỉnh sửa {f.name}</span>
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleDelete(f)}
                      title="Xoá"
                      className="text-muted hover:text-danger"
                    >
                      <Trash2 className="h-4 w-4" />
                      <span className="sr-only">Xoá {f.name}</span>
                    </Button>
                  </div>
                )}
              </li>
            ),
          )}
        </ul>
      )}

      {/* Form thêm trường — chỉ người có quyền quản lý trường tuỳ chỉnh */}
      {canManage && adding ? (
        <div className="mt-4 rounded-md border border-border bg-surface-2 p-3">
          <div className="space-y-3">
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-[10rem] flex-1">
                <label htmlFor="cf-name" className="mb-1 block text-xs font-medium text-muted">
                  Tên trường
                </label>
                <Input
                  id="cf-name"
                  value={name}
                  autoFocus
                  placeholder="VD: Bộ phận"
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !hasOptions(type)) submitAdd();
                    if (e.key === 'Escape') resetAdd();
                  }}
                />
              </div>
              <div className="w-44">
                <label htmlFor="cf-type" className="mb-1 block text-xs font-medium text-muted">
                  Loại
                </label>
                <SearchSelect
                  id="cf-type"
                  value={type}
                  onChange={(v) => setType(v as CustomFieldType)}
                  options={FIELD_TYPES.map((t) => ({ value: t.value, label: t.label }))}
                  placeholder="Chọn loại…"
                  className="w-full"
                />
              </div>
            </div>

            {/* Lựa chọn (chỉ với SELECT / MULTI_SELECT) */}
            {hasOptions(type) && (
              <div>
                <span className="mb-1 block text-xs font-medium text-muted">Các lựa chọn</span>
                <div className="space-y-2">
                  {options.map((opt, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <Input
                        value={opt}
                        placeholder={`Lựa chọn ${i + 1}`}
                        aria-label={`Lựa chọn ${i + 1}`}
                        onChange={(e) => setOptionAt(i, e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') addOption();
                          if (e.key === 'Escape') resetAdd();
                        }}
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => removeOption(i)}
                        disabled={options.length <= 1}
                        title="Xoá lựa chọn"
                        className="text-muted hover:text-danger"
                      >
                        <X className="h-4 w-4" />
                        <span className="sr-only">Xoá lựa chọn {i + 1}</span>
                      </Button>
                    </div>
                  ))}
                </div>
                <Button variant="ghost" size="sm" className="mt-2" onClick={addOption}>
                  <Plus className="h-4 w-4" />
                  Thêm lựa chọn
                </Button>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3">
              <label className="flex cursor-pointer items-center gap-2 text-sm text-ink">
                <input
                  type="checkbox"
                  checked={isRequired}
                  onChange={(e) => setIsRequired(e.target.checked)}
                  className="h-4 w-4 cursor-pointer rounded border-border accent-[var(--primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                />
                Bắt buộc
              </label>
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
        </div>
      ) : (
        canManage &&
        fields.length > 0 && (
          <Button variant="secondary" size="sm" className="mt-4" onClick={() => setAdding(true)}>
            <Plus className="h-4 w-4" />
            Thêm trường
          </Button>
        )
      )}
    </SectionCard>
  );
}

function CustomFieldEditRow({
  field,
  saving,
  onSave,
  onCancel,
}: {
  field: CustomField;
  saving: boolean;
  onSave: (patch: { name?: string; isRequired?: boolean }) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(field.name);
  const [isRequired, setIsRequired] = useState(field.isRequired);

  function save() {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error('Tên không được để trống.');
      return;
    }
    onSave({ name: trimmed, isRequired });
  }

  return (
    <li className="flex flex-wrap items-center gap-3 py-3 first:pt-0">
      <div className="min-w-[10rem] flex-1">
        <Input
          value={name}
          autoFocus
          aria-label="Tên trường"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') save();
            if (e.key === 'Escape') onCancel();
          }}
        />
      </div>
      <Badge className="bg-surface-2 text-muted">{TYPE_LABELS[field.type] ?? field.type}</Badge>
      <label className="flex cursor-pointer items-center gap-2 text-sm text-ink">
        <input
          type="checkbox"
          checked={isRequired}
          onChange={(e) => setIsRequired(e.target.checked)}
          className="h-4 w-4 cursor-pointer rounded border-border accent-[var(--primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
        />
        Bắt buộc
      </label>
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
