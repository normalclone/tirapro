import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Check, Download, Loader2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { JIRA_CREATE, type JiraImportOptions, type JiraImportRunInput } from '@tirapro/shared';
import type { JiraAnalyzeResult, JiraDryRunResult, JiraImportTargets } from '@tirapro/types';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Skeleton } from '@/components/ui/primitives';
import { apiErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import {
  useImportJob,
  useJiraAnalyze,
  useJiraRun,
  useJiraTargets,
  type JiraImportSummary,
} from './api';

const STEPS = ['Tải tệp', 'Ghép dữ liệu', 'Nhập & kết quả'] as const;
const NEW_PROJECT = '__new__';
/** Giá trị rỗng của ô chọn người dùng = để trống. */
const EMPTY = '';

const selectClass = cn(
  'h-9 w-full rounded-md border border-border bg-bg px-2 text-sm text-ink',
  'transition-colors focus-visible:outline-none focus-visible:border-primary',
  'focus-visible:ring-2 focus-visible:ring-[var(--ring)] disabled:opacity-50',
);

type Mapping = Record<string, string>;

/** Khớp tên không phân biệt hoa/thường; không khớp thì "Tạo mới". */
function autoMap(names: string[], options: Array<{ id: string; name: string }>): Mapping {
  const byName = new Map(options.map((o) => [o.name.toLowerCase(), o.id]));
  return Object.fromEntries(names.map((n) => [n, byName.get(n.toLowerCase()) ?? JIRA_CREATE]));
}

/** Gợi ý người dùng: khớp email, rồi tên hiển thị; không khớp thì để trống. */
function autoMapUsers(users: JiraAnalyzeResult['users'], members: JiraImportTargets['members']): Mapping {
  const out: Mapping = {};
  for (const u of users) {
    const email = (u.email ?? '').toLowerCase();
    const hit =
      (email && members.find((m) => m.email.toLowerCase() === email)) ||
      members.find((m) => m.displayName.toLowerCase() === u.name.toLowerCase());
    out[u.name] = hit ? hit.id : EMPTY;
  }
  return out;
}

function Stepper({ step }: { step: number }) {
  return (
    <ol className="mb-6 flex items-center gap-2 text-sm" aria-label="Các bước nhập dữ liệu">
      {STEPS.map((label, i) => {
        const done = i < step;
        const active = i === step;
        return (
          <li key={label} className="flex items-center gap-2" aria-current={active ? 'step' : undefined}>
            <span
              className={cn(
                'flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold',
                done && 'bg-primary text-primary-fg',
                active && 'bg-primary-subtle text-primary ring-1 ring-primary',
                !done && !active && 'bg-surface-2 text-faint',
              )}
            >
              {done ? <Check className="h-3.5 w-3.5" /> : i + 1}
            </span>
            <span className={cn(active ? 'font-medium text-ink-strong' : 'text-muted')}>{label}</span>
            {i < STEPS.length - 1 && <span className="mx-1 h-px w-6 bg-border" aria-hidden />}
          </li>
        );
      })}
    </ol>
  );
}

function MappingTable({
  title,
  hint,
  rows,
  value,
  onChange,
  children,
  disabled,
}: {
  title: string;
  hint?: string;
  rows: string[];
  value: Mapping;
  onChange: (jira: string, target: string) => void;
  /** Các `<option>` đích (ngoài "Tạo mới"/"Để trống"). */
  children: ReactNode;
  disabled?: boolean;
}) {
  if (rows.length === 0) return null;
  return (
    <div>
      <h3 className="text-sm font-medium text-ink-strong">{title}</h3>
      {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
      <div className="mt-2 divide-y divide-border rounded-md border border-border">
        {rows.map((name) => (
          <div key={name} className="grid grid-cols-[1fr_1fr] items-center gap-3 px-3 py-2 sm:grid-cols-[2fr_3fr]">
            <span className="truncate text-sm text-ink" title={name}>{name}</span>
            <select
              aria-label={`${title}: ${name}`}
              className={selectClass}
              value={value[name] ?? EMPTY}
              disabled={disabled}
              onChange={(e) => onChange(name, e.target.value)}
            >
              {children}
            </select>
          </div>
        ))}
      </div>
    </div>
  );
}

function Checkbox({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-2 text-sm">
      <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[var(--primary)]" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <span className="text-ink">{label}</span>
        {hint && <span className="block text-xs text-muted">{hint}</span>}
      </span>
    </label>
  );
}

type Options = Omit<JiraImportOptions, 'dryRun'>;

/** Wizard 3 bước: tải tệp → ghép dữ liệu → tiến độ & kết quả. */
export function JiraImportWizard() {
  const [step, setStep] = useState(0);
  const [analysis, setAnalysis] = useState<JiraAnalyzeResult | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [session, setSession] = useState(0);
  const job = useImportJob(jobId);

  function reset() {
    setStep(0);
    setAnalysis(null);
    setJobId(null);
    setSession((n) => n + 1);
  }

  return (
    <div>
      <Stepper step={step} />
      {step === 0 && (
        <UploadStep
          key={session}
          analysis={analysis}
          onAnalyzed={setAnalysis}
          onNext={() => setStep(1)}
        />
      )}
      {/* Giữ MappingStep mounted khi "Quay lại" để không mất lựa chọn đã ghép. */}
      {analysis && step < 2 && (
        <div className={step === 1 ? undefined : 'hidden'}>
          <MappingStep
            key={analysis.analyzeId}
            analysis={analysis}
            onBack={() => setStep(0)}
            onStarted={(id) => { setJobId(id); setStep(2); }}
          />
        </div>
      )}
      {step === 2 && <ProgressStep job={job.data} error={job.isError ? apiErrorMessage(job.error) : null} onReset={reset} />}
    </div>
  );
}

function UploadStep({
  analysis,
  onAnalyzed,
  onNext,
}: {
  analysis: JiraAnalyzeResult | null;
  onAnalyzed: (a: JiraAnalyzeResult) => void;
  onNext: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState('');
  const analyze = useJiraAnalyze();

  function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    analyze.mutate(file, {
      onSuccess: onAnalyzed,
      onError: (err) => toast.error(apiErrorMessage(err)),
    });
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        Trong Jira: <span className="text-ink">Bộ lọc → Xem tất cả issue → Xuất → CSV (tất cả các trường)</span>.
        Tệp tối đa 25MB; nếu lớn hơn, hãy xuất theo từng project hoặc khoảng thời gian.
      </p>
      <input ref={fileRef} type="file" accept=".csv,text/csv" className="sr-only" onChange={onPickFile} aria-label="Chọn tệp CSV Jira" />
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="secondary" size="sm" onClick={() => fileRef.current?.click()} loading={analyze.isPending}>
          <Upload className="h-4 w-4" />
          {analysis ? 'Chọn tệp khác…' : 'Chọn tệp CSV…'}
        </Button>
        {fileName && <span className="text-sm text-muted">{fileName}</span>}
      </div>

      {analysis && (
        <div className="rounded-md border border-border bg-surface-2 p-4 text-sm">
          <p className="font-medium text-ink-strong">Đã đọc {analysis.rows} issue</p>
          <ul className="mt-2 grid gap-1 text-muted sm:grid-cols-2">
            <li>Project Jira: {analysis.projectKeys.join(', ') || '—'}</li>
            <li>{analysis.issueTypes.length} loại công việc</li>
            <li>{analysis.statuses.length} trạng thái</li>
            <li>{analysis.priorities.length} mức ưu tiên</li>
            <li>{analysis.users.length} người dùng</li>
          </ul>
          {analysis.unknownColumns.length > 0 && (
            <p className="mt-3 flex items-start gap-2 text-warning">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                {analysis.unknownColumns.length} cột sẽ không được nhập: {analysis.unknownColumns.join(', ')}
              </span>
            </p>
          )}
        </div>
      )}

      <div className="flex justify-end">
        <Button onClick={onNext} disabled={!analysis}>Tiếp tục</Button>
      </div>
    </div>
  );
}

function ProjectPicker({
  projects,
  choice,
  onChoice,
  newKey,
  newName,
  onNewKey,
  onNewName,
  valid,
}: {
  projects: JiraImportTargets['projects'];
  choice: string;
  onChoice: (v: string) => void;
  newKey: string;
  newName: string;
  onNewKey: (v: string) => void;
  onNewName: (v: string) => void;
  valid: boolean;
}) {
  return (
    <div>
      <h3 className="text-sm font-medium text-ink-strong">Project đích</h3>
      <div className="mt-2 grid gap-3 sm:grid-cols-2">
        <select aria-label="Project đích" className={selectClass} value={choice} onChange={(e) => onChoice(e.target.value)}>
          <option value={NEW_PROJECT}>Tạo project mới…</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>{p.key} — {p.name}</option>
          ))}
        </select>
      </div>
      {choice === NEW_PROJECT && (
        <div className="mt-3 grid gap-3 sm:grid-cols-[8rem_1fr]">
          <div>
            <label htmlFor="jira-new-key" className="mb-1 block text-xs font-medium text-muted">Mã project</label>
            <Input id="jira-new-key" value={newKey} maxLength={10} onChange={(e) => onNewKey(e.target.value.toUpperCase())} />
          </div>
          <div>
            <label htmlFor="jira-new-name" className="mb-1 block text-xs font-medium text-muted">Tên project</label>
            <Input id="jira-new-name" value={newName} maxLength={120} onChange={(e) => onNewName(e.target.value)} />
          </div>
          {!valid && (
            <p className="text-xs text-danger sm:col-span-2">
              Mã gồm 2–10 ký tự HOA hoặc số, bắt đầu bằng chữ cái; tên không được để trống.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function OptionsPanel({ options, onChange }: { options: Options; onChange: (o: Options) => void }) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium text-ink-strong">Tuỳ chọn</h3>
      <Checkbox
        checked={options.keepJiraKey}
        onChange={(v) => onChange({ ...options, keepJiraKey: v })}
        label="Giữ mã Jira trong mô tả"
        hint="Thêm dòng “Nhập từ Jira: KEY-123” ở đầu mô tả mỗi công việc."
      />
      <Checkbox
        checked={options.importComments}
        onChange={(v) => onChange({ ...options, importComments: v })}
        label="Nhập bình luận"
      />
      <Checkbox
        checked={options.importSprints}
        onChange={(v) => onChange({ ...options, importSprints: v })}
        label="Nhập sprint"
        hint="Tạo sprint đã đóng theo tên; mỗi công việc vào sprint cuối cùng của nó."
      />
    </div>
  );
}

function DryRunSummary({ result }: { result: JiraDryRunResult }) {
  return (
    <div className="rounded-md border border-border bg-surface-2 p-4 text-sm" role="status">
      <p className="font-medium text-ink-strong">Chạy thử: không có gì được ghi vào hệ thống</p>
      <p className="mt-1 text-muted">
        Sẽ nhập {result.total} công việc ({result.epics} epic, {result.subtasks} việc con), {result.sprints} sprint,{' '}
        {result.labels} nhãn, {result.comments} bình luận.
      </p>
      {result.warnings.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-warning">{result.warnings.length} cảnh báo</summary>
          <ul className="mt-1 max-h-40 list-disc overflow-auto pl-5 text-xs text-muted">
            {result.warnings.slice(0, 200).map((w) => <li key={w}>{w}</li>)}
          </ul>
        </details>
      )}
    </div>
  );
}

function MappingTables({
  analysis,
  targets,
  newProject,
  maps,
}: {
  analysis: JiraAnalyzeResult;
  targets: JiraImportTargets;
  newProject: boolean;
  maps: MappingState;
}) {
  return (
    <>
      <MappingTable
        title="Loại công việc"
        rows={analysis.issueTypes}
        value={maps.types[0]}
        onChange={(k, v) => maps.types[1]((m) => ({ ...m, [k]: v }))}
      >
        {targets.issueTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        <option value={JIRA_CREATE}>＋ Tạo mới theo tên Jira</option>
      </MappingTable>

      <MappingTable
        title="Trạng thái"
        hint={
          newProject
            ? 'Project mới: trạng thái trùng tên với quy trình mặc định được dùng lại, còn lại tự tạo.'
            : 'Trạng thái mới tạo sẽ được thêm vào quy trình và bảng của project.'
        }
        rows={analysis.statuses}
        value={maps.statuses[0]}
        disabled={newProject}
        onChange={(k, v) => maps.statuses[1]((m) => ({ ...m, [k]: v }))}
      >
        {targets.statuses.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        <option value={JIRA_CREATE}>＋ Tạo mới / khớp theo tên</option>
      </MappingTable>

      <MappingTable
        title="Mức ưu tiên"
        rows={analysis.priorities}
        value={maps.priorities[0]}
        onChange={(k, v) => maps.priorities[1]((m) => ({ ...m, [k]: v }))}
      >
        {targets.priorities.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        <option value={JIRA_CREATE}>＋ Tạo mới theo tên Jira</option>
      </MappingTable>

      <MappingTable
        title="Người dùng"
        hint="Người không ghép được sẽ để trống (người nhập sẽ là người báo cáo)."
        rows={analysis.users.map((u) => u.name)}
        value={maps.users[0]}
        onChange={(k, v) => maps.users[1]((m) => ({ ...m, [k]: v }))}
      >
        <option value={EMPTY}>— Để trống —</option>
        {targets.members.map((m) => <option key={m.id} value={m.id}>{m.displayName} ({m.email})</option>)}
      </MappingTable>
    </>
  );
}

type MappingSetter = React.Dispatch<React.SetStateAction<Mapping>>;
interface MappingState {
  types: [Mapping, MappingSetter];
  statuses: [Mapping, MappingSetter];
  priorities: [Mapping, MappingSetter];
  users: [Mapping, MappingSetter];
}

function MappingStep({
  analysis,
  onBack,
  onStarted,
}: {
  analysis: JiraAnalyzeResult;
  onBack: () => void;
  onStarted: (jobId: string) => void;
}) {
  const defaultKey = (analysis.projectKeys[0] ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const [projectChoice, setProjectChoice] = useState<string>(NEW_PROJECT);
  const [newKey, setNewKey] = useState(defaultKey);
  const [newName, setNewName] = useState(defaultKey ? `Nhập từ Jira ${defaultKey}` : '');
  const maps: MappingState = {
    types: useState<Mapping>({}),
    statuses: useState<Mapping>({}),
    priorities: useState<Mapping>({}),
    users: useState<Mapping>({}),
  };
  const [options, setOptions] = useState<Options>({ importComments: true, importSprints: true, keepJiraKey: true });
  const [dryRun, setDryRun] = useState<JiraDryRunResult | null>(null);

  const run = useJiraRun();
  const isNew = projectChoice === NEW_PROJECT;
  const targets = useJiraTargets(isNew ? '' : projectChoice);
  const targetsData = targets.data;

  // Gợi ý mapping: loại/ưu tiên/người dùng một lần khi có dữ liệu đích; trạng thái theo project đang chọn.
  const seeded = useRef(false);
  useEffect(() => {
    if (!targetsData || seeded.current) return;
    seeded.current = true;
    maps.types[1](autoMap(analysis.issueTypes, targetsData.issueTypes));
    maps.priorities[1](autoMap(analysis.priorities, targetsData.priorities));
    maps.users[1](autoMapUsers(analysis.users, targetsData.members));
  });
  const setStatusMap = maps.statuses[1];
  useEffect(() => {
    if (!targetsData) return;
    setStatusMap(autoMap(analysis.statuses, targetsData.statuses));
    setDryRun(null);
  }, [analysis.statuses, targetsData, setStatusMap]);

  const newProjectValid = /^[A-Z][A-Z0-9]{1,9}$/.test(newKey) && newName.trim().length > 0;
  const projectValid = !isNew || newProjectValid;

  function submit(isDry: boolean) {
    const userMap: Record<string, string | null> = {};
    for (const [name, id] of Object.entries(maps.users[0])) userMap[name] = id === EMPTY ? null : id;
    const body: JiraImportRunInput = {
      analyzeId: analysis.analyzeId,
      ...(isNew ? { newProject: { key: newKey, name: newName.trim() } } : { projectId: projectChoice }),
      mapping: { issueTypes: maps.types[0], statuses: maps.statuses[0], priorities: maps.priorities[0], users: userMap },
      options: { ...options, dryRun: isDry },
    };
    run.mutate(body, {
      onSuccess: (res) => {
        if ('dryRun' in res) setDryRun(res);
        else onStarted(res.jobId);
      },
      onError: (err) => toast.error(apiErrorMessage(err)),
    });
  }

  const busyDry = run.isPending && run.variables?.options.dryRun === true;
  const busyReal = run.isPending && run.variables?.options.dryRun === false;

  return (
    <div className="space-y-6">
      <ProjectPicker
        projects={targetsData?.projects ?? []}
        choice={projectChoice}
        onChoice={setProjectChoice}
        newKey={newKey}
        newName={newName}
        onNewKey={setNewKey}
        onNewName={setNewName}
        valid={newProjectValid}
      />

      {targets.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
        </div>
      ) : targets.isError || !targetsData ? (
        <p className="text-sm text-danger">
          Không tải được danh sách để ghép: {apiErrorMessage(targets.error)}{' '}
          <button type="button" className="underline" onClick={() => void targets.refetch()}>Thử lại</button>
        </p>
      ) : (
        <MappingTables analysis={analysis} targets={targetsData} newProject={isNew} maps={maps} />
      )}

      <OptionsPanel options={options} onChange={setOptions} />
      {dryRun && <DryRunSummary result={dryRun} />}

      <div className="flex flex-wrap justify-between gap-2">
        <Button variant="ghost" onClick={onBack}>Quay lại</Button>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => submit(true)} loading={busyDry} disabled={!projectValid || !targetsData || run.isPending}>
            Chạy thử
          </Button>
          <Button onClick={() => submit(false)} loading={busyReal} disabled={!projectValid || !targetsData || run.isPending}>
            Bắt đầu nhập
          </Button>
        </div>
      </div>
    </div>
  );
}

function ProgressStep({
  job,
  error,
  onReset,
}: {
  job: ReturnType<typeof useImportJob>['data'];
  error: string | null;
  onReset: () => void;
}) {
  if (error) {
    return <p className="text-sm text-danger">Không theo dõi được tiến độ: {error}. Kiểm tra lại ở “Lịch sử nhập” của dự án.</p>;
  }
  if (!job) {
    return <p className="flex items-center gap-2 text-sm text-muted"><Loader2 className="h-4 w-4 animate-spin" />Đang khởi động…</p>;
  }
  const running = job.status === 'RUNNING' || job.status === 'PENDING';
  const summary = (job.result ?? {}) as JiraImportSummary;

  function downloadLog() {
    if (!job?.errorLog) return;
    const url = URL.createObjectURL(new Blob([job.errorLog], { type: 'text/plain;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `jira-import-${job.id}-errors.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4" aria-live="polite">
      {running ? (
        <>
          <p className="flex items-center gap-2 text-sm text-ink">
            <Loader2 className="h-4 w-4 animate-spin" />
            Đang nhập {job.processedItems}/{job.totalItems ?? '…'} công việc. Bạn có thể rời trang — việc nhập vẫn chạy tiếp.
          </p>
          <div className="h-2 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuenow={job.progress} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full bg-primary transition-all duration-300" style={{ width: `${job.progress}%` }} />
          </div>
        </>
      ) : (
        <>
          <p className={cn('text-sm font-medium', job.status === 'COMPLETED' ? 'text-ink-strong' : 'text-danger')}>
            {job.status === 'COMPLETED'
              ? `Đã nhập ${summary.created ?? 0}/${job.totalItems ?? 0} công việc${summary.failed ? `, ${summary.failed} dòng lỗi` : ''}.`
              : 'Nhập thất bại — không có công việc nào được tạo. Tải nhật ký lỗi để xem lý do.'}
          </p>
          <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
            {[
              ['Epic', summary.epics],
              ['Việc con', summary.subtasks],
              ['Sprint', summary.sprints],
              ['Nhãn gắn', summary.labels],
              ['Bình luận', summary.comments],
              ['Cảnh báo', summary.warnings],
              ['Lỗi', summary.failed],
            ].map(([label, n]) => (
              <div key={String(label)} className="rounded-md border border-border bg-surface-2 px-3 py-2">
                <dt className="text-xs text-muted">{label}</dt>
                <dd className="text-base font-semibold text-ink-strong">{n ?? 0}</dd>
              </div>
            ))}
          </dl>
          <div className="flex flex-wrap gap-2">
            {job.errorLog && (
              <Button variant="secondary" size="sm" onClick={downloadLog}>
                <Download className="h-4 w-4" />
                Tải nhật ký lỗi
              </Button>
            )}
            {job.status === 'COMPLETED' && summary.projectKey && (
              <Link to={`/p/${summary.projectKey}/backlog`} className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-sm font-medium text-primary-fg hover:bg-primary-hover">
                Mở project {summary.projectKey}
              </Link>
            )}
            <Button variant="ghost" size="sm" onClick={onReset}>Nhập tệp khác</Button>
          </div>
        </>
      )}
    </div>
  );
}
