import { useMemo, useState } from 'react';
import { Bug, ChevronRight } from 'lucide-react';
import type { EnvironmentInput } from '@tirapro/shared';
import type { ProjectDto } from '@tirapro/types';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Input } from '@/components/ui/Input';
import { SearchSelect } from '@/components/ui/SearchSelect';
import { useOpenSession } from '@/lib/useOpenSession';
import { useCreateTarget } from '@/lib/useCreateTarget';
import { useProjectMeta } from '@/features/ai/api';
import { useProjects } from '@/features/projects/api';
import { MarkdownEditor } from '@/features/issue-edit/MarkdownEditor';
import { useReportIssueModal, type ReportIssuePreset } from '@/stores/reportIssue';
import { useDuplicateCheck, type DuplicateSuggestion } from './api';
import { DuplicatePanel } from './DuplicatePanel';
import { useDupChoice } from './useDupChoice';
import type { DupSelection } from './dupDecision';
import { FIELD_LABEL, ReportDetails } from './ReportDetails';
import { clearDraft, useDraftAutosave, useReportInitial } from './useReportDraft';
import { useReportDetails } from './useReportDetails';
import { useReportSubmit } from './useReportSubmit';
import {
  isReportTemplate,
  REPORT_KINDS,
  reportDialogTitle,
  reportKindLabel,
  reportTemplate,
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

/** Ba nút phân đoạn chọn loại yêu cầu. */
function KindPicker({ kind, onChange }: { kind: RequestKind; onChange: (k: RequestKind) => void }) {
  return (
    <div role="radiogroup" aria-label="Loại yêu cầu" className="flex gap-1.5">
      {REPORT_KINDS.map((k) => (
        <button
          key={k}
          type="button"
          role="radio"
          aria-checked={kind === k}
          onClick={() => onChange(k)}
          className={cn(
            'h-8 flex-1 rounded-md border px-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
            kind === k
              ? 'border-primary bg-primary-subtle font-medium text-primary'
              : 'border-border text-muted hover:bg-surface-2 hover:text-ink',
          )}
        >
          {reportKindLabel(k)}
        </button>
      ))}
    </div>
  );
}

/** Dự án đích: một dòng "Gửi vào X · Đổi"; chưa có dự án (hoặc bấm Đổi) thì ô chọn — không tự đoán dự án lạ. */
function ProjectField({
  projects,
  selected,
  picking,
  onPick,
  onChange,
}: {
  projects: ProjectDto[];
  selected: ProjectDto | undefined;
  picking: boolean;
  onPick: () => void;
  onChange: (key: string) => void;
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
        value={selected?.key ?? ''}
        onChange={onChange}
        placeholder="Chọn dự án nhận báo cáo…"
        searchPlaceholder="Tìm dự án…"
        options={projects.map((p) => ({ value: p.key, label: p.name, hint: p.key }))}
      />
      {!selected && (
        <p className="mt-1 text-xs text-muted" role="status">
          Chọn dự án để gửi — hộp này không tự đoán dự án.
        </p>
      )}
    </div>
  );
}

/** Nút gập/mở khối "Thêm chi tiết". */
function DetailsToggle({
  open,
  isBug,
  onToggle,
}: {
  open: boolean;
  isBug: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-controls="ri-details"
      className="inline-flex items-center gap-1 rounded-md text-sm font-medium text-muted transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
    >
      <ChevronRight
        className={cn(
          'h-4 w-4 transition-transform duration-fast motion-reduce:transition-none',
          open && 'rotate-90',
        )}
        aria-hidden
      />
      Thêm chi tiết
      <span className="font-normal text-faint">
        {isBug ? '(mức nghiêm trọng, môi trường, tệp đính kèm)' : '(tệp đính kèm)'}
      </span>
    </button>
  );
}

/** Hàng nút đáy: gợi ý phím tắt, Hủy, Gửi. */
function ReportFooter({
  busy,
  canSubmit,
  label,
  onClose,
}: {
  busy: boolean;
  canSubmit: boolean;
  label: string;
  onClose: () => void;
}) {
  return (
    <>
      <span className="mr-auto hidden text-xs text-faint sm:block">
        ⌘/Ctrl + Enter để gửi nhanh
      </span>
      <Button type="button" variant="ghost" onClick={onClose}>
        Hủy
      </Button>
      <Button type="submit" form="report-issue-form" loading={busy} disabled={!canSubmit}>
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
  onSelect,
}: {
  kind: RequestKind;
  summary: string;
  onChange: (v: string) => void;
  matches: DuplicateSuggestion[];
  checking: boolean;
  dup: ReturnType<typeof useDupChoice>;
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
        aria-describedby={showPanel ? 'ri-dup' : undefined}
      />
      {showPanel && (
        <DuplicatePanel
          matches={matches}
          selection={dup.sel}
          exact={matches.find((m) => m.id === dup.decision.exact?.id)}
          onSelect={onSelect}
        />
      )}
      {checking && !showPanel && long && (
        <p className="mt-1.5 text-xs text-faint">Đang kiểm tra trùng lặp…</p>
      )}
    </div>
  );
}

const TITLE_PLACEHOLDER: Record<RequestKind, string> = {
  BUG: 'Mô tả ngắn gọn lỗi/sự cố gặp phải…',
  FEATURE: 'Bạn muốn có tính năng gì?',
  QUESTION: 'Bạn muốn hỏi điều gì?',
};

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

  const initial = useReportInitial(open, preset, target.projectKey);
  const [selKey, setSelKey] = useState(initial.key);
  const [changingProject, setChangingProject] = useState(false);
  const details = useReportDetails();
  const [kind, setKind] = useState<RequestKind>(initial.kind);
  const [summary, setSummary] = useState(initial.summary);
  const [description, setDescription] = useState(initial.description);

  const selProject = useMemo(
    () => (projects ?? []).find((p) => p.key.toLowerCase() === selKey.toLowerCase()),
    [projects, selKey],
  );
  const projectId = selProject?.id ?? '';
  const isBug = kind === 'BUG';
  const { data: meta } = useProjectMeta(open && selProject ? selProject.key : undefined);
  const { data: duplicates, isFetching: checkingDup } = useDuplicateCheck(
    open ? projectId : undefined,
    summary,
  );
  const matches = duplicates ?? [];
  const dup = useDupChoice(matches, summary);

  const form = {
    projectId,
    kind,
    summary,
    description,
    severityId: details.props.severityId,
    environment: details.envDraft as EnvironmentInput,
    mergeIntoIssueId: dup.decision.mergeInto?.id ?? null,
    forceNew: dup.decision.forceNew,
  };
  const { busy, canSubmit, submit } = useReportSubmit({
    form,
    files: details.files,
    onEnvInvalid: details.showEnvError,
    onDone: () => {
      clearDraft(selKey);
      onClose();
    },
  });
  useDraftAutosave(open, selKey, { kind, summary, description });
  const merging = !!dup.decision.mergeInto;

  function changeKind(next: RequestKind) {
    if (next === kind) return;
    setKind(next);
    // Chỉ thay mô tả khi đang trống hoặc đang đúng một mẫu (không đè chữ người dùng).
    setDescription((d) => (d.trim() === '' || isReportTemplate(d) ? reportTemplate(next) : d));
  }

  /** Chọn gộp: mô tả mẫu bỏ đi (nội dung thành bình luận); bỏ chọn gộp mà mô tả trống thì trả lại mẫu. */
  function chooseDup(next: DupSelection) {
    if (next.mode === 'merge' && isReportTemplate(description)) setDescription('');
    if (dup.sel.mode === 'merge' && next.mode !== 'merge' && description.trim() === '')
      setDescription(reportTemplate(kind));
    dup.setSel(next);
  }

  return (
    <Dialog
      open={open}
      icon={<Bug className="h-4 w-4" />}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title={reportDialogTitle(kind)}
      size="lg"
      onSubmit={() => void submit()}
      // Esc đang ở trong panel gợi ý trùng thì chỉ đóng panel, không đóng cả hộp.
      onEscapeKeyDown={(e) => {
        if (!document.activeElement?.closest('#ri-dup')) return;
        e.preventDefault();
        dup.setDismissed(true);
        document.getElementById('ri-summary')?.focus();
      }}
      footer={
        <ReportFooter
          busy={busy}
          canSubmit={canSubmit}
          label={dup.decision.label}
          onClose={onClose}
        />
      }
    >
      <form id="report-issue-form" onSubmit={(e) => void submit(e)} className="space-y-4">
        <KindPicker kind={kind} onChange={changeKind} />
        <ProjectField
          projects={projects ?? []}
          selected={selProject}
          picking={changingProject}
          onPick={() => setChangingProject(true)}
          onChange={(k) => {
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
          onSelect={chooseDup}
        />
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
            onChange={setDescription}
            onSubmit={() => void submit()}
            rows={6}
            placeholder="Viết được Markdown; chèn ảnh bằng ![](đường-dẫn)"
          />
        </div>
        <div>
          <DetailsToggle open={details.open} isBug={isBug} onToggle={details.toggle} />
          {details.open && <ReportDetails isBug={isBug} meta={meta} {...details.props} />}
        </div>
      </form>
    </Dialog>
  );
}
