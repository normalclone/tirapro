import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Input } from '@/components/ui/Input';
import { SearchSelect, type SearchSelectOption } from '@/components/ui/SearchSelect';
import { validateJql, type JqlValidation } from '@/features/saved-filters/api';
import { useProjects } from '@/features/projects/api';
import { apiErrorMessage } from '@/lib/api';
import { draftIssues, type DraftWidget } from './layoutOps';
import { widgetDefOf } from './registry';
import { STAT_METRIC_META, type StatMetric } from './statMetrics';
import { cfgNumber, cfgString } from './widgetConfig';

const PIE_FIELD_LABEL = { status: 'Trạng thái', type: 'Loại công việc', priority: 'Mức ưu tiên' };

/** Một hàng nhãn + điều khiển, dùng chung trong hộp cấu hình. */
function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1 block text-sm font-medium text-ink">
        {label}
      </label>
      {children}
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}

type JqlCheck =
  | { state: 'idle' }
  | { state: 'busy' }
  | { state: 'done'; result: JqlValidation }
  | { state: 'error'; message: string };

/** Ô JQL + nút "Kiểm tra" (POST /search/validate) + số dòng hiển thị cho ô ISSUE_LIST. */
function JqlFields({
  config,
  set,
}: {
  config: Record<string, unknown>;
  set: (patch: Record<string, unknown>) => void;
}) {
  const jql = typeof config.jql === 'string' ? config.jql : '';
  const [check, setCheck] = useState<JqlCheck>({ state: 'idle' });

  async function runCheck() {
    setCheck({ state: 'busy' });
    try {
      setCheck({ state: 'done', result: await validateJql(jql.trim()) });
    } catch (err) {
      setCheck({ state: 'error', message: apiErrorMessage(err) });
    }
  }

  return (
    <>
      <Field
        label="Câu lọc JQL"
        htmlFor="widget-jql"
        hint="Chỉ hiện công việc người xem có quyền thấy."
      >
        <div className="flex gap-2">
          <Input
            id="widget-jql"
            value={jql}
            maxLength={500}
            placeholder="type = Bug AND statusCategory != DONE"
            className="font-mono text-sm"
            onChange={(e) => {
              set({ jql: e.target.value });
              setCheck({ state: 'idle' });
            }}
          />
          <Button
            variant="secondary"
            onClick={() => void runCheck()}
            loading={check.state === 'busy'}
            disabled={jql.trim() === ''}
          >
            Kiểm tra
          </Button>
        </div>
        <div aria-live="polite" className="mt-1 text-xs">
          {check.state === 'done' &&
            (check.result.valid ? (
              <span className="text-status-done">Câu lọc hợp lệ</span>
            ) : (
              <span className="text-danger">{check.result.error ?? 'Câu lọc chưa hợp lệ'}</span>
            ))}
          {check.state === 'error' && <span className="text-danger">{check.message}</span>}
        </div>
      </Field>
      <Field label="Số dòng hiển thị">
        <SearchSelect
          value={String(cfgNumber(config, 'limit', 10))}
          onChange={(v) => set({ limit: Number(v) })}
          options={['5', '10', '15', '20'].map((v) => ({ value: v, label: `${v} dòng` }))}
          ariaLabel="Số dòng hiển thị"
        />
      </Field>
    </>
  );
}

/**
 * Cấu hình một ô: tiêu đề + trường theo loại (chọn dự án bằng SearchSelect, JQL có nút "Kiểm tra", số dòng…).
 * Nút Lưu chỉ bật khi ô qua được schema của máy chủ (`draftIssues`), lý do chưa hợp lệ hiện ngay dưới form.
 */
export function WidgetConfigDialog({
  widget,
  onClose,
  onSave,
}: {
  widget: DraftWidget | null;
  onClose: () => void;
  onSave: (id: string, patch: { title: string; config: Record<string, unknown> }) => void;
}) {
  // Giữ ô đã đóng để nội dung không biến mất giữa hiệu ứng đóng.
  const [shown, setShown] = useState<DraftWidget | null>(widget);
  useEffect(() => {
    if (widget) setShown(widget);
  }, [widget]);
  if (!shown) return null;
  return (
    <ConfigForm
      key={shown.id}
      widget={shown}
      open={widget !== null}
      onClose={onClose}
      onSave={onSave}
    />
  );
}

function ConfigForm({
  widget,
  open,
  onClose,
  onSave,
}: {
  widget: DraftWidget;
  open: boolean;
  onClose: () => void;
  onSave: (id: string, patch: { title: string; config: Record<string, unknown> }) => void;
}) {
  const def = widgetDefOf(widget.type);
  const { data: projects } = useProjects();
  const [title, setTitle] = useState(widget.title);
  const [config, setConfig] = useState<Record<string, unknown>>(widget.config);
  const set = (patch: Record<string, unknown>) => setConfig((c) => ({ ...c, ...patch }));
  const projectId = cfgString(config, 'projectId') ?? '';

  const projectOptions = useMemo<SearchSelectOption[]>(() => {
    const opts = (projects ?? [])
      .filter((p) => !p.isArchived)
      .map((p) => ({ value: p.id, label: p.name, hint: p.key }));
    return def?.project === 'optional'
      ? [{ value: '', label: 'Toàn bộ không gian làm việc' }, ...opts]
      : opts;
  }, [projects, def?.project]);

  // Ô đã lưu có thể trỏ dự án không còn trong danh sách (đã lưu trữ…): vẫn hiện để người dùng thấy và đổi.
  const hasUnknownProject = projectId !== '' && !projectOptions.some((o) => o.value === projectId);

  const issue = draftIssues([{ ...widget, title, config: cleaned(config) }])[widget.id];

  function cleaned(c: Record<string, unknown>): Record<string, unknown> {
    const out = { ...c };
    if (def?.project === 'optional' && !out.projectId) delete out.projectId;
    return out;
  }

  function submit() {
    if (issue) return;
    onSave(widget.id, { title: title.trim(), config: cleaned(config) });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={`Cấu hình: ${def?.label ?? 'ô'}`}
      size="md"
      onSubmit={submit}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Huỷ
          </Button>
          <Button onClick={submit} disabled={!!issue}>
            Áp dụng
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Tiêu đề ô" htmlFor="widget-title">
          <Input
            id="widget-title"
            value={title}
            maxLength={80}
            onChange={(e) => setTitle(e.target.value)}
          />
        </Field>

        {widget.type === 'STAT_NUMBER' && (
          <Field
            label="Chỉ số"
            hint={STAT_METRIC_META[(config.metric as StatMetric) ?? 'open']?.hint}
          >
            <SearchSelect
              value={typeof config.metric === 'string' ? config.metric : 'open'}
              onChange={(v) => set({ metric: v })}
              options={(Object.keys(STAT_METRIC_META) as StatMetric[]).map((m) => ({
                value: m,
                label: STAT_METRIC_META[m].label,
              }))}
              ariaLabel="Chỉ số"
            />
          </Field>
        )}

        {widget.type === 'PIE_BY_FIELD' && (
          <Field label="Phân bố theo">
            <SearchSelect
              value={typeof config.field === 'string' ? config.field : 'status'}
              onChange={(v) => set({ field: v })}
              options={Object.entries(PIE_FIELD_LABEL).map(([value, label]) => ({ value, label }))}
              ariaLabel="Phân bố theo"
            />
          </Field>
        )}

        {def && def.project !== 'none' && (
          <Field
            label={def.project === 'required' ? 'Dự án' : 'Phạm vi'}
            hint={
              def.project === 'optional'
                ? 'Không chọn dự án: số liệu toàn không gian (cần quyền xem báo cáo).'
                : undefined
            }
          >
            <SearchSelect
              value={projectId}
              onChange={(v) => set({ projectId: v })}
              options={
                hasUnknownProject
                  ? [...projectOptions, { value: projectId, label: 'Dự án đã chọn trước đó' }]
                  : projectOptions
              }
              placeholder="Chọn dự án…"
              searchPlaceholder="Tìm dự án…"
              ariaLabel="Dự án"
            />
          </Field>
        )}

        {widget.type === 'ISSUE_LIST' && <JqlFields config={config} set={set} />}

        {issue && (
          <p role="alert" className="text-sm text-danger">
            {issue}
          </p>
        )}
      </div>
    </Dialog>
  );
}
