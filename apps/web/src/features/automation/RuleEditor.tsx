import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Plus, X } from 'lucide-react';
import { toast } from 'sonner';
import { SYSTEM_ROLES, type RuleTrigger } from '@tirapro/types';
import {
  RULE_CONDITION_FIELDS,
  RULE_TRIGGERS,
  type CreateRuleInput,
  type RuleAction,
  type RuleCondition,
} from '@tirapro/shared';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { ErrorSummary } from '@/components/ui/ErrorSummary';
import { FieldErrorText } from '@/components/ui/FieldError';
import { FormField } from '@/components/ui/FormField';
import { Input } from '@/components/ui/Input';
import { SearchSelect, type SearchSelectOption } from '@/components/ui/SearchSelect';
import { useProjectMeta } from '@/features/ai/api';
import { useProjectSprints } from '@/features/backlog/api';
import { useUserSelect } from '@/features/members/useUserSelect';
import { useProjectLabels } from '@/features/issue-meta/api';
import { useProjects } from '@/features/projects/api';
import { QueryBuilder } from '@/features/saved-filters/QueryBuilder';
import { useWorkflows } from '@/features/workflow-settings/api';
import { INVALID_FIELD_CLS, fieldErrorId } from '@/lib/formErrors';
import { useErrorFlow } from '@/lib/useErrorFlow';
import { ConditionSentence } from './ConditionSentence';
import { Field } from './IssueDefaultsFields';
import {
  RULE_ACTIONS_ID,
  RULE_CONDITIONS_ID,
  RULE_NAME_ID,
  RULE_TRIGGER_ID,
  actionFieldId,
  conditionFieldId,
  conditionJqlId,
  validateRulePayload,
  type RuleValidation,
} from './ruleErrors';
import {
  ACTION_LABELS,
  FIELD_LABELS,
  OP_LABELS,
  TRIGGER_LABELS,
  useCreateRule,
  useUpdateRule,
  type AutomationRule,
} from './rules-api';

/* ------------------------------ bản nháp ------------------------------ */

type FieldName = (typeof RULE_CONDITION_FIELDS)[number];
type Op = 'eq' | 'neq' | 'in' | 'nin' | 'empty' | 'notEmpty' | 'contains';
type ActionType = RuleAction['type'];

type CondDraft =
  | { id: string; kind: 'field'; field: FieldName; op: Op; value: string; values: string[] }
  | { id: string; kind: 'jql'; jql: string; raw: boolean };

/** Hợp mọi trường của các action (mỗi loại chỉ dùng một phần) — chuyển thành `RuleAction` khi lưu. */
interface ActionDraft {
  id: string;
  type: ActionType;
  field: 'priorityId' | 'assigneeId' | 'sprintId' | 'dueDate' | 'storyPoints';
  value: string;
  mode: 'reporter' | 'lead' | 'user' | 'roundRobin';
  userId: string;
  toStatusId: string;
  labelId: string;
  body: string;
  userIds: string[];
  roles: string[];
  message: string;
  url: string;
  secret: string;
  summary: string;
  typeId: string;
}

interface Draft {
  name: string;
  projectId: string; // '' = cả workspace
  trigger: RuleTrigger;
  toStatusId: string;
  fields: string[];
  cron: string;
  conditions: CondDraft[];
  actions: ActionDraft[];
}

let seq = 0;
const uid = () => `d${++seq}`;

/** Trường điều kiện hiển thị trong UI (kết quả xử lý chưa có danh sách chọn nên ẩn). */
const UI_FIELDS = RULE_CONDITION_FIELDS.filter((f) => f !== 'resolutionId');
const ID_FIELDS: FieldName[] = [
  'statusId',
  'priorityId',
  'assigneeId',
  'reporterId',
  'typeId',
  'sprintId',
];
const NUMERIC_OPS: Op[] = ['eq', 'neq', 'empty', 'notEmpty'];
const OPS_BY_KIND = {
  id: ['eq', 'neq', 'in', 'nin', 'empty', 'notEmpty'] as Op[],
  labels: ['eq', 'neq', 'in', 'empty', 'notEmpty'] as Op[],
  text: ['contains', 'eq', 'neq', 'empty', 'notEmpty'] as Op[],
  number: NUMERIC_OPS,
  date: ['eq', 'empty', 'notEmpty'] as Op[],
};
const kindOf = (f: FieldName) =>
  ID_FIELDS.includes(f)
    ? 'id'
    : f === 'labelIds'
      ? 'labels'
      : f === 'summary'
        ? 'text'
        : f === 'storyPoints'
          ? 'number'
          : 'date';

/** Trường của issue mà quy tắc ISSUE_UPDATED có thể lọc theo "vừa đổi". */
const UPDATE_FIELD_CHOICES: Array<[string, string]> = [
  ['summary', 'Tiêu đề'],
  ['description', 'Mô tả'],
  ['priorityId', 'Mức ưu tiên'],
  ['assigneeId', 'Người làm'],
  ['storyPoints', 'Điểm ước lượng'],
  ['sprintId', 'Sprint'],
  ['dueDate', 'Hạn'],
  ['typeId', 'Loại công việc'],
  ['timeSpent', 'Thời gian đã làm'],
];

const CRON_PRESETS: Array<[string, string]> = [
  ['0 9 * * 1-5', 'Các ngày trong tuần, 9:00'],
  ['0 9 * * 1', 'Thứ hai hằng tuần, 9:00'],
  ['0 */4 * * *', 'Mỗi 4 giờ'],
];

const newAction = (type: ActionType = 'assign'): ActionDraft => ({
  id: uid(),
  type,
  field: 'priorityId',
  value: '',
  mode: 'lead',
  userId: '',
  toStatusId: '',
  labelId: '',
  body: '',
  userIds: [],
  roles: [],
  message: '',
  url: '',
  secret: '',
  summary: '',
  typeId: '',
});

const newCondition = (): CondDraft => ({
  id: uid(),
  kind: 'field',
  field: 'priorityId',
  op: 'eq',
  value: '',
  values: [],
});

function fromRule(rule: AutomationRule | null, defaultProjectId: string): Draft {
  if (!rule) {
    return {
      name: '',
      projectId: defaultProjectId,
      trigger: 'ISSUE_CREATED',
      toStatusId: '',
      fields: [],
      cron: '',
      conditions: [],
      actions: [newAction()],
    };
  }
  return {
    name: rule.name,
    projectId: rule.projectId ?? '',
    trigger: rule.trigger,
    toStatusId: rule.triggerConfig.toStatusId ?? '',
    fields: rule.triggerConfig.fields ?? [],
    cron: rule.triggerConfig.cron ?? '',
    conditions: rule.conditions.map((c): CondDraft => {
      if ('jql' in c) return { id: uid(), kind: 'jql', jql: c.jql, raw: false };
      const list = Array.isArray(c.value) ? c.value.map(String) : [];
      return {
        id: uid(),
        kind: 'field',
        field: c.field,
        op: c.op,
        value: typeof c.value === 'string' || typeof c.value === 'number' ? String(c.value) : '',
        values: list,
      };
    }),
    actions: rule.actions.map((a): ActionDraft => {
      const d = newAction(a.type);
      switch (a.type) {
        case 'setField':
          return { ...d, field: a.field, value: a.value === null ? '' : String(a.value) };
        case 'assign':
          return { ...d, mode: a.mode, userId: a.userId ?? '' };
        case 'transition':
          return { ...d, toStatusId: a.toStatusId };
        case 'addLabel':
        case 'removeLabel':
          return { ...d, labelId: a.labelId };
        case 'addComment':
          return { ...d, body: a.body };
        case 'notify':
          return { ...d, userIds: a.userIds ?? [], roles: a.roles ?? [], message: a.message };
        case 'webhook':
          return { ...d, url: a.url, secret: a.secret ?? '' };
        case 'createSubtask':
          return { ...d, summary: a.summary, typeId: a.typeId };
      }
    }),
  };
}

function toCondition(c: CondDraft): RuleCondition {
  if (c.kind === 'jql') return { jql: c.jql.trim() };
  if (c.op === 'empty' || c.op === 'notEmpty') return { field: c.field, op: c.op };
  if (c.op === 'in' || c.op === 'nin') return { field: c.field, op: c.op, value: c.values };
  if (c.field === 'labelIds') return { field: c.field, op: c.op, value: c.value };
  if (c.field === 'storyPoints') return { field: c.field, op: c.op, value: Number(c.value) };
  return { field: c.field, op: c.op, value: c.value };
}

function toAction(a: ActionDraft): unknown {
  switch (a.type) {
    case 'setField': {
      const empty = a.value.trim() === '';
      const value = empty
        ? null
        : a.field === 'storyPoints'
          ? Number(a.value)
          : a.field === 'dueDate'
            ? new Date(a.value).toISOString()
            : a.value;
      return { type: 'setField', field: a.field, value };
    }
    case 'assign':
      return { type: 'assign', mode: a.mode, ...(a.mode === 'user' ? { userId: a.userId } : {}) };
    case 'transition':
      return { type: 'transition', toStatusId: a.toStatusId };
    case 'addLabel':
    case 'removeLabel':
      return { type: a.type, labelId: a.labelId };
    case 'addComment':
      return { type: 'addComment', body: a.body };
    case 'notify':
      return { type: 'notify', userIds: a.userIds, roles: a.roles, message: a.message };
    case 'webhook':
      return { type: 'webhook', url: a.url.trim(), ...(a.secret ? { secret: a.secret } : {}) };
    case 'createSubtask':
      return { type: 'createSubtask', summary: a.summary, typeId: a.typeId };
  }
}

function toPayload(d: Draft): unknown {
  const triggerConfig =
    d.trigger === 'ISSUE_TRANSITIONED'
      ? d.toStatusId
        ? { toStatusId: d.toStatusId }
        : {}
      : d.trigger === 'ISSUE_UPDATED'
        ? d.fields.length
          ? { fields: d.fields }
          : {}
        : d.trigger === 'SCHEDULED'
          ? { cron: d.cron.trim() }
          : {};
  return {
    name: d.name,
    projectId: d.projectId || null,
    trigger: d.trigger,
    triggerConfig,
    conditions: d.conditions.map(toCondition),
    actions: d.actions.map(toAction),
  };
}

/** Kiểm bản nháp: MỌI lỗi theo trường (xem `ruleErrors`). Payload vẫn là `toPayload(draft)`, không đổi. */
function checkDraft(d: Draft): RuleValidation {
  const ids = { conditions: d.conditions.map((c) => c.id), actions: d.actions.map((a) => a.id) };
  try {
    return validateRulePayload(toPayload(d), ids);
  } catch {
    // `toISOString` ném với ngày không biểu diễn được; coi là lỗi ở khối hành động thay vì làm hỏng trang.
    return {
      ok: false,
      errors: [
        { id: RULE_ACTIONS_ID, label: 'Hành động', message: 'Có giá trị ngày không hợp lệ' },
      ],
    };
  }
}

/* ------------------------------ dữ liệu chọn ------------------------------ */

interface UserPick {
  onSearchChange: (q: string) => void;
  moreHint: boolean;
  resolveOption: (id: string) => SearchSelectOption | undefined;
}

interface Options {
  priorities: SearchSelectOption[];
  types: SearchSelectOption[];
  subtaskTypes: SearchSelectOption[];
  statuses: SearchSelectOption[];
  users: SearchSelectOption[];
  /** Tìm người phía máy chủ cho mọi ô chọn người (props rải thẳng vào SearchSelect/MultiPick). */
  userPick: UserPick;
  labels: SearchSelectOption[];
  sprints: SearchSelectOption[];
}

function useOptions(projectId: string): Options {
  const { data: projects } = useProjects();
  const metaKey = projects?.find((p) => p.id === projectId)?.key ?? projects?.[0]?.key;
  const { data: meta } = useProjectMeta(metaKey);
  const { data: workflows } = useWorkflows();
  // Chọn người: tìm phía máy chủ (theo dự án của quy tắc nếu có), loại tài khoản khoá; giá trị cũ tra tên theo id.
  const people = useUserSelect({ projectId: projectId || undefined });
  const { data: labels } = useProjectLabels(projectId || undefined);
  const { data: sprints } = useProjectSprints(projectId || undefined);
  return useMemo(() => {
    const real = (workflows ?? []).filter((w) => !w.isTemplate);
    const multi = real.length > 1;
    return {
      priorities: (meta?.priorities ?? []).map((p) => ({
        value: p.id,
        label: p.name,
        color: p.color,
      })),
      types: (meta?.issueTypes ?? []).map((t) => ({ value: t.id, label: t.name, color: t.color })),
      subtaskTypes: (meta?.issueTypes ?? [])
        .filter((t) => t.isSubtask)
        .map((t) => ({ value: t.id, label: t.name, color: t.color })),
      statuses: real.flatMap((w) =>
        w.statuses.map((s) => ({
          value: s.id,
          label: s.name,
          color: s.color,
          hint: multi ? w.name : undefined,
        })),
      ),
      users: people.options,
      userPick: {
        onSearchChange: people.onSearchChange,
        moreHint: people.moreHint,
        resolveOption: people.resolveOption,
      },
      labels: (labels ?? []).map((l) => ({ value: l.id, label: l.name, color: l.color })),
      sprints: (sprints ?? []).map((s) => ({ value: s.id, label: s.name })),
    };
  }, [meta, workflows, people, labels, sprints]);
}

function optionsForField(f: FieldName, o: Options): SearchSelectOption[] {
  switch (f) {
    case 'statusId':
      return o.statuses;
    case 'priorityId':
      return o.priorities;
    case 'assigneeId':
    case 'reporterId':
      return o.users;
    case 'typeId':
      return o.types;
    case 'sprintId':
      return o.sprints;
    case 'labelIds':
      return o.labels;
    default:
      return [];
  }
}

/* ------------------------------ phần tử giao diện ------------------------------ */

/** Cách giao việc: nhãn dài nên mỗi mục kèm một dòng mô tả (ngắn, đúng với `issue-patch.ts` phía API). */
const ASSIGN_MODE_OPTIONS: SearchSelectOption[] = [
  {
    value: 'lead',
    label: 'Trưởng dự án (lead)',
    description: 'Người đứng đầu dự án chứa công việc',
  },
  { value: 'reporter', label: 'Người báo cáo', description: 'Giao lại cho người đã tạo công việc' },
  {
    value: 'roundRobin',
    label: 'Luân phiên giữa các thành viên',
    description: 'Lần lượt từng thành viên đang hoạt động',
  },
  { value: 'user', label: 'Một người cụ thể', description: 'Chọn một người cố định bên cạnh' },
];

/**
 * Một ô + lời lỗi của nó (id `<id>-error`, nối vào `aria-describedby`). Bọc trong khung riêng để lời lỗi không thành ô
 * lưới thừa trong các hàng `grid`. Ô nhận `{id, invalid, aria-describedby}` rải thẳng vào `Input`/`SearchSelect`.
 */
function Err({
  id,
  error,
  children,
}: {
  id: string;
  error?: string;
  children: (a: {
    id: string;
    invalid: boolean;
    'aria-describedby': string | undefined;
  }) => ReactNode;
}) {
  return (
    <div className="min-w-0">
      {children({
        id,
        invalid: !!error,
        'aria-describedby': error ? fieldErrorId(id) : undefined,
      })}
      {error && <FieldErrorText id={fieldErrorId(id)}>{error}</FieldErrorText>}
    </div>
  );
}

function Card({
  children,
  onRemove,
  label,
}: {
  children: ReactNode;
  onRemove?: () => void;
  label: string;
}) {
  return (
    <div className="relative rounded-md border border-border bg-bg p-3 pr-12">
      {children}
      {onRemove && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="absolute right-1 top-1 h-7 w-7 text-muted hover:text-danger"
          onClick={onRemove}
          aria-label={`Xoá ${label}`}
          title={`Xoá ${label}`}
        >
          <X className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}

function StepHeader({ n, title, hint }: { n: number; title: string; hint: string }) {
  return (
    <div className="mb-3 flex items-start gap-3">
      <span
        className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-primary text-xs font-semibold text-primary-fg"
        aria-hidden
      >
        {n}
      </span>
      <div>
        <h3 className="text-sm font-semibold text-ink-strong">{title}</h3>
        <p className="text-xs text-muted">{hint}</p>
      </div>
    </div>
  );
}

/** Chọn nhiều giá trị bằng hộp tick (danh sách ngắn: người, nhãn, vai trò…). */
function MultiPick({
  options,
  value,
  onChange,
  empty,
  ariaLabel,
  pick,
  id,
  invalid,
  'aria-describedby': describedByProp,
}: {
  options: SearchSelectOption[];
  value: string[];
  onChange: (v: string[]) => void;
  empty: string;
  ariaLabel: string;
  /** Chọn người: có ô tìm phía máy chủ; mục đã chọn không nằm trong kết quả vẫn hiện (tra tên theo id). */
  pick?: UserPick;
  /** Id khối (đích của `ErrorSummary`); `invalid` → viền danger. */
  id?: string;
  invalid?: boolean;
  'aria-describedby'?: string;
}) {
  if (!options.length && !pick && !value.length)
    return (
      <p id={id} className="text-xs text-faint">
        {empty}
      </p>
    );
  const toggle = (v: string) =>
    onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
  const shown = pick
    ? [
        ...options,
        ...value.flatMap((id) =>
          options.some((o) => o.value === id)
            ? []
            : [pick.resolveOption(id) ?? { value: id, label: id }],
        ),
      ]
    : options;
  return (
    <div
      id={id}
      className={`rounded-md border bg-surface ${invalid ? INVALID_FIELD_CLS : 'border-border'}`}
    >
      {pick && (
        <Input
          aria-label={`Tìm — ${ariaLabel}`}
          placeholder="Tìm người…"
          onChange={(e) => pick.onSearchChange(e.target.value)}
          className="h-8 rounded-b-none border-0 border-b border-border text-sm"
        />
      )}
      <div
        role="group"
        aria-label={ariaLabel}
        aria-describedby={describedByProp}
        className="max-h-36 overflow-y-auto p-1.5"
      >
        {shown.map((o) => (
          <label
            key={o.value}
            className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm text-ink hover:bg-surface-2"
          >
            <input
              type="checkbox"
              checked={value.includes(o.value)}
              onChange={() => toggle(o.value)}
            />
            <span className="truncate">{o.label}</span>
            {o.hint && <span className="ml-auto truncate text-xs text-faint">{o.hint}</span>}
          </label>
        ))}
        {pick?.moreHint && <p className="px-1.5 py-1 text-xs text-faint">Gõ để tìm thêm</p>}
      </div>
    </div>
  );
}

function ConditionCard({
  c,
  opts,
  onChange,
  errorOf,
}: {
  c: CondDraft;
  opts: Options;
  onChange: (c: CondDraft) => void;
  errorOf: (id: string) => string | undefined;
}) {
  if (c.kind === 'jql') {
    const jqlId = conditionJqlId(c.id);
    const jqlError = errorOf(jqlId);
    return (
      <div className="space-y-2">
        <p className="text-xs font-medium text-muted">Công việc phải khớp bộ lọc JQL</p>
        {c.raw ? (
          <>
            <Input
              id={jqlId}
              invalid={!!jqlError}
              aria-describedby={jqlError ? fieldErrorId(jqlId) : undefined}
              className="font-mono text-sm"
              value={c.jql}
              onChange={(e) => onChange({ ...c, jql: e.target.value })}
              placeholder='priority = High AND status = "In Progress"'
              aria-label="Câu lệnh JQL"
            />
            {jqlError && <FieldErrorText id={fieldErrorId(jqlId)}>{jqlError}</FieldErrorText>}
            <button
              type="button"
              className="text-xs text-primary hover:underline"
              onClick={() => onChange({ ...c, raw: false })}
            >
              Dùng bộ dựng trực quan
            </button>
          </>
        ) : (
          <div id={jqlId} aria-describedby={jqlError ? fieldErrorId(jqlId) : undefined}>
            <QueryBuilder
              value={c.jql}
              onChange={(jql) => onChange({ ...c, jql })}
              onEditAsJql={() => onChange({ ...c, raw: true })}
            />
            {jqlError && <FieldErrorText id={fieldErrorId(jqlId)}>{jqlError}</FieldErrorText>}
          </div>
        )}
      </div>
    );
  }
  const kind = kindOf(c.field);
  const ops = OPS_BY_KIND[kind];
  const needsValue = c.op !== 'empty' && c.op !== 'notEmpty';
  const multi = c.op === 'in' || c.op === 'nin';
  const options = optionsForField(c.field, opts);
  const rowId = conditionFieldId(c.id);
  const rowError = errorOf(rowId);
  return (
    <div id={rowId}>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[10rem_11rem_1fr]">
        <SearchSelect
          ariaLabel="Trường điều kiện"
          value={c.field}
          options={UI_FIELDS.map((f) => ({ value: f, label: FIELD_LABELS[f] ?? f }))}
          onChange={(v) => {
            const field = v as FieldName;
            onChange({
              ...c,
              field,
              op: OPS_BY_KIND[kindOf(field)].includes(c.op) ? c.op : OPS_BY_KIND[kindOf(field)][0]!,
              value: '',
              values: [],
            });
          }}
        />
        <SearchSelect
          ariaLabel="Phép so sánh"
          value={c.op}
          options={ops.map((o) => ({ value: o, label: OP_LABELS[o] ?? o }))}
          onChange={(v) => onChange({ ...c, op: v as Op, values: [] })}
        />
        {needsValue ? (
          multi ? (
            <MultiPick
              pick={options === opts.users ? opts.userPick : undefined}
              options={options}
              value={c.values}
              onChange={(values) => onChange({ ...c, values })}
              empty="Chưa có lựa chọn — hãy chọn phạm vi dự án ở bước 1."
              ariaLabel="Các giá trị"
            />
          ) : options.length || ID_FIELDS.includes(c.field) || c.field === 'labelIds' ? (
            <SearchSelect
              {...(options === opts.users ? opts.userPick : {})}
              value={c.value}
              onChange={(value) => onChange({ ...c, value })}
              options={options}
              placeholder="Chọn…"
              searchPlaceholder="Tìm…"
              ariaLabel="Giá trị"
            />
          ) : (
            <Input
              aria-label="Giá trị"
              type={kind === 'number' ? 'number' : kind === 'date' ? 'date' : 'text'}
              value={c.value}
              onChange={(e) => onChange({ ...c, value: e.target.value })}
              placeholder={kind === 'text' ? 'Từ khoá trong tiêu đề' : ''}
            />
          )
        ) : (
          <span className="self-center text-xs text-faint">Không cần giá trị</span>
        )}
      </div>
      {rowError && <FieldErrorText id={fieldErrorId(rowId)}>{rowError}</FieldErrorText>}
    </div>
  );
}

function ActionCard({
  a,
  opts,
  scoped,
  onChange,
  errorOf,
}: {
  a: ActionDraft;
  opts: Options;
  scoped: boolean;
  onChange: (a: ActionDraft) => void;
  errorOf: (id: string) => string | undefined;
}) {
  const set = (patch: Partial<ActionDraft>) => onChange({ ...a, ...patch });
  const fid = (key: string) => actionFieldId(a.id, key);
  const err = (key: string) => errorOf(fid(key));
  const types = (Object.keys(ACTION_LABELS) as ActionType[]).filter(
    (t) => scoped || (t !== 'addLabel' && t !== 'removeLabel'),
  );
  return (
    <div className="space-y-2">
      <SearchSelect
        ariaLabel="Loại hành động"
        value={a.type}
        options={types.map((t) => ({ value: t, label: ACTION_LABELS[t] }))}
        onChange={(v) => onChange({ ...newAction(v as ActionType), id: a.id })}
      />

      {a.type === 'setField' && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[10rem_1fr]">
          <SearchSelect
            ariaLabel="Trường cần đặt"
            value={a.field}
            options={[
              { value: 'priorityId', label: 'Mức ưu tiên' },
              { value: 'assigneeId', label: 'Người làm' },
              {
                value: 'sprintId',
                label: 'Sprint',
                disabled: !scoped,
                description: scoped ? undefined : 'Chọn dự án trước',
              },
              { value: 'dueDate', label: 'Hạn' },
              { value: 'storyPoints', label: 'Điểm ước lượng' },
            ]}
            onChange={(v) => set({ field: v as ActionDraft['field'], value: '' })}
          />
          <Err id={fid('value')} error={err('value')}>
            {(p) =>
              a.field === 'priorityId' || a.field === 'assigneeId' || a.field === 'sprintId' ? (
                <SearchSelect
                  {...p}
                  {...(a.field === 'assigneeId' ? opts.userPick : {})}
                  value={a.value}
                  onChange={(value) => set({ value })}
                  options={[
                    { value: '', label: 'Để trống (gỡ giá trị)' },
                    ...(a.field === 'priorityId'
                      ? opts.priorities
                      : a.field === 'assigneeId'
                        ? opts.users
                        : opts.sprints),
                  ]}
                  placeholder="Chọn giá trị…"
                  searchPlaceholder="Tìm…"
                  ariaLabel="Giá trị mới"
                />
              ) : (
                <Input
                  {...p}
                  aria-label="Giá trị mới"
                  type={a.field === 'dueDate' ? 'date' : 'number'}
                  min={0}
                  value={a.value}
                  onChange={(e) => set({ value: e.target.value })}
                  placeholder="Để trống = gỡ giá trị"
                />
              )
            }
          </Err>
        </div>
      )}

      {a.type === 'assign' && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[14rem_1fr]">
          <SearchSelect
            ariaLabel="Cách giao"
            value={a.mode}
            options={ASSIGN_MODE_OPTIONS}
            onChange={(v) => set({ mode: v as ActionDraft['mode'] })}
          />
          {a.mode === 'user' && (
            <Err id={fid('userId')} error={err('userId')}>
              {(p) => (
                <SearchSelect
                  {...p}
                  {...opts.userPick}
                  value={a.userId}
                  onChange={(userId) => set({ userId })}
                  options={opts.users}
                  placeholder="Chọn người…"
                  searchPlaceholder="Tìm người…"
                  ariaLabel="Người được giao"
                />
              )}
            </Err>
          )}
        </div>
      )}

      {a.type === 'transition' && (
        <Err id={fid('toStatusId')} error={err('toStatusId')}>
          {(p) => (
            <SearchSelect
              {...p}
              value={a.toStatusId}
              onChange={(toStatusId) => set({ toStatusId })}
              options={opts.statuses}
              placeholder="Chuyển sang trạng thái…"
              searchPlaceholder="Tìm trạng thái…"
              ariaLabel="Trạng thái đích"
            />
          )}
        </Err>
      )}

      {(a.type === 'addLabel' || a.type === 'removeLabel') && (
        <Err id={fid('labelId')} error={err('labelId')}>
          {(p) => (
            <SearchSelect
              {...p}
              value={a.labelId}
              onChange={(labelId) => set({ labelId })}
              options={opts.labels}
              placeholder="Chọn nhãn…"
              searchPlaceholder="Tìm nhãn…"
              ariaLabel="Nhãn"
            />
          )}
        </Err>
      )}

      {a.type === 'addComment' && (
        <div>
          <textarea
            id={fid('body')}
            aria-label="Nội dung bình luận"
            aria-invalid={err('body') ? true : undefined}
            aria-describedby={err('body') ? fieldErrorId(fid('body')) : undefined}
            className={`w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-ink placeholder:text-faint focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] ${err('body') ? INVALID_FIELD_CLS : ''}`}
            rows={3}
            maxLength={5000}
            value={a.body}
            onChange={(e) => set({ body: e.target.value })}
            placeholder="Ví dụ: {{actor.displayName}} vừa cập nhật {{issue.key}}"
          />
          {err('body') && (
            <FieldErrorText id={fieldErrorId(fid('body'))}>{err('body')}</FieldErrorText>
          )}
          <p className="mt-1 text-xs text-faint">
            Chèn được {'{{issue.key}}'}, {'{{issue.summary}}'}, {'{{actor.displayName}}'}.
          </p>
        </div>
      )}

      {a.type === 'notify' && (
        <div className="space-y-2">
          <Err id={fid('message')} error={err('message')}>
            {(p) => (
              <Input
                {...p}
                aria-label="Nội dung thông báo"
                value={a.message}
                onChange={(e) => set({ message: e.target.value })}
                placeholder="Nội dung thông báo (hỗ trợ {{issue.key}})"
                maxLength={500}
              />
            )}
          </Err>
          <p className="text-xs font-medium text-muted">Người nhận</p>
          <Err id={fid('userIds')} error={err('userIds')}>
            {(p) => (
              <MultiPick
                {...p}
                pick={opts.userPick}
                options={opts.users}
                value={a.userIds}
                onChange={(userIds) => set({ userIds })}
                empty="Chưa tải được danh sách thành viên."
                ariaLabel="Người nhận"
              />
            )}
          </Err>
          <p className="text-xs font-medium text-muted">Hoặc mọi người có vai trò</p>
          <MultiPick
            options={Object.values(SYSTEM_ROLES).map((r) => ({ value: r, label: r }))}
            value={a.roles}
            onChange={(roles) => set({ roles })}
            empty=""
            ariaLabel="Vai trò nhận"
          />
        </div>
      )}

      {a.type === 'webhook' && (
        <div className="space-y-2">
          <Err id={fid('url')} error={err('url')}>
            {(p) => (
              <Input
                {...p}
                aria-label="Địa chỉ webhook"
                value={a.url}
                onChange={(e) => set({ url: e.target.value })}
                placeholder="https://example.com/hooks/tirapro"
              />
            )}
          </Err>
          <Err id={fid('secret')} error={err('secret')}>
            {(p) => (
              <Input
                {...p}
                aria-label="Khoá bí mật (không bắt buộc)"
                type="password"
                autoComplete="off"
                value={a.secret}
                onChange={(e) => set({ secret: e.target.value })}
                placeholder="Khoá bí mật để ký (không bắt buộc)"
              />
            )}
          </Err>
          <p className="text-xs text-faint">
            Hệ thống gửi POST JSON, chờ tối đa 5 giây, không thử lại. Có khoá thì kèm chữ ký
            HMAC-SHA256 ở header X-Tirapro-Signature. Địa chỉ nội bộ bị chặn.
          </p>
        </div>
      )}

      {a.type === 'createSubtask' && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_12rem]">
          <Err id={fid('summary')} error={err('summary')}>
            {(p) => (
              <Input
                {...p}
                aria-label="Tiêu đề việc con"
                value={a.summary}
                onChange={(e) => set({ summary: e.target.value })}
                placeholder="Tiêu đề việc con (hỗ trợ {{issue.key}})"
                maxLength={255}
              />
            )}
          </Err>
          <Err id={fid('typeId')} error={err('typeId')}>
            {(p) => (
              <SearchSelect
                {...p}
                value={a.typeId}
                onChange={(typeId) => set({ typeId })}
                options={opts.subtaskTypes}
                placeholder="Loại việc con…"
                searchPlaceholder="Tìm loại…"
                ariaLabel="Loại việc con"
              />
            )}
          </Err>
        </div>
      )}
    </div>
  );
}

/* ------------------------------ editor ------------------------------ */

/**
 * Tạo / sửa quy tắc theo ba bước: Khi… (sự kiện) → Nếu… (điều kiện, tuỳ chọn) → Thì… (hành động).
 * `rule = null` là tạo mới. Dựng trên `Dialog` dùng chung (size xl).
 */
export function RuleEditor({
  open,
  rule,
  defaultProjectId,
  onClose,
}: {
  open: boolean;
  rule: AutomationRule | null;
  defaultProjectId: string;
  onClose: () => void;
}) {
  const create = useCreateRule();
  const update = useUpdateRule();
  const { data: projects } = useProjects();
  const [draft, setDraft] = useState<Draft>(() => fromRule(rule, defaultProjectId));

  // Lỗi hiện sau lần Lưu lỗi đầu tiên (sửa tới đâu hết lỗi tới đó); mở lại hộp thì xoá.
  const result = useMemo(() => checkDraft(draft), [draft]);
  const flow = useErrorFlow(result.ok ? [] : result.errors);
  const { reset: resetErrors } = flow;

  useEffect(() => {
    if (!open) return;
    setDraft(fromRule(rule, defaultProjectId));
    resetErrors();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, rule, defaultProjectId]);

  const opts = useOptions(draft.projectId);
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const busy = create.isPending || update.isPending;
  const scoped = draft.projectId !== '';

  // Tên hiển thị của mã trong câu điều kiện: tra theo danh sách chọn đã nạp (người: tra theo id phía máy chủ).
  const nameOf = (field: string, id: string) =>
    optionsForField(field as FieldName, opts).find((o) => o.value === id)?.label ??
    (field === 'assigneeId' || field === 'reporterId'
      ? opts.userPick.resolveOption(id)?.label
      : undefined);

  function submit() {
    if (busy) return; // ⌘/Ctrl+Enter không đi qua trạng thái loading của nút
    if (!result.ok) return flow.fail();
    const done = () => {
      toast.success(rule ? 'Đã lưu quy tắc' : 'Đã tạo quy tắc');
      onClose();
    };
    if (rule) {
      const { projectId: _projectId, ...rest } = result.data satisfies CreateRuleInput;
      update.mutate({ id: rule.id, ...rest }, { onSuccess: done });
    } else {
      create.mutate(result.data, { onSuccess: done });
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o && !busy) onClose();
      }}
      title={rule ? 'Sửa quy tắc' : 'Quy tắc mới'}
      size="xl"
      onSubmit={submit}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Huỷ
          </Button>
          <Button onClick={submit} loading={busy}>
            {rule ? 'Lưu thay đổi' : 'Tạo quy tắc'}
          </Button>
        </>
      }
    >
      <div className="space-y-6">
        <ErrorSummary errors={flow.errors} attempt={flow.attempts} />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField id={RULE_NAME_ID} label="Tên quy tắc" error={flow.errorOf(RULE_NAME_ID)}>
            {(p) => (
              <Input
                {...p}
                value={draft.name}
                onChange={(e) => set({ name: e.target.value })}
                placeholder="Ví dụ: Việc khẩn giao cho lead"
                maxLength={120}
                autoFocus
              />
            )}
          </FormField>
          <FormField
            id="rule-scope"
            label="Phạm vi"
            hint={
              rule
                ? 'Không đổi được phạm vi sau khi tạo.'
                : 'Chọn dự án để dùng nhãn/sprint của dự án đó.'
            }
          >
            <SearchSelect
              id="rule-scope"
              value={draft.projectId}
              onChange={(projectId) => set({ projectId })}
              disabled={!!rule}
              options={[
                { value: '', label: 'Toàn bộ không gian làm việc' },
                ...(projects ?? []).map((p) => ({ value: p.id, label: p.name, hint: p.key })),
              ]}
              searchPlaceholder="Tìm dự án…"
              ariaLabel="Phạm vi quy tắc"
            />
          </FormField>
        </div>

        <section aria-label="Khi">
          <StepHeader n={1} title="Khi…" hint="Sự kiện làm quy tắc chạy." />
          <div className="space-y-3">
            <Err id={RULE_TRIGGER_ID} error={flow.errorOf(RULE_TRIGGER_ID)}>
              {(p) => (
                <SearchSelect
                  {...p}
                  ariaLabel="Sự kiện kích hoạt"
                  value={draft.trigger}
                  options={RULE_TRIGGERS.map((t) => ({ value: t, label: TRIGGER_LABELS[t] }))}
                  onChange={(v) => set({ trigger: v as RuleTrigger })}
                />
              )}
            </Err>
            {draft.trigger === 'ISSUE_TRANSITIONED' && (
              <Field
                label="Chỉ khi chuyển đến trạng thái"
                hint="Bỏ trống để chạy ở mọi lần đổi trạng thái."
              >
                <SearchSelect
                  value={draft.toStatusId}
                  onChange={(toStatusId) => set({ toStatusId })}
                  options={[{ value: '', label: 'Bất kỳ trạng thái nào' }, ...opts.statuses]}
                  searchPlaceholder="Tìm trạng thái…"
                  ariaLabel="Trạng thái đích"
                />
              </Field>
            )}
            {draft.trigger === 'ISSUE_UPDATED' && (
              <Field
                label="Chỉ khi các trường này vừa đổi"
                hint="Không chọn gì = chạy ở mọi lần sửa."
              >
                <MultiPick
                  options={UPDATE_FIELD_CHOICES.map(([value, label]) => ({ value, label }))}
                  value={draft.fields}
                  onChange={(fields) => set({ fields })}
                  empty=""
                  ariaLabel="Các trường theo dõi"
                />
              </Field>
            )}
            {draft.trigger === 'SCHEDULED' && (
              <Field
                label="Lịch chạy (cron, giờ UTC)"
                htmlFor="rule-cron"
                hint="5 trường: phút giờ ngày tháng thứ. Cần thêm một điều kiện JQL ở bước 2 để chọn công việc (tối đa 500 việc mỗi lần)."
              >
                <Input
                  id="rule-cron"
                  className="font-mono"
                  value={draft.cron}
                  onChange={(e) => set({ cron: e.target.value })}
                  placeholder="0 9 * * 1-5"
                />
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {CRON_PRESETS.map(([cron, label]) => (
                    <button
                      key={cron}
                      type="button"
                      onClick={() => set({ cron })}
                      className="rounded-full border border-border px-2 py-0.5 text-xs text-muted hover:bg-surface-2 hover:text-ink"
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </Field>
            )}
          </div>
        </section>

        <section aria-label="Nếu">
          <StepHeader
            n={2}
            title="Nếu… (không bắt buộc)"
            hint="Mọi điều kiện đều phải đúng thì hành động mới chạy."
          />
          <div className="space-y-2">
            <ConditionSentence conditions={draft.conditions.map(toCondition)} nameOf={nameOf} />
            {draft.conditions.map((c, i) => (
              <Card
                key={c.id}
                label={`điều kiện ${i + 1}`}
                onRemove={() => set({ conditions: draft.conditions.filter((x) => x.id !== c.id) })}
              >
                <ConditionCard
                  c={c}
                  opts={opts}
                  errorOf={flow.errorOf}
                  onChange={(next) =>
                    set({ conditions: draft.conditions.map((x) => (x.id === c.id ? next : x)) })
                  }
                />
              </Card>
            ))}
            <div id={RULE_CONDITIONS_ID} className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => set({ conditions: [...draft.conditions, newCondition()] })}
              >
                <Plus className="h-4 w-4" /> Thêm điều kiện
              </Button>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() =>
                  set({
                    conditions: [
                      ...draft.conditions,
                      { id: uid(), kind: 'jql', jql: '', raw: false },
                    ],
                  })
                }
              >
                <Plus className="h-4 w-4" /> Thêm điều kiện JQL
              </Button>
            </div>
            {flow.errorOf(RULE_CONDITIONS_ID) && (
              <FieldErrorText id={fieldErrorId(RULE_CONDITIONS_ID)}>
                {flow.errorOf(RULE_CONDITIONS_ID)}
              </FieldErrorText>
            )}
          </div>
        </section>

        <section aria-label="Thì">
          <StepHeader
            n={3}
            title="Thì…"
            hint="Các hành động chạy lần lượt từ trên xuống; gặp lỗi thì dừng."
          />
          <div className="space-y-2">
            {draft.actions.map((a, i) => (
              <Card
                key={a.id}
                label={`hành động ${i + 1}`}
                onRemove={
                  draft.actions.length > 1
                    ? () => set({ actions: draft.actions.filter((x) => x.id !== a.id) })
                    : undefined
                }
              >
                <ActionCard
                  a={a}
                  opts={opts}
                  scoped={scoped}
                  errorOf={flow.errorOf}
                  onChange={(next) =>
                    set({ actions: draft.actions.map((x) => (x.id === a.id ? next : x)) })
                  }
                />
              </Card>
            ))}
            <div id={RULE_ACTIONS_ID}>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => set({ actions: [...draft.actions, newAction('addComment')] })}
              >
                <Plus className="h-4 w-4" /> Thêm hành động
              </Button>
            </div>
            {flow.errorOf(RULE_ACTIONS_ID) && (
              <FieldErrorText id={fieldErrorId(RULE_ACTIONS_ID)}>
                {flow.errorOf(RULE_ACTIONS_ID)}
              </FieldErrorText>
            )}
          </div>
        </section>
      </div>
    </Dialog>
  );
}
