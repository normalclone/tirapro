import { useEffect, useMemo, useRef, useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { Check, ChevronDown, Copy, Plus, Trash2, Wand2, X } from 'lucide-react';
import { toast } from 'sonner';
import {
  CURRENT_USER_TOKEN,
  isCategoricalField,
  isRelativeDateToken,
  jqlFieldType,
  serializeSimpleQuery,
  tryParseToSimpleQuery,
  type BuilderOperator,
  type JqlFieldName,
  type SimpleCondition,
  type SimpleQuery,
} from '@tirapro/shared';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { SearchSelect } from '@/components/ui/SearchSelect';
import { cn } from '@/lib/utils';
import { useProjects } from '@/features/projects/api';
import { useWorkspaceUsers } from '@/features/members/api';
import { useFilterFields, type FieldOption } from './api';

/* ------------------------------------------------------------------ */
/* Metadata field (nhãn tiếng Việt + thứ tự hiển thị)                  */
/* ------------------------------------------------------------------ */

const FIELD_DEFS: { field: JqlFieldName; label: string }[] = [
  { field: 'project', label: 'Dự án' },
  { field: 'type', label: 'Loại' },
  { field: 'status', label: 'Trạng thái' },
  { field: 'statusCategory', label: 'Nhóm trạng thái' },
  { field: 'priority', label: 'Độ ưu tiên' },
  { field: 'assignee', label: 'Người được giao' },
  { field: 'reporter', label: 'Người báo cáo' },
  { field: 'sprint', label: 'Sprint' },
  { field: 'labels', label: 'Nhãn' },
  { field: 'resolution', label: 'Cách giải quyết' },
  { field: 'text', label: 'Văn bản (toàn văn)' },
  { field: 'summary', label: 'Tiêu đề' },
  { field: 'created', label: 'Ngày tạo' },
  { field: 'updated', label: 'Ngày cập nhật' },
  { field: 'due', label: 'Hạn chót' },
  { field: 'storyPoints', label: 'Story point' },
];

const FIELD_LABEL: Record<string, string> = Object.fromEntries(
  FIELD_DEFS.map((d) => [d.field, d.label]),
);

/** Nhóm trạng thái: enum cố định, khớp Status.category ở backend. */
const STATUS_CATEGORY_OPTIONS: FieldOption[] = [
  { value: 'TODO', label: 'Cần làm' },
  { value: 'IN_PROGRESS', label: 'Đang làm' },
  { value: 'DONE', label: 'Hoàn thành' },
];

const ME_OPTION: FieldOption = { value: CURRENT_USER_TOKEN, label: 'Tôi' };

type OperatorChoice = { value: BuilderOperator; label: string };

/** Toán tử thân thiện theo loại field. */
function operatorsFor(field: JqlFieldName): OperatorChoice[] {
  const t = jqlFieldType(field);
  if (t === 'text' || t === 'fulltext') {
    return [
      { value: '~', label: 'chứa' },
      { value: '!~', label: 'không chứa' },
      { value: 'IS', label: 'trống' },
      { value: 'IS NOT', label: 'có giá trị' },
    ];
  }
  if (t === 'date') {
    return [
      { value: '>=', label: 'từ ngày' },
      { value: '<=', label: 'đến ngày' },
      { value: '=', label: 'đúng ngày' },
      { value: 'IS', label: 'trống' },
      { value: 'IS NOT', label: 'có giá trị' },
    ];
  }
  if (t === 'number') {
    return [
      { value: '=', label: 'bằng' },
      { value: '>', label: 'lớn hơn' },
      { value: '>=', label: 'tối thiểu' },
      { value: '<', label: 'nhỏ hơn' },
      { value: '<=', label: 'tối đa' },
      { value: 'IS', label: 'trống' },
      { value: 'IS NOT', label: 'có giá trị' },
    ];
  }
  // categorical (ref / enumRef / enum / user / array)
  return [
    { value: 'IN', label: 'là' },
    { value: 'NOT IN', label: 'không là' },
    { value: 'IS', label: 'trống' },
    { value: 'IS NOT', label: 'có giá trị' },
  ];
}

function defaultOperator(field: JqlFieldName): BuilderOperator {
  const t = jqlFieldType(field);
  if (t === 'text' || t === 'fulltext') return '~';
  if (t === 'date') return '>=';
  if (t === 'number') return '=';
  return 'IN';
}

const needsValue = (op: BuilderOperator) => op !== 'IS' && op !== 'IS NOT';

/* ------------------------------------------------------------------ */
/* QueryBuilder                                                        */
/* ------------------------------------------------------------------ */

const EMPTY_QUERY: SimpleQuery = { combinator: 'AND', conditions: [], sort: null };

export function QueryBuilder({
  value,
  onChange,
  onEditAsJql,
}: {
  value: string;
  onChange: (jql: string) => void;
  onEditAsJql: () => void;
}) {
  const { data: projects } = useProjects();
  const { data: users } = useWorkspaceUsers();
  const { data: fields } = useFilterFields();

  const [query, setQuery] = useState<SimpleQuery>(() => tryParseToSimpleQuery(value) ?? EMPTY_QUERY);
  const [complex, setComplex] = useState(
    () => value.trim() !== '' && tryParseToSimpleQuery(value) === null,
  );
  const lastSerialized = useRef(serializeSimpleQuery(query));
  const idSeq = useRef(0);

  // Đồng bộ khi JQL thay đổi từ bên ngoài (tải bộ lọc đã lưu / sửa ở tab JQL).
  useEffect(() => {
    if (value === lastSerialized.current) return;
    const parsed = tryParseToSimpleQuery(value);
    if (parsed) {
      setQuery(parsed);
      setComplex(false);
      lastSerialized.current = serializeSimpleQuery(parsed);
    } else {
      setComplex(value.trim() !== '');
    }
  }, [value]);

  function commit(next: SimpleQuery) {
    setQuery(next);
    setComplex(false);
    const jql = serializeSimpleQuery(next);
    lastSerialized.current = jql;
    onChange(jql);
  }

  function newId() {
    idSeq.current += 1;
    return `n${idSeq.current}`;
  }

  function addCondition() {
    const field: JqlFieldName = 'project';
    commit({
      ...query,
      conditions: [
        ...query.conditions,
        { id: newId(), field, operator: defaultOperator(field), values: [] },
      ],
    });
  }

  function updateCondition(id: string, patch: Partial<SimpleCondition>) {
    commit({
      ...query,
      conditions: query.conditions.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    });
  }

  function removeCondition(id: string) {
    commit({ ...query, conditions: query.conditions.filter((c) => c.id !== id) });
  }

  const valueSources = useMemo(
    () => ({
      projects: (projects ?? []).map((p) => ({ value: p.key, label: p.name })),
      users: [ME_OPTION, ...(users ?? []).map((u) => ({ value: u.id, label: u.displayName }))],
      fields,
    }),
    [projects, users, fields],
  );

  const previewJql = serializeSimpleQuery(query);

  if (complex) {
    return (
      <div className="flex flex-col items-start gap-3 rounded-lg border border-dashed border-border bg-surface-2 px-4 py-5">
        <p className="text-sm text-ink">
          Truy vấn này dùng cú pháp nâng cao (nhóm lồng nhau, NOT, hoặc trộn AND/OR) nên không hiển
          thị được ở chế độ đơn giản.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={onEditAsJql}>
            Chỉnh trong JQL
          </Button>
          <Button variant="ghost" size="sm" onClick={() => commit(EMPTY_QUERY)}>
            Bắt đầu lại
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {query.conditions.length > 1 && (
        <div className="flex items-center gap-2 text-sm text-muted">
          <span>Khớp</span>
          <Segmented
            value={query.combinator}
            onChange={(v) => commit({ ...query, combinator: v as 'AND' | 'OR' })}
            options={[
              { value: 'AND', label: 'tất cả' },
              { value: 'OR', label: 'bất kỳ' },
            ]}
          />
          <span>điều kiện dưới đây</span>
        </div>
      )}

      {query.conditions.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted">
          Chưa có điều kiện. Thêm một dòng để lọc, hoặc để trống để xem tất cả issue.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {query.conditions.map((c) => (
            <li key={c.id}>
              <ConditionRow
                condition={c}
                sources={valueSources}
                onChange={(patch) => updateCondition(c.id, patch)}
                onRemove={() => removeCondition(c.id)}
              />
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" onClick={addCondition}>
          <Plus className="h-4 w-4" aria-hidden />
          Thêm điều kiện
        </Button>

        <div className="ml-auto flex items-center gap-2">
          <label htmlFor="sort-field" className="text-sm text-muted">
            Sắp xếp
          </label>
          <SearchSelect
            id="sort-field"
            ariaLabel="Sắp xếp theo trường"
            value={query.sort?.field ?? ''}
            onChange={(v) =>
              commit({
                ...query,
                sort: v ? { field: v as JqlFieldName, direction: query.sort?.direction ?? 'DESC' } : null,
              })
            }
            options={[
              { value: '', label: 'Không sắp xếp' },
              ...FIELD_DEFS.map((d) => ({ value: d.field, label: d.label })),
            ]}
            className="w-44"
            align="end"
          />
          {query.sort && (
            <Segmented
              value={query.sort.direction}
              onChange={(v) =>
                commit({ ...query, sort: { field: query.sort!.field, direction: v as 'ASC' | 'DESC' } })
              }
              options={[
                { value: 'DESC', label: 'Giảm' },
                { value: 'ASC', label: 'Tăng' },
              ]}
            />
          )}
        </div>
      </div>

      <JqlPreview jql={previewJql} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Một dòng điều kiện                                                  */
/* ------------------------------------------------------------------ */

interface Sources {
  projects: FieldOption[];
  users: FieldOption[];
  fields: ReturnType<typeof useFilterFields>['data'];
}

/** Nguồn lựa chọn cho field phân loại; null nếu là input tự do (date/number/text). */
function optionsForField(field: JqlFieldName, sources: Sources): FieldOption[] | null {
  switch (field) {
    case 'project':
      return sources.projects;
    case 'assignee':
    case 'reporter':
      return sources.users;
    case 'statusCategory':
      return STATUS_CATEGORY_OPTIONS;
    case 'type':
      return sources.fields?.types ?? [];
    case 'status':
      return sources.fields?.statuses ?? [];
    case 'priority':
      return sources.fields?.priorities ?? [];
    case 'sprint':
      return sources.fields?.sprints ?? [];
    case 'labels':
      return sources.fields?.labels ?? [];
    case 'resolution':
      return sources.fields?.resolutions ?? [];
    default:
      return null;
  }
}

function ConditionRow({
  condition,
  sources,
  onChange,
  onRemove,
}: {
  condition: SimpleCondition;
  sources: Sources;
  onChange: (patch: Partial<SimpleCondition>) => void;
  onRemove: () => void;
}) {
  const { field, operator, values } = condition;
  const operatorChoices = operatorsFor(field);

  function onFieldChange(next: JqlFieldName) {
    onChange({ field: next, operator: defaultOperator(next), values: [] });
  }

  function onOperatorChange(next: BuilderOperator) {
    // Chuyển sang/khỏi IS/IS NOT thì xoá giá trị cho khớp.
    const keepValues = needsValue(next) && needsValue(operator);
    onChange({ operator: next, values: keepValues ? values : [] });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <SearchSelect
        ariaLabel="Trường"
        value={field}
        onChange={(v) => onFieldChange(v as JqlFieldName)}
        options={FIELD_DEFS.map((d) => ({ value: d.field, label: d.label }))}
        className="w-40"
      />

      <SelectField
        aria-label="Điều kiện"
        value={operator}
        onChange={(e) => onOperatorChange(e.target.value as BuilderOperator)}
        className="w-32"
      >
        {operatorChoices.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </SelectField>

      <div className="min-w-[12rem] flex-1">
        <ValueControl
          field={field}
          operator={operator}
          values={values}
          sources={sources}
          onChange={(next) => onChange({ values: next })}
        />
      </div>

      <Button
        variant="ghost"
        size="icon"
        onClick={onRemove}
        aria-label="Xoá điều kiện"
        className="h-8 w-8 shrink-0 text-muted hover:text-danger"
      >
        <Trash2 className="h-4 w-4" aria-hidden />
      </Button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Điều khiển giá trị (theo loại field + toán tử)                      */
/* ------------------------------------------------------------------ */

function ValueControl({
  field,
  operator,
  values,
  sources,
  onChange,
}: {
  field: JqlFieldName;
  operator: BuilderOperator;
  values: string[];
  sources: Sources;
  onChange: (next: string[]) => void;
}) {
  if (!needsValue(operator)) {
    return <span className="block px-1 text-sm text-faint">— không cần giá trị</span>;
  }

  const t = jqlFieldType(field);

  if (t === 'date') {
    return <DateValueControl value={values[0] ?? ''} onChange={(v) => onChange(v ? [v] : [])} />;
  }
  if (t === 'number') {
    return (
      <Input
        type="number"
        inputMode="decimal"
        placeholder="Nhập số…"
        value={values[0] ?? ''}
        onChange={(e) => onChange(e.target.value ? [e.target.value] : [])}
        className="text-sm"
      />
    );
  }

  const options = optionsForField(field, sources);
  if (!options) {
    // text / fulltext
    return (
      <Input
        type="text"
        placeholder="Nhập từ khoá…"
        value={values[0] ?? ''}
        onChange={(e) => onChange(e.target.value ? [e.target.value] : [])}
        className="text-sm"
      />
    );
  }

  // Field phân loại → chọn nhiều. Cho thêm giá trị tự do (trừ user / nhóm trạng thái).
  const allowCustom = field !== 'assignee' && field !== 'reporter' && field !== 'statusCategory';
  return (
    <MultiSelect
      options={options}
      selected={values}
      onChange={onChange}
      allowCustom={allowCustom}
      placeholder="Chọn giá trị…"
    />
  );
}

/* ------------------------------------------------------------------ */
/* Điều khiển ngày: tương đối (động) hoặc ngày cụ thể                  */
/* ------------------------------------------------------------------ */

/** Preset ngày tương đối → token JQL (compiler giải lúc chạy nên bộ lọc luôn cập nhật). */
const RELATIVE_DATE_PRESETS: { value: string; label: string }[] = [
  { value: 'startOfDay()', label: 'Hôm nay' },
  { value: '-1d', label: 'Hôm qua trở đi' },
  { value: '-7d', label: '7 ngày qua' },
  { value: '-30d', label: '30 ngày qua' },
  { value: '-90d', label: '90 ngày qua' },
  { value: 'startOfWeek()', label: 'Đầu tuần này' },
  { value: 'startOfMonth()', label: 'Đầu tháng này' },
  { value: '-1m', label: '1 tháng qua' },
  { value: 'now()', label: 'Bây giờ' },
];

const ABS_SENTINEL = '__abs__';

/** Ngày dạng yyyy-mm-dd (input type=date) → không phải token tương đối. */
function isAbsoluteDate(v: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(v);
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function DateValueControl({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const absolute = isAbsoluteDate(value);
  // Token tương đối lạ (gõ tay trong JQL) vẫn hiện được nhờ thêm tạm vào danh sách.
  const presets =
    value && !absolute && !RELATIVE_DATE_PRESETS.some((p) => p.value === value) && isRelativeDateToken(value)
      ? [{ value, label: value }, ...RELATIVE_DATE_PRESETS]
      : RELATIVE_DATE_PRESETS;

  return (
    <div className="flex items-center gap-2">
      <SelectField
        aria-label="Loại ngày"
        value={absolute ? ABS_SENTINEL : value}
        onChange={(e) => {
          const v = e.target.value;
          onChange(v === ABS_SENTINEL ? todayIso() : v);
        }}
        className="min-w-0 flex-1"
      >
        <option value="">— chọn mốc —</option>
        <optgroup label="Tương đối">
          {presets.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </optgroup>
        <option value={ABS_SENTINEL}>Ngày cụ thể…</option>
      </SelectField>
      {absolute && (
        <Input
          type="date"
          aria-label="Ngày cụ thể"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-40 text-sm"
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* MultiSelect (Radix Popover + tìm kiếm + chọn nhiều)                 */
/* ------------------------------------------------------------------ */

function MultiSelect({
  options,
  selected,
  onChange,
  allowCustom,
  placeholder,
}: {
  options: FieldOption[];
  selected: string[];
  onChange: (next: string[]) => void;
  allowCustom?: boolean;
  placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');

  const labelFor = (v: string) => options.find((o) => o.value === v)?.label ?? v;
  const filtered = options.filter(
    (o) =>
      o.label.toLowerCase().includes(q.toLowerCase()) ||
      o.value.toLowerCase().includes(q.toLowerCase()),
  );
  const trimmed = q.trim();
  const canAdd =
    !!allowCustom &&
    trimmed.length > 0 &&
    !options.some((o) => o.value.toLowerCase() === trimmed.toLowerCase()) &&
    !selected.includes(trimmed);

  function toggle(v: string) {
    onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);
  }

  const summary =
    selected.length === 0
      ? null
      : selected.slice(0, 2).map(labelFor).join(', ') +
        (selected.length > 2 ? ` +${selected.length - 2}` : '');

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className={cn(
            'flex h-9 w-full items-center gap-2 rounded-md border border-border bg-bg px-3 text-left text-sm transition-colors',
            'focus-visible:outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
            'data-[state=open]:border-primary',
          )}
        >
          <span className={cn('min-w-0 flex-1 truncate', summary ? 'text-ink' : 'text-faint')}>
            {summary ?? placeholder}
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 text-faint" aria-hidden />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={4}
          className="z-dropdown w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-lg border border-border bg-surface shadow-lg outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
        >
          <div className="border-b border-border p-2">
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Tìm…"
              autoFocus
              className="h-8 text-sm"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && canAdd) {
                  e.preventDefault();
                  toggle(trimmed);
                  setQ('');
                }
              }}
            />
          </div>
          <ul className="max-h-64 overflow-y-auto p-1" role="listbox" aria-multiselectable>
            {filtered.map((o) => {
              const active = selected.includes(o.value);
              return (
                <li key={o.value}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={active}
                    onClick={() => toggle(o.value)}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-ink transition-colors hover:bg-surface-2"
                  >
                    <span
                      className={cn(
                        'grid h-4 w-4 shrink-0 place-items-center rounded border',
                        active ? 'border-primary bg-primary text-primary-fg' : 'border-border',
                      )}
                    >
                      {active && <Check className="h-3 w-3" aria-hidden />}
                    </span>
                    {o.color && (
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ background: o.color }}
                        aria-hidden
                      />
                    )}
                    <span className="min-w-0 flex-1 truncate">{o.label}</span>
                  </button>
                </li>
              );
            })}
            {canAdd && (
              <li>
                <button
                  type="button"
                  onClick={() => {
                    toggle(trimmed);
                    setQ('');
                  }}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-primary transition-colors hover:bg-surface-2"
                >
                  <Plus className="h-4 w-4 shrink-0" aria-hidden />
                  Thêm “{trimmed}”
                </button>
              </li>
            )}
            {filtered.length === 0 && !canAdd && (
              <li className="px-2 py-3 text-center text-sm text-muted">Không có lựa chọn</li>
            )}
          </ul>

          {selected.length > 0 && (
            <div className="flex flex-wrap gap-1.5 border-t border-border p-2">
              {selected.map((v) => (
                <span
                  key={v}
                  className="inline-flex items-center gap-1 rounded-full bg-primary-subtle px-2 py-0.5 text-xs text-primary"
                >
                  {labelFor(v)}
                  <button
                    type="button"
                    onClick={() => toggle(v)}
                    aria-label={`Bỏ ${labelFor(v)}`}
                    className="grid h-3.5 w-3.5 place-items-center rounded-full hover:bg-primary/20"
                  >
                    <X className="h-3 w-3" aria-hidden />
                  </button>
                </span>
              ))}
            </div>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/* ------------------------------------------------------------------ */
/* JQL preview (read-only, dạy cú pháp)                                */
/* ------------------------------------------------------------------ */

function JqlPreview({ jql }: { jql: string }) {
  function copy() {
    if (!jql) return;
    void navigator.clipboard?.writeText(jql);
    toast.success('Đã chép JQL');
  }
  return (
    <div className="rounded-md border border-border bg-surface-2 px-3 py-2">
      <div className="mb-1 flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-xs font-medium text-muted">
          <Wand2 className="h-3.5 w-3.5" aria-hidden />
          JQL sinh ra
        </span>
        <button
          type="button"
          onClick={copy}
          disabled={!jql}
          className="flex items-center gap-1 text-xs text-muted transition-colors hover:text-ink disabled:opacity-40"
        >
          <Copy className="h-3.5 w-3.5" aria-hidden />
          Chép
        </button>
      </div>
      <code className="block break-all font-mono text-xs text-ink">
        {jql || 'Tất cả issue (không có điều kiện lọc)'}
      </code>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Primitives dùng chung trong builder                                 */
/* ------------------------------------------------------------------ */

function SelectField({
  className,
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        'h-9 rounded-md border border-border bg-bg px-2.5 text-sm text-ink transition-colors',
        'focus-visible:outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}

/** Segmented control 2–3 lựa chọn (combinator, hướng sort, tab chế độ). */
export function Segmented({
  value,
  onChange,
  options,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  className?: string;
}) {
  return (
    <div
      role="tablist"
      className={cn('inline-flex rounded-md border border-border bg-surface-2 p-0.5', className)}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(o.value)}
            className={cn(
              'rounded-[5px] px-2.5 py-1 text-sm font-medium transition-colors',
              active ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink',
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
