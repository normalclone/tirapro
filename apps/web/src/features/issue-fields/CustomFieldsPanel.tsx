import { useEffect, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { Input } from '@/components/ui/Input';
import { DateInput, DateTimeInput } from '@/components/ui/DateInput';
import { SearchSelect } from '@/components/ui/SearchSelect';
import { apiErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { displayCustomFieldValue } from './displayValue';
import {
  useIssueCustomFields,
  useSetCustomField,
  type CustomFieldOption,
  type CustomFieldValue,
  type IssueCustomField,
} from './api';
import { toDateTimeInput } from '@/lib/dateFormat';
import { SETTINGS_LABELS } from '@/lib/navLabels';

/** `canEdit`: được sửa issue này (`useCanEditIssue`) — không thì hiện giá trị chỉ-đọc, không dựng ô nhập (tránh 403 khi lưu). */
export function CustomFieldsPanel({ issueId, canEdit }: { issueId: string; canEdit: boolean }) {
  const { data } = useIssueCustomFields(issueId);
  const setField = useSetCustomField(issueId);

  // Không có field tùy chỉnh → không hiển thị gì (tránh làm rối drawer).
  if (!data || data.length === 0) return null;

  async function save(fieldId: string, value: unknown) {
    try {
      await setField.mutateAsync({ fieldId, value });
    } catch (e) {
      toast.error(apiErrorMessage(e));
    }
  }

  return (
    <div>
      <p className="mb-1.5 text-sm font-medium text-muted">{SETTINGS_LABELS.fields}</p>
      {/* Chỉ-đọc dùng dl/dt/dd (cặp tên-giá trị đúng ngữ nghĩa); sửa được dùng label gắn với ô nhập. */}
      <Rows as={canEdit ? 'div' : 'dl'}>
        {data.map((item) => (
          <FieldRow
            key={item.field.id}
            item={item}
            saving={setField.isPending}
            canEdit={canEdit}
            onSave={(value) => void save(item.field.id, value)}
          />
        ))}
      </Rows>
    </div>
  );
}

function Rows({ as: Tag, children }: { as: 'div' | 'dl'; children: ReactNode }) {
  return <Tag className="grid grid-cols-[110px_1fr] gap-y-2.5 text-sm">{children}</Tag>;
}

function FieldRow({
  item,
  saving,
  canEdit,
  onSave,
}: {
  item: IssueCustomField;
  saving: boolean;
  canEdit: boolean;
  onSave: (value: unknown) => void;
}) {
  const { field } = item;
  const required = field.isRequired && (
    <span className="ml-0.5 text-danger" aria-hidden>
      *
    </span>
  );
  if (!canEdit) {
    return (
      <>
        <dt className="flex items-start pt-1 text-muted">
          {field.name}
          {required}
        </dt>
        <dd className="min-w-0 whitespace-pre-wrap break-words pt-1 text-ink">
          {displayCustomFieldValue(field, item.value) ?? <span className="text-faint">—</span>}
        </dd>
      </>
    );
  }
  return (
    <>
      <label className="flex items-start pt-1 text-muted" htmlFor={`cf-${field.id}`}>
        {field.name}
        {required}
      </label>
      <div className="min-w-0">
        <FieldEditor field={field} value={item.value} saving={saving} onSave={onSave} />
      </div>
    </>
  );
}

function FieldEditor({
  field,
  value,
  saving,
  onSave,
}: {
  field: IssueCustomField['field'];
  value: CustomFieldValue;
  saving: boolean;
  onSave: (value: unknown) => void;
}) {
  const id = `cf-${field.id}`;
  const options: CustomFieldOption[] = field.options ?? [];

  switch (field.type) {
    case 'TEXT':
    case 'URL':
      return (
        <TextField
          id={id}
          value={asString(value)}
          type={field.type === 'URL' ? 'url' : 'text'}
          onSave={onSave}
        />
      );

    case 'NUMBER':
      return <NumberField id={id} value={asString(value)} onSave={onSave} />;

    case 'TEXTAREA':
      return <TextAreaField id={id} value={asString(value)} onSave={onSave} />;

    case 'DATE':
      return <DateField id={id} value={asString(value).slice(0, 10)} onSave={onSave} />;

    case 'DATETIME':
      return <DateTimeField id={id} value={toDateTimeInput(asString(value))} onSave={onSave} />;

    case 'CHECKBOX':
      return (
        <input
          id={id}
          type="checkbox"
          checked={value === true}
          disabled={saving}
          onChange={(e) => onSave(e.target.checked)}
          className="mt-0.5 h-4 w-4 cursor-pointer rounded border-border accent-[var(--primary)] disabled:opacity-50"
        />
      );

    case 'SELECT':
      return (
        <SearchSelect
          id={id}
          value={typeof value === 'string' ? value : ''}
          disabled={saving}
          onChange={(v) => onSave(v === '' ? null : v)}
          options={[
            { value: '', label: '—' },
            ...options.map((o) => ({ value: o.id, label: o.value })),
          ]}
          className="w-full"
        />
      );

    case 'MULTI_SELECT':
      return (
        <MultiSelectField
          value={asStringArray(value)}
          options={options}
          saving={saving}
          onSave={onSave}
        />
      );

    case 'USER':
      // TODO user picker
      return (
        <TextField
          id={id}
          value={asString(value)}
          type="text"
          placeholder="ID người dùng"
          onSave={onSave}
        />
      );

    default:
      return null;
  }
}

/* ---------- Editors có local state đồng bộ từ server ---------- */

function TextField({
  id,
  value,
  type,
  placeholder,
  onSave,
}: {
  id: string;
  value: string;
  type: 'text' | 'url';
  placeholder?: string;
  onSave: (value: unknown) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    if (draft !== value) onSave(draft === '' ? null : draft);
  };
  return (
    <Input
      id={id}
      type={type}
      value={draft}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          (e.target as HTMLInputElement).blur();
        }
      }}
      className="h-9 text-sm"
    />
  );
}

function NumberField({
  id,
  value,
  onSave,
}: {
  id: string;
  value: string;
  onSave: (value: unknown) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    if (draft === value) return;
    onSave(draft.trim() === '' ? null : Number(draft));
  };
  return (
    <Input
      id={id}
      type="number"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          (e.target as HTMLInputElement).blur();
        }
      }}
      className="h-9 text-sm tabular"
    />
  );
}

function TextAreaField({
  id,
  value,
  onSave,
}: {
  id: string;
  value: string;
  onSave: (value: unknown) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    if (draft !== value) onSave(draft === '' ? null : draft);
  };
  return (
    <textarea
      id={id}
      rows={3}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      className={cn(
        'w-full resize-y bg-bg',
        'rounded-md border border-border px-3 py-2 text-sm text-ink',
        'placeholder:text-faint focus-visible:outline-none focus-visible:border-primary',
      )}
    />
  );
}

/** Lưu khi ô chốt giá trị (Enter / rời ô / chọn từ lịch) — không lưu mỗi phím gõ dở. */
function saveDate(raw: string, onSave: (value: unknown) => void) {
  if (raw === '') return onSave(null);
  const d = new Date(raw);
  if (!Number.isNaN(d.getTime())) onSave(d.toISOString());
}

function DateField({
  id,
  value,
  onSave,
}: {
  id: string;
  value: string;
  onSave: (value: unknown) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <DateInput
      id={id}
      value={draft}
      onChange={(iso) => {
        setDraft(iso);
        if (iso === '') saveDate('', onSave);
      }}
      onCommit={(iso) => saveDate(iso, onSave)}
      className="h-9 text-sm tabular"
    />
  );
}

function DateTimeField({
  id,
  value,
  onSave,
}: {
  id: string;
  value: string;
  onSave: (value: unknown) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <DateTimeInput
      id={id}
      value={draft}
      onChange={(v) => {
        setDraft(v);
        if (v === '') saveDate('', onSave);
      }}
      onCommit={(v) => saveDate(v, onSave)}
      className="text-sm tabular"
    />
  );
}

function MultiSelectField({
  value,
  options,
  saving,
  onSave,
}: {
  value: string[];
  options: CustomFieldOption[];
  saving: boolean;
  onSave: (value: unknown) => void;
}) {
  if (options.length === 0) return <span className="pt-1 text-faint">Chưa có lựa chọn.</span>;
  const selected = new Set(value);
  const toggle = (optionId: string) => {
    const next = new Set(selected);
    if (next.has(optionId)) next.delete(optionId);
    else next.add(optionId);
    onSave([...next]);
  };
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const on = selected.has(o.id);
        return (
          <button
            key={o.id}
            type="button"
            aria-pressed={on}
            disabled={saving}
            onClick={() => toggle(o.id)}
            className={cn(
              'rounded-full border px-2.5 py-0.5 text-xs transition-colors disabled:opacity-50',
              on
                ? 'border-primary bg-primary text-primary-fg'
                : 'border-border bg-surface text-muted hover:bg-surface-2',
            )}
          >
            {o.value}
          </button>
        );
      })}
    </div>
  );
}

/* ---------- helpers narrow `unknown`/CustomFieldValue ---------- */

function asString(value: CustomFieldValue): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return '';
}

function asStringArray(value: CustomFieldValue): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}
