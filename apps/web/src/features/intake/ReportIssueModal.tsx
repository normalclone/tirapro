import { useMemo, useState, type FormEvent } from 'react';
import { Bug, Monitor } from 'lucide-react';
import type { EnvironmentInput } from '@tirapro/shared';
import type { ProjectDto } from '@tirapro/types';
import { useErrorFlow } from '@/lib/useErrorFlow';
import { describedBy, fieldErrorId, type FieldError } from '@/lib/formErrors';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { ErrorSummary } from '@/components/ui/ErrorSummary';
import { FieldErrorText } from '@/components/ui/FieldError';
import { Input } from '@/components/ui/Input';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { SearchSelect } from '@/components/ui/SearchSelect';
import { useOpenSession } from '@/lib/useOpenSession';
import { useCreateTarget } from '@/lib/useCreateTarget';
import type { ProjectMeta } from '@/features/ai/api';
import { useProjects } from '@/features/projects/api';
import { MarkdownEditor } from '@/features/issue-edit/MarkdownEditor';
import { useReportIssueModal, type ReportIssuePreset } from '@/stores/reportIssue';
import { useDuplicateCheck, type DuplicateSuggestion } from './api';
import { DuplicatePanel } from './DuplicatePanel';
import { useDupChoice } from './useDupChoice';
import { dupDescribedBy, type DupSelection } from './dupDecision';
import { FIELD_LABEL, ReportDetails } from './ReportDetails';
import { FileDrop } from '@/features/attachments/FileDrop';
import {
  clearDraft,
  loadReportMode,
  saveReportMode,
  useDraftAutosave,
  useReportInitial,
} from './useReportDraft';
import { useCanComment } from './useCanComment';
import { useReportDetails, useReportMeta } from './useReportDetails';
import { useReportSubmit } from './useReportSubmit';
import { useQueuedSubmit } from './useQueuedSubmit';
import { defaultSeverityId } from '@/features/issue-edit/severity';
import {
  descriptionForMode,
  descriptionOnKindChange,
  environmentSummary,
  isReportTemplate,
  REPORT_KINDS,
  reportDialogTitle,
  reportKindLabel,
  severityForSubmit,
  validateReport,
  type ReportField,
  type ReportFormState,
  type ReportMode,
  type RequestKind,
} from './reportForm';

/**
 * Form "Báo lỗi / Gửi yêu cầu" DUY NHẤT — gắn một lần ở khung ứng dụng, mở bằng `openReportIssue()` /
 * `useReportIssueModal.openReport()`. `key` theo lần mở → mỗi lần mở là mount mới (form khởi tạo lại), còn lúc
 * đóng thì nội dung ở lại suốt hiệu ứng đóng.
 */
export function ReportIssueModal() {
  const open = useReportIssueModal((s) => s.open);
  const preset = useReportIssueModal((s) => s.preset);
  const close = useReportIssueModal((s) => s.close);
  const session = useOpenSession(open);
  return <ReportIssueForm key={session} open={open} preset={preset} onClose={close} />;
}

const KIND_OPTIONS = REPORT_KINDS.map((k) => ({ value: k, label: reportKindLabel(k) }));

/** Ba nút phân đoạn chọn loại yêu cầu. */
function KindPicker({ kind, onChange }: { kind: RequestKind; onChange: (k: RequestKind) => void }) {
  return (
    <SegmentedControl
      ariaLabel="Loại yêu cầu"
      size="sm"
      fullWidth
      value={kind}
      onChange={onChange}
      options={KIND_OPTIONS}
    />
  );
}

/** Dự án đích: một dòng "Gửi vào X · Đổi"; chưa có dự án (hoặc bấm Đổi) thì ô chọn — không tự đoán dự án lạ. */
function ProjectField({
  projects,
  selected,
  picking,
  onPick,
  onChange,
  error,
}: {
  projects: ProjectDto[];
  selected: ProjectDto | undefined;
  picking: boolean;
  onPick: () => void;
  onChange: (key: string) => void;
  error?: string;
}) {
  if (selected && !picking)
    return (
      <p className="flex items-center gap-1.5 text-xs text-muted">
        Gửi vào <span className="font-medium text-ink">{selected.name}</span>
        <button
          type="button"
          onClick={onPick}
          className="rounded px-1 text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
        >
          Đổi
        </button>
      </p>
    );
  return (
    <div>
      <label htmlFor="ri-project" className={FIELD_LABEL}>
        Dự án
      </label>
      <SearchSelect
        id="ri-project"
        invalid={!!error}
        aria-describedby={error ? fieldErrorId('ri-project') : undefined}
        value={selected?.key ?? ''}
        onChange={onChange}
        placeholder="Chọn dự án nhận báo cáo…"
        searchPlaceholder="Tìm dự án…"
        options={projects.map((p) => ({ value: p.key, label: p.name, hint: p.key }))}
      />
      {error ? (
        <FieldErrorText id={fieldErrorId('ri-project')}>{error}</FieldErrorText>
      ) : (
        !selected && (
          <p className="mt-1 text-xs text-muted" role="status">
            Chọn dự án để gửi — hộp này không tự đoán dự án.
          </p>
        )
      )}
    </div>
  );
}

/** Trường của form → id phần tử trong hộp + nhãn hiện ở phần tóm tắt lỗi (theo thứ tự trong form). */
const FIELD_META: Record<ReportField, { id: string; label: string }> = {
  project: { id: 'ri-project', label: 'Dự án' },
  summary: { id: 'ri-summary', label: 'Tiêu đề' },
};

/**
 * Lỗi của form theo trường dưới dạng `FieldError` (theo thứ tự form). Lỗi hiện sau lần Gửi lỗi đầu tiên rồi tính lại theo
 * form (sửa tới đâu hết lỗi tới đó) — xem `useErrorFlow`; Gửi từ nút, Enter trong form, ⌘/Ctrl+Enter hay ô mô tả đều đi
 * qua `attempt`.
 */
function reportFieldErrors(f: Pick<ReportFormState, 'projectId' | 'summary'>): FieldError[] {
  return validateReport(f).map((i) => ({ ...FIELD_META[i.field], message: i.message }));
}

const MODE_OPTIONS: { value: ReportMode; label: string; title: string }[] = [
  { value: 'basic', label: 'Cơ bản', title: 'Chỉ cần tiêu đề — gửi nhanh nhất' },
  {
    value: 'advanced',
    label: 'Nâng cao',
    title: 'Mẫu bước tái hiện, mức nghiêm trọng, môi trường, tệp',
  },
];

/** Công tắc phân đoạn "Cơ bản | Nâng cao" ở đầu form — nhớ theo người. */
function ModeSwitch({ mode, onChange }: { mode: ReportMode; onChange: (m: ReportMode) => void }) {
  return (
    <SegmentedControl
      ariaLabel="Chế độ form"
      size="sm"
      fullWidth={false}
      value={mode}
      onChange={onChange}
      options={MODE_OPTIONS}
    />
  );
}

/** Chế độ Cơ bản, Bug: môi trường đã tự ghi ngầm — hiện một dòng nhỏ + "Sửa" mở Nâng cao. */
function AutoEnvLine({ summary, onEdit }: { summary: string; onEdit: () => void }) {
  return (
    <p className="flex items-center gap-1.5 text-xs text-muted" data-testid="ri-auto-env">
      <Monitor className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span className="min-w-0 truncate">
        Đã tự ghi: <span className="text-ink">{summary}</span>
      </span>
      <button
        type="button"
        onClick={onEdit}
        className="inline-flex shrink-0 items-center justify-center rounded px-1 text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] max-sm:min-h-11 max-sm:min-w-11 max-sm:px-3"
      >
        Sửa
      </button>
    </p>
  );
}

/** Hàng nút đáy: gợi ý phím tắt, Huỷ, Gửi. */
function ReportFooter({
  busy,
  label,
  onClose,
}: {
  busy: boolean;
  label: string;
  onClose: () => void;
}) {
  return (
    <>
      <span className="kbd-hint mr-auto text-xs text-faint max-sm:hidden">
        ⌘/Ctrl + Enter để gửi nhanh
      </span>
      <Button type="button" variant="ghost" onClick={onClose}>
        Huỷ
      </Button>
      <Button type="submit" form="report-issue-form" loading={busy}>
        {label}
      </Button>
    </>
  );
}

/** Ô tiêu đề + panel gợi ý trùng ngay dưới. ↓ trong ô tiêu đề vào danh sách gợi ý. */
function TitleField({
  kind,
  summary,
  onChange,
  matches,
  checking,
  dup,
  canMerge,
  onSelect,
  error,
}: {
  error?: string;
  kind: RequestKind;
  summary: string;
  onChange: (v: string) => void;
  matches: DuplicateSuggestion[];
  checking: boolean;
  dup: ReturnType<typeof useDupChoice>;
  canMerge: boolean;
  onSelect: (s: DupSelection) => void;
}) {
  const long = summary.trim().length >= 4;
  const showPanel = dup.sel.mode === 'merge' || (long && matches.length > 0 && !dup.dismissed);
  return (
    <div>
      <label htmlFor="ri-summary" className={FIELD_LABEL}>
        Tiêu đề
      </label>
      <Input
        id="ri-summary"
        autoFocus
        value={summary}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== 'ArrowDown') return;
          const first = document.querySelector<HTMLElement>('#ri-dup [data-dup-merge="0"]');
          if (!first) return;
          e.preventDefault();
          first.focus();
        }}
        placeholder={TITLE_PLACEHOLDER[kind]}
        className="text-sm"
        invalid={!!error}
        aria-describedby={describedBy(
          dupDescribedBy(showPanel, dup.sel.mode),
          error && fieldErrorId('ri-summary'),
        )}
      />
      {error && <FieldErrorText id={fieldErrorId('ri-summary')}>{error}</FieldErrorText>}
      {/* Vùng aria-live luôn có trong DOM để trình đọc màn hình đọc được khi panel xuất hiện. */}
      <div aria-live="polite">
        {showPanel && (
          <DuplicatePanel
            canMerge={canMerge}
            matches={matches}
            selection={dup.sel}
            exact={matches.find((m) => m.id === dup.decision.exact?.id)}
            onSelect={onSelect}
          />
        )}
      </div>
      {checking && !showPanel && long && (
        <p className="mt-1.5 text-xs text-faint">Đang kiểm tra trùng lặp…</p>
      )}
    </div>
  );
}

/** Ô mô tả (Markdown, dán ảnh Ctrl+V). Cơ bản: ô nhỏ 3 dòng, không mẫu; Nâng cao: 6 dòng + mẫu theo loại. */
function DescriptionField({
  merging,
  description,
  onChange,
  onSubmit,
  rows,
  onPasteImages,
}: {
  merging: boolean;
  description: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  rows: number;
  onPasteImages: (files: File[]) => void;
}) {
  return (
    <div>
      <label htmlFor="ri-desc" className={FIELD_LABEL}>
        {merging ? (
          'Ghi chú thêm — sẽ thành bình luận'
        ) : (
          <>
            Mô tả <span className="font-normal text-faint">(tùy chọn)</span>
          </>
        )}
      </label>
      <MarkdownEditor
        textareaId="ri-desc"
        value={description}
        onChange={onChange}
        onSubmit={onSubmit}
        rows={rows}
        onPasteImages={onPasteImages}
        placeholder="Viết được Markdown; chèn ảnh bằng ![](đường-dẫn) hoặc dán ảnh chụp màn hình (Ctrl+V)"
      />
    </div>
  );
}

/**
 * Phần dưới ô mô tả theo chế độ. Nâng cao: đủ mức nghiêm trọng, môi trường sửa được, tệp. Cơ bản: một dòng "Đã tự ghi"
 * (Bug) + "Sửa"; không có ô tệp, nhưng ảnh dán (Ctrl+V) / tệp mang sang từ form khác vẫn hiện và gỡ được.
 */
function ModeSection({
  mode,
  isBug,
  meta,
  details,
  envText,
  onEditEnv,
}: {
  mode: ReportMode;
  isBug: boolean;
  meta: ProjectMeta | undefined;
  details: ReturnType<typeof useReportDetails>;
  envText: string;
  onEditEnv: () => void;
}) {
  if (mode === 'advanced') return <ReportDetails isBug={isBug} meta={meta} {...details.props} />;
  return (
    <>
      {isBug && envText && <AutoEnvLine summary={envText} onEdit={onEditEnv} />}
      {details.files.length > 0 && (
        <div>
          <label className={FIELD_LABEL}>Tệp đính kèm</label>
          <FileDrop
            files={details.files}
            onAdd={(fs) => details.props.onFiles((prev) => [...prev, ...fs])}
            onRemove={(i) => details.props.onFiles((prev) => prev.filter((_, j) => j !== i))}
          />
        </div>
      )}
    </>
  );
}

const TITLE_PLACEHOLDER: Record<RequestKind, string> = {
  BUG: 'Mô tả ngắn gọn lỗi/sự cố gặp phải…',
  FEATURE: 'Bạn muốn có tính năng gì?',
  QUESTION: 'Bạn muốn hỏi điều gì?',
};

/** Esc đang ở trong panel gợi ý trùng thì chỉ đóng panel, không đóng cả hộp. */
function escapeInDupPanel(e: KeyboardEvent, dismiss: () => void) {
  if (!document.activeElement?.closest('#ri-dup')) return;
  e.preventDefault();
  dismiss();
  document.getElementById('ri-summary')?.focus();
}

/** Mức nghiêm trọng gửi đi: ô đang chọn, hoặc mặc định của dự án nếu Bug chưa kịp được chọn sẵn (meta vừa về). */
function submitSeverity(
  isBug: boolean,
  details: ReturnType<typeof useReportDetails>,
  meta: ProjectMeta | undefined,
): string {
  return severityForSubmit({
    isBug,
    selected: details.props.severityId,
    touched: details.props.severityTouched.current,
    defaultId: meta ? defaultSeverityId(meta.severities) : null,
  });
}

function ReportIssueForm({
  open,
  preset,
  onClose,
}: {
  open: boolean;
  preset: ReportIssuePreset;
  onClose: () => void;
}) {
  const { data: projects } = useProjects();
  const { target } = useCreateTarget();

  const [mode, setMode] = useState<ReportMode>(loadReportMode);
  const initial = useReportInitial(open, preset, target.projectKey, mode);
  const [selKey, setSelKey] = useState(initial.key);
  const [changingProject, setChangingProject] = useState(false);
  const [kind, setKind] = useState<RequestKind>(initial.kind);
  const [summary, setSummary] = useState(initial.summary);
  const [description, setDescription] = useState(initial.description);

  const selProject = useMemo(
    () => (projects ?? []).find((p) => p.key.toLowerCase() === selKey.toLowerCase()),
    [projects, selKey],
  );
  const projectId = selProject?.id ?? '';
  const isBug = kind === 'BUG';
  const { meta, waiting: metaWaiting } = useReportMeta(open, selProject?.key, isBug);
  const details = useReportDetails({
    initialFiles: preset.files,
    isBug,
    meta,
    onNeedAdvanced: () => changeMode('advanced'),
  });
  const { data: duplicates, isFetching: checkingDup } = useDuplicateCheck(
    open ? projectId : undefined,
    summary,
  );
  const matches = duplicates ?? [];
  const canComment = useCanComment(projectId);
  const dup = useDupChoice(matches, summary, { canComment, kind });

  const form = {
    projectId,
    kind,
    summary,
    description,
    severityId: submitSeverity(isBug, details, meta),
    environment: details.envDraft as EnvironmentInput,
    mergeIntoIssueId: dup.decision.mergeInto?.id ?? null,
    forceNew: dup.decision.forceNew,
  };
  const { busy, submit } = useReportSubmit({
    form,
    files: details.files,
    onEnvInvalid: details.showEnvError,
    onDone: () => {
      draft.discard();
      preset.onSent?.();
      onClose();
    },
  });
  const draft = useDraftAutosave(open, selKey, { kind, summary, description });
  const merging = !!dup.decision.mergeInto;
  const { queued, trySubmit } = useQueuedSubmit({
    valid: validateReport(form).length === 0,
    waiting: metaWaiting,
    submit,
  });
  const flow = useErrorFlow(reportFieldErrors(form));
  const attempt = (e?: FormEvent) => flow.attempt(e, trySubmit);
  const envText = environmentSummary(details.envDraft);

  /** Đổi chế độ (nhớ theo người). Dữ liệu đã nhập giữ nguyên; chỉ mẫu chưa sửa được chèn/bỏ theo chế độ. */
  function changeMode(next: ReportMode) {
    if (next === mode) return;
    setMode(next);
    saveReportMode(next);
    setDescription((d) => (dup.sel.mode === 'merge' ? d : descriptionForMode(d, kind, next)));
  }

  function changeKind(next: RequestKind) {
    if (next === kind) return;
    setKind(next);
    setDescription((d) => descriptionOnKindChange(d, next, mode));
  }

  /** Chọn gộp: mô tả mẫu bỏ đi (nội dung thành bình luận); bỏ chọn gộp mà mô tả trống thì trả lại mẫu. */
  function chooseDup(next: DupSelection) {
    if (next.mode === 'merge' && isReportTemplate(description)) setDescription('');
    if (dup.sel.mode === 'merge' && next.mode !== 'merge' && description.trim() === '')
      setDescription(descriptionForMode('', kind, mode));
    dup.setSel(next);
  }

  return (
    <Dialog
      open={open}
      icon={<Bug className="h-4 w-4" />}
      onOpenChange={(o) => !o && onClose()}
      title={reportDialogTitle(kind)}
      size="lg"
      onSubmit={() => attempt()}
      onEscapeKeyDown={(e) => escapeInDupPanel(e, () => dup.setDismissed(true))}
      footer={<ReportFooter busy={busy || queued} label={dup.decision.label} onClose={onClose} />}
    >
      <form id="report-issue-form" onSubmit={(e) => attempt(e)} className="space-y-4">
        <ErrorSummary errors={flow.errors} attempt={flow.attempts} />
        <ModeSwitch mode={mode} onChange={changeMode} />
        <KindPicker kind={kind} onChange={changeKind} />
        <ProjectField
          projects={projects ?? []}
          selected={selProject}
          picking={changingProject}
          onPick={() => setChangingProject(true)}
          error={flow.errorOf(FIELD_META.project.id)}
          onChange={(k) => {
            if (k !== selKey) clearDraft(selKey); // nháp theo chữ đang gõ — chuyển sang dự án mới, không để bản cũ mồ côi
            setSelKey(k);
            setChangingProject(false);
          }}
        />
        <TitleField
          kind={kind}
          summary={summary}
          onChange={(v) => {
            setSummary(v);
            dup.onSummaryChange();
          }}
          matches={matches}
          checking={checkingDup}
          dup={dup}
          canMerge={canComment}
          onSelect={chooseDup}
          error={flow.errorOf(FIELD_META.summary.id)}
        />
        <DescriptionField
          merging={merging}
          description={description}
          onChange={setDescription}
          onSubmit={() => attempt()}
          rows={mode === 'basic' ? 3 : 6}
          onPasteImages={details.pasteFiles}
        />
        <ModeSection
          mode={mode}
          isBug={isBug}
          meta={meta}
          details={details}
          envText={envText}
          onEditEnv={() => changeMode('advanced')}
        />
      </form>
    </Dialog>
  );
}
