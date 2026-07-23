import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Paperclip, Plus, X } from 'lucide-react';
import { toast } from 'sonner';
import { apiErrorMessage } from '@/lib/api';
import { useProjectMeta } from '@/features/ai/api';
import { useProjects } from '@/features/projects/api';
import { useProjectSprints } from '@/features/backlog/api';
import { useWorkspaceUsers } from '@/features/issue-edit/api';
import { uploadAttachmentFile } from '@/features/attachments/api';
import { MarkdownEditor } from '@/features/issue-edit/DescriptionEditor';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { SearchSelect } from '@/components/ui/SearchSelect';
import { PeoplePicker } from '@/components/ui/PeoplePicker';
import { useAssigneeOptions } from '@/features/issue-edit/useAssigneeOptions';
import { useCreateIssueModal } from '@/stores/createIssue';
import { cn } from '@/lib/utils';
import { useCreateIssue } from './create-api';
import { TokenTitleInput } from './TokenTitleInput';
import { parseTitleTokens, type TokenCtx } from './titleTokens';

const selectClass = cn(
  'h-9 w-full rounded-md border border-border bg-bg px-3 text-sm text-ink',
  'transition-colors duration-150 focus-visible:outline-none focus-visible:border-primary',
  'focus-visible:ring-2 focus-visible:ring-[var(--ring)] disabled:opacity-50',
);

// Nhớ dự án/loại đã dùng gần nhất để prefill lần sau (tăng tốc nhập liệu).
const LAST_KEY = 'tirapro:createIssue:last';
function loadLast(): { projectKey?: string; typeId?: string } {
  try { return JSON.parse(localStorage.getItem(LAST_KEY) || '{}'); } catch { return {}; }
}
function saveLast(v: { projectKey?: string; typeId?: string }) {
  try { localStorage.setItem(LAST_KEY, JSON.stringify(v)); } catch { /* ignore */ }
}

// Bản nháp tiêu đề/mô tả theo dự án — khôi phục khi mở lại, xoá khi tạo thành công (UX_CONVENTIONS §3/§17).
interface Draft { summary?: string; description?: string }
const DRAFT_KEY = (projectKey: string) => `tirapro:createIssue:draft:${projectKey || '_'}`;
function loadDraft(projectKey: string): Draft {
  try { return JSON.parse(localStorage.getItem(DRAFT_KEY(projectKey)) || '{}'); } catch { return {}; }
}
function saveDraft(projectKey: string, d: Draft) {
  try {
    if (!d.summary?.trim() && !d.description?.trim()) localStorage.removeItem(DRAFT_KEY(projectKey));
    else localStorage.setItem(DRAFT_KEY(projectKey), JSON.stringify(d));
  } catch { /* ignore */ }
}
function clearDraft(projectKey: string) {
  try { localStorage.removeItem(DRAFT_KEY(projectKey)); } catch { /* ignore */ }
}

/* --------- Mẫu mô tả theo loại issue --------- */
const TEMPLATES: Record<string, string> = {
  BUG: 'Các bước tái hiện:\n1. \n2. \n\nKết quả hiện tại:\n\nKết quả mong muốn:\n',
  STORY: 'Bối cảnh:\n\nTiêu chí hoàn thành:\n- \n- ',
  TASK: 'Mục tiêu:\n\nViệc cần làm:\n- ',
};
const TEMPLATE_VALUES = Object.values(TEMPLATES);
const isTemplate = (s: string) => TEMPLATE_VALUES.includes(s);

function Field({ label, hint, className, children }: { label: string; hint?: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={className}>
      <label className="mb-1.5 block text-sm font-medium text-muted">
        {label}
        {hint && <span className="font-normal text-faint"> {hint}</span>}
      </label>
      {children}
    </div>
  );
}

/**
 * Popup "Tạo issue" toàn cục — mở ở bất kỳ đâu qua store `useCreateIssueModal`.
 * 2 cột gọn, mô tả dùng editor Markdown, có Người phụ trách & Hạn. Hỗ trợ tạo sub-task.
 */
export function CreateIssueModal() {
  const navigate = useNavigate();
  const { open, preset, close } = useCreateIssueModal();
  const { data: projects } = useProjects();

  const [selKey, setSelKey] = useState('');
  const [typeId, setTypeId] = useState('');
  const [summary, setSummary] = useState('');
  const [description, setDescription] = useState('');
  const [priorityId, setPriorityId] = useState('');
  const [assigneeId, setAssigneeId] = useState('');
  const [sprintId, setSprintId] = useState('');
  const [points, setPoints] = useState('');
  const [due, setDue] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const prevTypeRef = useRef('');

  const selProject = useMemo(() => (projects ?? []).find((p) => p.key === selKey), [projects, selKey]);
  const selId = selProject?.id ?? '';

  const { data: meta } = useProjectMeta(open && selKey ? selKey : undefined);
  const { data: sprints } = useProjectSprints(open ? selId || undefined : undefined);
  const { data: users } = useWorkspaceUsers();
  const assignees = useAssigneeOptions(selId || undefined);
  const create = useCreateIssue(selId);

  const last = useMemo(() => loadLast(), [open]);

  // Mở popup: đặt lại theo ngữ cảnh; dự án prefill từ lần dùng gần nhất; khôi phục bản nháp (nếu có).
  useEffect(() => {
    if (!open) return;
    const key = preset.projectKey ?? loadLast().projectKey ?? projects?.[0]?.key ?? '';
    const draft = loadDraft(key);
    setSelKey(key);
    setTypeId(''); setSummary(draft.summary ?? ''); setDescription(draft.description ?? ''); setPriorityId('');
    setAssigneeId(''); setSprintId(''); setPoints(''); setDue(''); setFiles([]); setBusy(false);
    prevTypeRef.current = '';
    if (draft.summary || draft.description) toast.info('Đã khôi phục bản nháp chưa tạo');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Tự lưu bản nháp (tiêu đề + mô tả) theo dự án khi đang mở — không mất khi lỡ đóng.
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => saveDraft(selKey, { summary, description }), 400);
    return () => clearTimeout(t);
  }, [open, selKey, summary, description]);

  // Mặc định loại: sub-task nếu tạo sub-task, ngược lại ưu tiên loại đã dùng gần nhất.
  const defaultTypeId = useMemo(() => {
    if (!meta) return '';
    if (preset.subtask) return meta.issueTypes.find((t) => t.isSubtask)?.id ?? meta.issueTypes[0]?.id ?? '';
    const lastId = last.typeId && meta.issueTypes.some((t) => t.id === last.typeId) ? last.typeId : undefined;
    return lastId ?? meta.issueTypes.find((t) => !t.isSubtask)?.id ?? meta.issueTypes[0]?.id ?? '';
  }, [meta, preset.subtask, last.typeId]);
  useEffect(() => {
    if (!meta) return;
    setTypeId((prev) => prev || defaultTypeId);
    setPriorityId((prev) => prev || meta.priorities.find((p) => p.isDefault)?.id || '');
  }, [meta, defaultTypeId]);

  const sprintOptions = useMemo(
    () => [
      { value: '', label: 'Backlog (không sprint)' },
      ...(sprints ?? [])
        .filter((s) => s.state !== 'CLOSED')
        .map((s) => ({ value: s.id, label: s.state === 'ACTIVE' ? `${s.name} · đang chạy` : s.name })),
    ],
    [sprints],
  );

  const tokenCtx = useMemo<TokenCtx>(
    () => ({ priorities: meta?.priorities ?? [], users: users ?? [], sprints: sprints ?? [] }),
    [meta, users, sprints],
  );

  // Rời ô tiêu đề: CHỈ điền các trường suy ra từ token — GIỮ nguyên chữ đang gõ trong ô
  // (tránh cảm giác "mất chữ"/không undo được). Token chỉ được lược bỏ khi thực sự tạo (doCreate).
  function applyTokens() {
    const r = parseTitleTokens(summary, tokenCtx);
    if (r.priorityId) setPriorityId(r.priorityId);
    if (r.assigneeId) setAssigneeId(r.assigneeId);
    if (r.sprintId) setSprintId(r.sprintId);
    if (r.points != null) setPoints(String(r.points));
    if (r.dueLocal) setDue(r.dueLocal);
  }

  // Đổi loại → tự điền mẫu mô tả (chỉ khi mô tả trống hoặc đang là mẫu; bỏ qua lần đặt mặc định đầu).
  useEffect(() => {
    if (!meta || !typeId) return;
    const prev = prevTypeRef.current;
    prevTypeRef.current = typeId;
    if (!prev) return;
    const t = meta.issueTypes.find((x) => x.id === typeId);
    const tmpl = TEMPLATES[t?.key ?? ''] ?? '';
    setDescription((d) => (d === '' || isTemplate(d) ? tmpl : d));
  }, [typeId, meta]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') close(); }
    if (open) window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);

  if (!open) return null;

  const trimmed = summary.trim();
  const canSubmit = !!meta && !!selId && !!typeId && trimmed.length > 0 && !create.isPending && !busy;
  const title = preset.subtask ? 'Tạo sub-task' : 'Tạo issue';

  async function doCreate() {
    if (!canSubmit) return null;
    // Áp token gõ nhanh còn sót (nếu chưa blur) — token thắng giá trị đang chọn. Chỉ lược token khi TẠO.
    const tk = parseTitleTokens(summary, tokenCtx);
    const finalSummary = tk.clean.trim();
    if (!finalSummary) { toast.error('Cần nhập tiêu đề'); return null; }
    setBusy(true);
    try {
      const created = await create.mutateAsync({
        projectId: selId,
        typeId,
        summary: finalSummary,
        description: description.trim() || null,
        descriptionFormat: 'MARKDOWN',
        priorityId: (tk.priorityId ?? priorityId) || undefined,
        assigneeId: (tk.assigneeId ?? assigneeId) || null,
        parentId: preset.parentId ?? undefined,
        storyPoints: tk.points ?? (points ? Number(points) : undefined),
        sprintId: (tk.sprintId ?? sprintId) || undefined,
        dueDate: tk.dueLocal ? new Date(tk.dueLocal).toISOString() : (due ? new Date(due).toISOString() : undefined),
      });
      // Tải các tệp đính kèm song song → không dừng vì 1 tệp lỗi; báo rõ N/M nếu có lỗi.
      if (files.length > 0) {
        const results = await Promise.allSettled(files.map((f) => uploadAttachmentFile(created.id, f)));
        const failed = results.filter((r) => r.status === 'rejected').length;
        if (failed > 0) {
          const failedNames = files.filter((_, i) => results[i]!.status === 'rejected').map((f) => f.name);
          toast.error(`${failed}/${files.length} tệp không tải lên được`, {
            description: failedNames.join(', '),
            duration: 6000,
          });
        }
      }
      clearDraft(selKey); // tạo xong → xoá bản nháp đã lưu
      saveLast({ projectKey: selKey, typeId }); // nhớ cho lần sau
      return created;
    } catch (err) {
      toast.error(apiErrorMessage(err));
      return null;
    } finally {
      setBusy(false);
    }
  }

  // Tạo xong → đóng popup + mở issue mới.
  async function submitCreate() {
    const created = await doCreate();
    if (!created) return;
    toast.success(`Đã tạo ${created.key}`);
    close();
    navigate(`/issue/${created.key}`);
  }

  // Tạo xong → GIỮ popup mở, xoá phần riêng của issue để nhập tiếp (giữ dự án/loại/sprint…).
  async function createAnother() {
    const created = await doCreate();
    if (!created) return;
    toast.success(`Đã tạo ${created.key} · nhập tiếp`);
    setSummary(''); setDescription(''); setFiles([]); setPoints(''); setDue('');
    requestAnimationFrame(() => document.getElementById('ci-summary')?.focus());
  }

  return (
    <div className="fixed inset-0 z-modal flex items-start justify-center p-4 pt-[7vh]">
      <button className="absolute inset-0 bg-black/30 animate-in fade-in duration-200" onClick={close} aria-label="Đóng" />
      <div className="relative flex max-h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-lg animate-in fade-in zoom-in-95 duration-200">
        <header className="flex items-center gap-2 border-b border-border px-5 py-3">
          <Plus className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium text-ink">{title}</span>
          <Button variant="ghost" size="icon" className="ml-auto" onClick={close} aria-label="Đóng">
            <X className="h-4 w-4" />
          </Button>
        </header>

        <form
          onSubmit={(e) => { e.preventDefault(); void submitCreate(); }}
          onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); void submitCreate(); } }}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="grid flex-1 grid-cols-1 gap-4 overflow-y-auto px-5 py-4 sm:grid-cols-2">
            <Field label="Dự án">
              <SearchSelect
                value={selKey}
                onChange={(v) => {
                  // Đổi dự án → nạp bản nháp của DỰ ÁN MỚI (không mang chữ dự án cũ sang, không đè nháp dự án mới).
                  const d = loadDraft(v);
                  setSelKey(v);
                  setTypeId(''); setPriorityId(''); setSprintId(''); setAssigneeId('');
                  setSummary(d.summary ?? ''); setDescription(d.description ?? '');
                }}
                placeholder="Chọn dự án…"
                searchPlaceholder="Tìm dự án…"
                className={selectClass}
                options={(projects ?? []).map((p) => ({ value: p.key, label: p.name, hint: p.key }))}
              />
            </Field>
            <Field label="Loại">
              <SearchSelect
                value={typeId}
                onChange={setTypeId}
                disabled={!meta}
                className={selectClass}
                options={(meta?.issueTypes ?? []).map((t) => ({ value: t.id, label: t.name, color: t.color }))}
              />
            </Field>

            <Field label="Tiêu đề" className="relative z-20 sm:col-span-2">
              <TokenTitleInput
                id="ci-summary"
                autoFocus
                value={summary}
                onChange={setSummary}
                onBlur={applyTokens}
                ctx={tokenCtx}
                placeholder="Tóm tắt ngắn gọn issue…"
              />
              <p className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-xs text-faint">
                <span>Gõ nhanh:</span>
                <span><code className="rounded bg-surface-2 px-1 text-ink">!ưu-tiên</code></span>
                <span><code className="rounded bg-surface-2 px-1 text-ink">@người</code></span>
                <span><code className="rounded bg-surface-2 px-1 text-ink">#sprint</code></span>
                <span><code className="rounded bg-surface-2 px-1 text-ink">~điểm</code></span>
                <span><code className="rounded bg-surface-2 px-1 text-ink">^hạn</code> (mai · t6 · 3d · 2w · 15/8)</span>
              </p>
            </Field>

            <Field label="Người phụ trách" hint="(tùy chọn)">
              <PeoplePicker
                value={assigneeId}
                onChange={setAssigneeId}
                emptyLabel="Chưa gán"
                className={selectClass}
                options={assignees}
              />
            </Field>
            <Field label="Ưu tiên" hint="(tùy chọn)">
              <SearchSelect
                value={priorityId}
                onChange={setPriorityId}
                disabled={!meta}
                className={selectClass}
                options={[{ value: '', label: '—' }, ...(meta?.priorities ?? []).map((p) => ({ value: p.id, label: p.name, color: p.color }))]}
              />
            </Field>

            <Field label="Sprint" hint="(tùy chọn)">
              <SearchSelect value={sprintId} onChange={setSprintId} disabled={!selId} className={selectClass} options={sprintOptions} />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Story points" hint="(tùy chọn)">
                <Input type="number" min={0} inputMode="numeric" value={points} onChange={(e) => setPoints(e.target.value)} placeholder="VD: 3" className="text-sm" />
              </Field>
              <Field label="Hạn" hint="(tùy chọn)">
                <Input type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} className="text-sm" />
              </Field>
            </div>

            <Field label="Mô tả" hint="(tùy chọn)" className="sm:col-span-2">
              <MarkdownEditor value={description} onChange={setDescription} onSubmit={() => void submitCreate()} rows={10} placeholder="Thêm chi tiết, bối cảnh, tiêu chí hoàn thành… (Markdown, ảnh ![](url))" />
            </Field>

            <Field label="Tệp đính kèm" hint="(tùy chọn)" className="sm:col-span-2">
              <FileDrop
                files={files}
                onAdd={(fs) => setFiles((prev) => [...prev, ...fs])}
                onRemove={(i) => setFiles((prev) => prev.filter((_, j) => j !== i))}
              />
            </Field>
          </div>

          <footer className="flex items-center gap-2 border-t border-border px-5 py-3">
            <span className="mr-auto hidden text-xs text-faint sm:block">⌘/Ctrl + Enter để tạo nhanh</span>
            <Button type="button" variant="ghost" onClick={close}>Hủy</Button>
            <Button type="button" variant="secondary" onClick={() => void createAnother()} loading={busy} disabled={!canSubmit}>Tạo &amp; thêm tiếp</Button>
            <Button type="submit" loading={create.isPending || busy} disabled={!canSubmit}>{title}</Button>
          </footer>
        </form>
      </div>
    </div>
  );
}

function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** Vùng chọn/kéo-thả tệp (giữ cục bộ tới khi tạo issue rồi mới upload). */
function FileDrop({ files, onAdd, onRemove }: { files: File[]; onAdd: (f: File[]) => void; onRemove: (i: number) => void }) {
  const [over, setOver] = useState(false);
  return (
    <div>
      <label
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); onAdd(Array.from(e.dataTransfer.files)); }}
        className={cn(
          'flex cursor-pointer flex-col items-center justify-center gap-1 rounded-md border border-dashed px-3 py-5 text-center text-sm transition-colors',
          over ? 'border-primary bg-primary-subtle/40 text-ink' : 'border-border text-muted hover:border-primary hover:text-ink',
        )}
      >
        <Paperclip className="h-4 w-4" aria-hidden />
        <span>Kéo thả tệp vào đây hoặc <span className="font-medium text-primary">bấm để chọn</span></span>
        <input
          type="file"
          multiple
          className="hidden"
          onChange={(e) => { if (e.target.files?.length) onAdd(Array.from(e.target.files)); e.currentTarget.value = ''; }}
        />
      </label>
      {files.length > 0 && (
        <ul className="mt-2 space-y-1">
          {files.map((f, i) => (
            <li key={i} className="flex items-center gap-2 rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-sm">
              <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted" aria-hidden />
              <span className="min-w-0 flex-1 truncate text-ink">{f.name}</span>
              <span className="shrink-0 text-xs text-faint tabular">{fmtSize(f.size)}</span>
              <button
                type="button"
                onClick={() => onRemove(i)}
                aria-label={`Bỏ ${f.name}`}
                className="grid h-5 w-5 shrink-0 place-items-center rounded text-faint transition-colors hover:bg-surface-3 hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
