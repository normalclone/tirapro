import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { apiErrorMessage } from '@/lib/api';
import { useProjectMeta } from '@/features/ai/api';
import { useProjects } from '@/features/projects/api';
import { useProjectSprints } from '@/features/backlog/api';
import { useSearchUsers } from '@/features/members/api';
import { uploadAttachmentFile } from '@/features/attachments/api';
import { FileDrop } from '@/features/attachments/FileDrop';
import { MarkdownEditor } from '@/features/issue-edit/MarkdownEditor';
import { Button } from '@/components/ui/Button';
import { SUBMIT_ALT_SHORTCUT, SUBMIT_SHORTCUT } from '@/lib/submitShortcut';
import { Dialog } from '@/components/ui/Dialog';
import { ErrorSummary } from '@/components/ui/ErrorSummary';
import { FieldErrorText } from '@/components/ui/FieldError';
import { Input } from '@/components/ui/Input';
import { DateTimeInput } from '@/components/ui/DateInput';
import { SearchSelect } from '@/components/ui/SearchSelect';
import { PeoplePicker } from '@/components/ui/PeoplePicker';
import { useAssigneePicker } from '@/features/issue-edit/useAssigneeOptions';
import { useAssigneeAvailability } from '@/features/resources/useAssigneeAvailability';
import { useCreateIssueModal } from '@/stores/createIssue';
import { openReportIssue } from '@/stores/reportIssue';
import { isBugType } from '@/features/issue-edit/severity';
import { ARCHIVED_PICK_HINT, CREATE_LAST_KEY } from '@/lib/currentProject';
import { useCreateIssue } from './create-api';
import { useProjectIssues } from './api';
import { epicChoices, parentChoices } from '@/lib/epic';
import { blockOnInvalidDate } from '@/lib/dateGuard';
import { fieldErrorId, type FieldError } from '@/lib/formErrors';
import { useErrorFlow } from '@/lib/useErrorFlow';
import { dueDaysFromToday } from '@/lib/dueDate';
import { TokenTitleInput } from './TokenTitleInput';
import { validateCreateIssue, type CreateIssueField } from './createIssueForm';
import {
  parseTitleTokens,
  resolveCreateValues,
  stripPartialTail,
  tokenFieldsToApply,
  type TokenCtx,
  type TokenFieldKey,
  type TokenFieldValues,
  type TokenResult,
} from './titleTokens';

// Nhớ dự án/loại đã dùng gần nhất để prefill lần sau (tăng tốc nhập liệu).
function loadLast(): { projectKey?: string; typeId?: string } {
  try {
    return JSON.parse(localStorage.getItem(CREATE_LAST_KEY) || '{}') as {
      projectKey?: string;
      typeId?: string;
    };
  } catch {
    return {};
  }
}
function saveLast(v: { projectKey?: string; typeId?: string }) {
  try {
    localStorage.setItem(CREATE_LAST_KEY, JSON.stringify(v));
  } catch {
    /* ignore */
  }
}

// Bản nháp tiêu đề/mô tả theo dự án — khôi phục khi mở lại, xoá khi tạo thành công (UX_CONVENTIONS §3/§17).
interface Draft {
  summary?: string;
  description?: string;
  acceptance?: string;
}
const DRAFT_KEY = (projectKey: string) => `tirapro:createIssue:draft:${projectKey || '_'}`;
function loadDraft(projectKey: string): Draft {
  try {
    return JSON.parse(localStorage.getItem(DRAFT_KEY(projectKey)) || '{}') as Draft;
  } catch {
    return {};
  }
}
function saveDraft(projectKey: string, d: Draft) {
  try {
    if (!d.summary?.trim() && !d.description?.trim() && !d.acceptance?.trim())
      localStorage.removeItem(DRAFT_KEY(projectKey));
    else localStorage.setItem(DRAFT_KEY(projectKey), JSON.stringify(d));
  } catch {
    /* ignore */
  }
}
function clearDraft(projectKey: string) {
  try {
    localStorage.removeItem(DRAFT_KEY(projectKey));
  } catch {
    /* ignore */
  }
}

/* --------- Mẫu mô tả gợi sẵn theo loại công việc --------- */
const TEMPLATES: Record<string, string> = {
  BUG: 'Các bước tái hiện:\n1. \n2. \n\nKết quả hiện tại:\n\nKết quả mong muốn:\n',
  STORY: 'Bối cảnh:\n\n',
  TASK: 'Mục tiêu:\n\nViệc cần làm:\n- ',
};
const TEMPLATE_VALUES = Object.values(TEMPLATES);
const isTemplate = (s: string) => TEMPLATE_VALUES.includes(s);

/** Trường của form → id phần tử trong hộp + nhãn hiện ở phần tóm tắt lỗi (theo thứ tự trong form). */
const FIELD_META: Record<CreateIssueField, { id: string; label: string }> = {
  project: { id: 'ci-project', label: 'Dự án' },
  type: { id: 'ci-type', label: 'Loại việc' },
  summary: { id: 'ci-summary', label: 'Tiêu đề' },
};

/** Nhãn + gợi ý ngắn cho một ô nhập. `title` = giải nghĩa thuật ngữ (hiện khi rê chuột vào nhãn). */
function Field({
  label,
  hint,
  title,
  className,
  htmlFor,
  error,
  children,
}: {
  label: string;
  hint?: string;
  title?: string;
  className?: string;
  /** Id của ô điều khiển (gắn nhãn) — cần khi có `error` để lời lỗi có id ổn định. */
  htmlFor?: string;
  /** Lời lỗi của trường (hiện dưới ô, đã nối aria-describedby ở ô qua `fieldErrorId(htmlFor)`). */
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={className}>
      <label
        htmlFor={htmlFor}
        className="mb-1.5 block text-sm font-medium text-muted"
        title={title}
      >
        {label}
        {hint && <span className="font-normal text-faint"> {hint}</span>}
      </label>
      {children}
      {error && htmlFor && <FieldErrorText id={fieldErrorId(htmlFor)}>{error}</FieldErrorText>}
    </div>
  );
}

/**
 * Popup "Tạo công việc" toàn cục — mở ở bất kỳ đâu qua store `useCreateIssueModal`.
 * 2 cột gọn, mô tả dùng editor Markdown, có Người phụ trách & Hạn. Hỗ trợ tạo việc con.
 */
export function CreateIssueModal() {
  const navigate = useNavigate();
  const { open, preset, close } = useCreateIssueModal();
  const { data: projects } = useProjects();

  const [selKey, setSelKey] = useState('');
  const [typeId, setTypeId] = useState('');
  const [summary, setSummary] = useState('');
  const [description, setDescription] = useState('');
  const [acceptance, setAcceptance] = useState('');
  const [priorityId, setPriorityId] = useState('');
  const [assigneeId, setAssigneeId] = useState('');
  const [sprintId, setSprintId] = useState('');
  const [points, setPoints] = useState('');
  const [due, setDue] = useState('');
  const [epicId, setEpicId] = useState('');
  const [parentPick, setParentPick] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const prevTypeRef = useRef('');
  const lastTokens = useRef<TokenResult>({ clean: '' });
  // Parse đầy đủ (kể cả token đuôi chưa đồng bộ) ở lần gõ trước, và các ô người dùng đổi tay sau lần token đổi gần nhất.
  const lastFull = useRef<TokenResult>({ clean: '' });
  const manualRef = useRef<Set<TokenFieldKey>>(new Set());
  const markManual = (k: TokenFieldKey) => manualRef.current.add(k);
  // Lần chạy effect đồng bộ token ngay sau khi mở dùng `summary` cũ (trước khi nạp bản nháp) → bỏ qua.
  const skipSyncRef = useRef(false);
  // Chữ đang giữ (không tự lưu) sau khi chọn dự án đã có nháp riêng — xem ô Dự án.
  const heldDraftRef = useRef<{
    key: string;
    summary: string;
    description: string;
    acceptance: string;
  } | null>(null);

  const selProject = useMemo(
    () => (projects ?? []).find((p) => p.key === selKey),
    [projects, selKey],
  );
  const selId = selProject?.id ?? '';

  const { data: meta } = useProjectMeta(open && selKey ? selKey : undefined);
  const { data: sprints } = useProjectSprints(open ? selId || undefined : undefined);
  const { data: projIssues = [] } = useProjectIssues(open && selId ? selId : undefined);
  // Người cho token `@tên` trong tiêu đề: thành viên của dự án đang chọn (máy chủ lọc theo dự án, bỏ tài khoản khoá).
  const { data: users } = useSearchUsers({
    projectId: selId || undefined,
    limit: 200,
    enabled: open,
  });
  const assignees = useAssigneePicker(selId || undefined);
  const availability = useAssigneeAvailability({ dueDate: due || null });
  const create = useCreateIssue(selId);

  const last = useMemo(() => loadLast(), [open]);

  // Mở popup: đặt lại theo ngữ cảnh; dự án prefill từ lần dùng gần nhất; khôi phục bản nháp (nếu có).
  useEffect(() => {
    if (!open) return;
    // pickProject: dự án hiện tại đã lưu trữ → để TRỐNG, người dùng tự chọn (không đoán dự án đầu danh sách).
    heldDraftRef.current = null;
    const key = preset.pickProject
      ? ''
      : (preset.projectKey ?? loadLast().projectKey ?? projects?.[0]?.key ?? '');
    const draft = loadDraft(key);
    setSelKey(key);
    setTypeId('');
    setSummary(draft.summary ?? '');
    setDescription(draft.description ?? '');
    setAcceptance(draft.acceptance ?? '');
    setPriorityId('');
    setAssigneeId('');
    setSprintId('');
    setPoints('');
    setDue('');
    setEpicId('');
    setParentPick('');
    setFiles([]);
    setBusy(false);
    prevTypeRef.current = '';
    lastTokens.current = { clean: '' };
    lastFull.current = { clean: '' };
    manualRef.current.clear();
    skipSyncRef.current = true;
    if (draft.summary || draft.description || draft.acceptance)
      toast.info('Đã khôi phục nội dung bạn nhập dở lần trước');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Tự lưu bản nháp (tiêu đề + mô tả) theo dự án khi đang mở — không mất khi lỡ đóng.
  useEffect(() => {
    if (!open) return;
    // Vừa chọn dự án đã có nháp riêng khi đang giữ chữ đã gõ: chưa ghi đè nháp cũ cho tới khi người dùng gõ thêm.
    const held = heldDraftRef.current;
    if (held) {
      if (
        held.key === selKey &&
        held.summary === summary &&
        held.description === description &&
        held.acceptance === acceptance
      )
        return;
      heldDraftRef.current = null;
    }
    const t = setTimeout(() => saveDraft(selKey, { summary, description, acceptance }), 400);
    return () => clearTimeout(t);
  }, [open, selKey, summary, description, acceptance]);

  // Mặc định loại: sub-task nếu tạo sub-task, ngược lại ưu tiên loại đã dùng gần nhất.
  const defaultTypeId = useMemo(() => {
    if (!meta) return '';
    if (preset.subtask)
      return meta.issueTypes.find((t) => t.isSubtask)?.id ?? meta.issueTypes[0]?.id ?? '';
    const lastId =
      last.typeId && meta.issueTypes.some((t) => t.id === last.typeId) ? last.typeId : undefined;
    return lastId ?? meta.issueTypes.find((t) => !t.isSubtask)?.id ?? meta.issueTypes[0]?.id ?? '';
  }, [meta, preset.subtask, last.typeId]);
  useEffect(() => {
    if (!meta) return;
    setTypeId((prev) => prev || defaultTypeId);
    setPriorityId((prev) => prev || meta.priorities.find((p) => p.isDefault)?.id || '');
  }, [meta, defaultTypeId]);

  const sprintOptions = useMemo(
    () => [
      { value: '', label: 'Việc chờ — chưa xếp vào sprint' },
      ...(sprints ?? [])
        .filter((s) => s.state !== 'CLOSED')
        .map((s) => ({
          value: s.id,
          label: s.state === 'ACTIVE' ? `${s.name} · đang chạy` : s.name,
        })),
    ],
    [sprints],
  );

  // Epic không thuộc epic nào, sub-task không có hàng Epic; "Việc cha" ẩn khi đã có cha định sẵn hoặc loại Epic.
  const selType = meta?.issueTypes.find((t) => t.id === typeId);
  const isEpicType = selType?.key === 'EPIC';
  const hideEpic = isEpicType || !!selType?.isSubtask;
  const hideParent = !!preset.parentId || isEpicType;
  useEffect(() => {
    if (hideEpic) setEpicId('');
    if (hideParent) setParentPick('');
  }, [hideEpic, hideParent]);
  const epicOptions = useMemo(
    () => [
      { value: '', label: 'Không thuộc epic' },
      ...epicChoices(projIssues, '').map((i) => ({
        value: i.id,
        label: i.summary,
        hint: i.key,
        color: i.type.color,
      })),
    ],
    [projIssues],
  );
  const parentOptions = useMemo(
    () => [
      { value: '', label: 'Không có việc cha' },
      ...parentChoices(projIssues, '').map((i) => ({
        value: i.id,
        label: i.summary,
        hint: i.key,
        color: i.type.color,
      })),
    ],
    [projIssues],
  );

  const tokenCtx = useMemo<TokenCtx>(
    () => ({ priorities: meta?.priorities ?? [], users: users ?? [], sprints: sprints ?? [] }),
    [meta, users, sprints],
  );

  // Đồng bộ ô bên dưới NGAY khi token khớp (không đợi rời ô tiêu đề). Chỉ áp token MỚI/ĐỔI so với lần trước
  // nên không ghi đè lựa chọn tay; gỡ token không xoá ô. Token đang gõ dở ở đuôi chưa áp (tránh ô nhảy theo từng chữ).
  // `tokenCtx` đổi khi meta/người dùng/sprint tải xong → token đã gõ trước đó được áp ở lần chạy này.
  useEffect(() => {
    if (!open) return;
    if (skipSyncRef.current) {
      skipSyncRef.current = false;
      return;
    }
    // Token vừa xuất hiện/đổi giá trị (kể cả đuôi chưa áp) → ô tương ứng lại do token quản tới khi người dùng đổi tay.
    const full = parseTitleTokens(summary, tokenCtx);
    for (const k of Object.keys(tokenFieldsToApply(lastFull.current, full, new Set()))) {
      manualRef.current.delete(k as TokenFieldKey);
    }
    lastFull.current = full;
    const next = parseTitleTokens(stripPartialTail(summary), tokenCtx);
    applyFields(tokenFieldsToApply(lastTokens.current, next, manualRef.current));
    lastTokens.current = next;
  }, [open, summary, tokenCtx]);

  // Rời ô tiêu đề: CHỈ điền các trường suy ra từ token — GIỮ nguyên chữ đang gõ trong ô
  // (tránh cảm giác "mất chữ"/không undo được). Token chỉ được lược bỏ khi thực sự tạo (doCreate).
  function applyTokens() {
    const r = parseTitleTokens(summary, tokenCtx);
    applyFields(tokenFieldsToApply(lastTokens.current, r, manualRef.current));
    lastTokens.current = r;
  }
  function applyFields(f: Partial<TokenFieldValues>) {
    if (f.priorityId) setPriorityId(f.priorityId);
    if (f.assigneeId) setAssigneeId(f.assigneeId);
    if (f.sprintId) setSprintId(f.sprintId);
    if (f.points != null) setPoints(f.points);
    if (f.due) setDue(f.due);
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

  const isStory = meta?.issueTypes.find((t) => t.id === typeId)?.key === 'STORY';
  // Chọn dự án rồi mà danh sách loại việc chưa về: chưa gửi được (không phải lỗi của người dùng) → nút chờ.
  const metaLoading = !!selId && !meta;
  // Lỗi hiện sau lần Tạo lỗi đầu tiên (sửa tới đâu hết lỗi tới đó); mở lại hộp thì xoá.
  const allErrors: FieldError[] = validateCreateIssue({
    projectId: selId,
    metaReady: !!meta,
    typeId,
    summary,
    cleanSummary: parseTitleTokens(summary, tokenCtx).clean,
  }).map((i) => ({ ...FIELD_META[i.field], message: i.message }));
  const flow = useErrorFlow(allErrors);
  const { reset: resetErrors } = flow;
  const errorOf = (f: CreateIssueField) => flow.errorOf(FIELD_META[f].id);
  useEffect(() => {
    if (open) resetErrors();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  // Cảnh báo mềm: không chặn gửi (đường Tạo / Tạo & nhập tiếp / Cmd+Enter đều như nhau).
  // Cùng định nghĩa "quá hạn" với mọi nơi khác: hạn HÔM NAY (theo ngày VN) chưa phải quá khứ.
  const dueInPast = due !== '' && dueDaysFromToday(due) < 0;
  const title = preset.subtask ? 'Tạo việc con' : 'Tạo công việc';

  async function doCreate() {
    if (create.isPending || busy || metaLoading) return null;
    const tk = parseTitleTokens(summary, tokenCtx);
    if (allErrors.length > 0) {
      flow.fail();
      return null;
    }
    // Ô ngày/giờ đang gõ sai: chặn mọi đường gửi (nút Tạo & nhập tiếp, Cmd+Enter không đi qua form native).
    if (blockOnInvalidDate()) return null;
    // Giá trị trên ô = giá trị được gửi: ô đổi tay thắng; token chỉ chèn cho ô chưa bị đổi tay và token chưa kịp
    // đồng bộ (đang gõ dở ở đuôi). Chỉ lược token khỏi tiêu đề khi TẠO.
    const v = resolveCreateValues(
      { priorityId, assigneeId, sprintId, points, due },
      lastTokens.current,
      tk,
      manualRef.current,
    );
    const finalSummary = tk.clean.trim();
    setBusy(true);
    try {
      const created = await create.mutateAsync({
        projectId: selId,
        typeId,
        summary: finalSummary,
        description: description.trim() || null,
        descriptionFormat: 'MARKDOWN',
        acceptanceCriteria: isStory ? acceptance.trim() || null : null,
        priorityId: v.priorityId || undefined,
        assigneeId: v.assigneeId || null,
        parentId: preset.parentId ?? (hideParent ? undefined : parentPick || undefined),
        epicId: hideEpic ? undefined : epicId || undefined,
        storyPoints: v.points ? Number(v.points) : undefined,
        sprintId: v.sprintId || undefined,
        dueDate: v.due ? new Date(v.due).toISOString() : undefined,
      });
      // Tải các tệp đính kèm song song → không dừng vì 1 tệp lỗi; báo rõ N/M nếu có lỗi.
      if (files.length > 0) {
        const results = await Promise.allSettled(
          files.map((f) => uploadAttachmentFile(created.id, f)),
        );
        const failed = results.filter((r) => r.status === 'rejected').length;
        if (failed > 0) {
          const failedNames = files
            .filter((_, i) => results[i]!.status === 'rejected')
            .map((f) => f.name);
          toast.error(`${failed}/${files.length} tệp chưa tải lên được`, {
            description: `${failedNames.join(', ')} — công việc đã được tạo, hãy mở nó ra và đính kèm lại các tệp này.`,
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

  // Mang tiêu đề (giữ nguyên cả token đã gõ), mô tả và tệp đính sang form Báo lỗi (có kiểm tra trùng + mức nghiêm trọng)
  // rồi đóng hộp tạo việc. Mẫu mô tả của hộp này bỏ đi (form Báo lỗi có mẫu riêng). Bản nháp tạo việc GIỮ NGUYÊN tới khi
  // báo lỗi gửi thành công (`onSent`) — lỡ đóng form Báo lỗi vẫn còn chữ để quay lại.
  function switchToReport() {
    const text = description.trim() && !isTemplate(description) ? description : undefined;
    const key = selKey;
    saveDraft(key, { summary, description, acceptance }); // chốt nháp ngay (không chờ debounce)
    openReportIssue({
      projectKey: key || undefined,
      kind: 'BUG',
      summary: summary.trim(),
      description: text,
      files,
      onSent: () => clearDraft(key),
    });
    close();
  }

  // Nút nào vừa bấm (để spinner hiện đúng nút; Cmd+Enter / Cmd+Shift+Enter cũng đi qua hai hàm dưới).
  const [via, setVia] = useState<'create' | 'another'>('create');

  // Tạo xong → đóng popup + mở issue mới.
  async function submitCreate() {
    setVia('create');
    const created = await doCreate();
    if (!created) return;
    toast.success(`Đã tạo công việc ${created.key}`);
    close();
    navigate(`/issue/${created.key}`);
  }

  // Tạo xong → GIỮ popup mở, xoá phần riêng của việc vừa tạo để nhập tiếp (giữ dự án/loại/sprint…).
  async function createAnother() {
    setVia('another');
    const created = await doCreate();
    if (!created) return;
    toast.success(`Đã tạo ${created.key} — mời bạn nhập việc tiếp theo`);
    setSummary('');
    setDescription('');
    setFiles([]);
    setPoints('');
    setDue('');
    lastTokens.current = { clean: '' };
    lastFull.current = { clean: '' };
    manualRef.current.clear();
    requestAnimationFrame(() => document.getElementById('ci-summary')?.focus());
  }

  return (
    <Dialog
      open={open}
      icon={<Plus className="h-4 w-4" />}
      onOpenChange={(o) => {
        if (!o) close();
      }}
      // Ô Dự án trống (dự án hiện tại đã lưu trữ): focus thẳng vào ô đó thay vì ô tiêu đề.
      onOpenAutoFocus={
        preset.pickProject
          ? (e) => {
              e.preventDefault();
              document.getElementById('ci-project')?.focus();
            }
          : undefined
      }
      title={title}
      size="xl"
      onSubmit={() => void submitCreate()}
      onSubmitAlt={() => void createAnother()}
      footer={
        <>
          <span className="kbd-hint mr-auto text-xs text-faint max-sm:hidden">
            ⌘/Ctrl + Enter: tạo · thêm Shift: tạo &amp; nhập tiếp
          </span>
          <Button type="button" variant="ghost" onClick={close}>
            Huỷ
          </Button>
          {/* Hai nút ngang hàng: thấy ngay "Tạo & nhập tiếp" (không giấu trong menu) — spinner hiện ở nút vừa bấm. */}
          <Button
            type="button"
            variant="secondary"
            title={`Tạo rồi giữ cửa sổ, chỉ xoá tiêu đề và mô tả (${SUBMIT_ALT_SHORTCUT.label})`}
            aria-keyshortcuts={SUBMIT_ALT_SHORTCUT.keys}
            loading={(create.isPending || busy) && via === 'another'}
            disabled={metaLoading || create.isPending || busy}
            onClick={() => void createAnother()}
          >
            Tạo &amp; nhập tiếp
          </Button>
          <Button
            type="submit"
            form="create-issue-form"
            title={`Tạo rồi mở công việc vừa tạo (${SUBMIT_SHORTCUT.label})`}
            aria-keyshortcuts={SUBMIT_SHORTCUT.keys}
            loading={(create.isPending || busy) && via === 'create'}
            disabled={metaLoading || create.isPending || busy}
          >
            Tạo
          </Button>
        </>
      }
    >
      <form
        id="create-issue-form"
        onSubmit={(e) => {
          e.preventDefault();
          void submitCreate();
        }}
      >
        <ErrorSummary errors={flow.errors} attempt={flow.attempts} className="mb-4" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Dự án" htmlFor="ci-project" error={errorOf('project')}>
            <SearchSelect
              id="ci-project"
              invalid={!!errorOf('project')}
              aria-describedby={errorOf('project') ? fieldErrorId('ci-project') : undefined}
              value={selKey}
              onChange={(v) => {
                // Đổi dự án → nạp bản nháp của DỰ ÁN MỚI (không mang chữ dự án cũ sang, không đè nháp dự án mới).
                // Riêng khi CHƯA có dự án (chọn lần đầu): giữ chữ đã gõ, chỉ nạp nháp nếu chưa gõ gì — không ghi đè.
                const typed =
                  !selKey &&
                  (summary.trim() !== '' || description.trim() !== '' || acceptance.trim() !== '');
                if (!typed) {
                  const d = loadDraft(v);
                  setSummary(d.summary ?? '');
                  setDescription(d.description ?? '');
                  setAcceptance(d.acceptance ?? '');
                } else {
                  clearDraft(selKey); // nháp "chưa có dự án" đã chuyển sang dự án vừa chọn
                  const saved = loadDraft(v);
                  if (
                    saved.summary?.trim() ||
                    saved.description?.trim() ||
                    saved.acceptance?.trim()
                  ) {
                    // Dự án này đã có nháp riêng: giữ nguyên nháp đó trong kho cho tới khi người dùng gõ thêm.
                    heldDraftRef.current = { key: v, summary, description, acceptance };
                    toast.info(
                      'Dự án này đang có một bản nháp khác — chữ bạn vừa gõ được giữ nguyên, bản nháp cũ chỉ bị thay khi bạn gõ tiếp.',
                    );
                  }
                }
                setSelKey(v);
                setTypeId('');
                manualRef.current.clear();
                setPriorityId('');
                setSprintId('');
                setAssigneeId('');
                setEpicId('');
                setParentPick('');
              }}
              placeholder="Chọn dự án…"
              searchPlaceholder="Tìm dự án…"
              options={(projects ?? []).map((p) => ({ value: p.key, label: p.name, hint: p.key }))}
            />
            {preset.pickProject && !selKey && (
              <p className="mt-1 text-xs text-muted" role="status">
                {ARCHIVED_PICK_HINT}
              </p>
            )}
          </Field>
          <Field label="Loại việc" htmlFor="ci-type" error={errorOf('type')}>
            <SearchSelect
              id="ci-type"
              invalid={!!errorOf('type')}
              aria-describedby={errorOf('type') ? fieldErrorId('ci-type') : undefined}
              value={typeId}
              onChange={setTypeId}
              disabled={!meta}
              ariaLabel="Loại việc"
              options={(meta?.issueTypes ?? []).map((t) => ({
                value: t.id,
                label: t.name,
                color: t.color,
              }))}
            />
          </Field>

          {isBugType(selType) && (
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md bg-surface-2 px-3 py-2 text-xs text-muted sm:col-span-2">
              <span>Báo lỗi có kiểm tra trùng và mức nghiêm trọng —</span>
              <button
                type="button"
                onClick={switchToReport}
                className="rounded font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
              >
                Chuyển sang form Báo lỗi
              </button>
            </p>
          )}

          <Field
            label="Tiêu đề"
            htmlFor="ci-summary"
            error={errorOf('summary')}
            className="relative z-20 sm:col-span-2"
          >
            <TokenTitleInput
              id="ci-summary"
              invalid={!!errorOf('summary')}
              ariaDescribedby={errorOf('summary') ? fieldErrorId('ci-summary') : undefined}
              autoFocus={!preset.pickProject}
              value={summary}
              onChange={setSummary}
              onBlur={applyTokens}
              ctx={tokenCtx}
              placeholder="Việc cần làm là gì? VD: Sửa lỗi không đăng nhập được trên Safari"
            />
            <p
              className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-xs text-faint"
              title="Gõ thẳng các ký hiệu này trong tiêu đề để điền nhanh các trường bên dưới — không cần bấm chuột."
            >
              <span>Gõ nhanh ngay trong tiêu đề:</span>
              <span>
                <code className="rounded bg-primary-subtle px-1 text-primary">!ưu-tiên</code>
              </span>
              <span>
                <code className="rounded bg-primary-subtle px-1 text-primary">@người</code>
              </span>
              <span>
                <code className="rounded bg-primary-subtle px-1 text-primary">#sprint</code>
              </span>
              <span>
                <code className="rounded bg-primary-subtle px-1 text-primary">~điểm</code>
              </span>
              <span>
                <code className="rounded bg-primary-subtle px-1 text-primary">^hạn</code> (mai · t6
                · 3d · 2w · 15/8)
              </span>
            </p>
          </Field>

          <Field
            label="Người phụ trách"
            hint="(tùy chọn)"
            title="Người chịu trách nhiệm làm việc này. Để trống nếu chưa biết giao cho ai."
          >
            <PeoplePicker
              value={assigneeId}
              onChange={(v) => {
                markManual('assigneeId');
                setAssigneeId(v);
              }}
              emptyLabel="Chưa gán"
              {...assignees}
              {...availability}
            />
          </Field>
          <Field
            label="Ưu tiên"
            hint="(tùy chọn)"
            title="Việc này gấp đến mức nào so với các việc khác"
          >
            <SearchSelect
              value={priorityId}
              onChange={(v) => {
                markManual('priorityId');
                setPriorityId(v);
              }}
              disabled={!meta}
              options={[
                { value: '', label: '—' },
                ...(meta?.priorities ?? []).map((p) => ({
                  value: p.id,
                  label: p.name,
                  color: p.color,
                })),
              ]}
            />
          </Field>

          <Field
            label="Sprint"
            hint="(tùy chọn)"
            title="Sprint là khoảng thời gian làm việc ngắn, thường 1–2 tuần. Để trống thì việc nằm ở Việc chờ."
          >
            <SearchSelect
              value={sprintId}
              onChange={(v) => {
                markManual('sprintId');
                setSprintId(v);
              }}
              disabled={!selId}
              ariaLabel="Sprint"
              options={sprintOptions}
            />
          </Field>
          <Field
            label="Điểm ước lượng"
            hint="(tùy chọn)"
            title="Con số ước chừng độ lớn của việc — càng lớn càng tốn công. Dùng để đo sức làm của nhóm mỗi sprint."
          >
            <Input
              type="number"
              min={0}
              inputMode="numeric"
              value={points}
              onChange={(e) => {
                markManual('points');
                setPoints(e.target.value);
              }}
              placeholder="VD: 3"
              className="text-sm"
              aria-label="Điểm ước lượng"
            />
          </Field>
          {/* Cả hàng: ô ngày dd/MM/yyyy + ô giờ HH:mm cần chỗ, và không để cột phải trống. */}
          <Field
            className="sm:col-span-2"
            label="Hạn hoàn thành"
            hint="(tùy chọn)"
            title="Mốc phải xong. Quá hạn mà chưa xong, việc sẽ hiện viền đỏ trên bảng."
          >
            <DateTimeInput
              value={due}
              onChange={(v) => {
                markManual('due');
                setDue(v);
              }}
              defaultTime="17:00"
              ariaLabel="Hạn hoàn thành"
            />
            {dueInPast && (
              <p role="status" className="mt-1 text-xs text-warning-ink">
                Hạn đã qua — việc sẽ hiện quá hạn ngay khi tạo. Vẫn tạo được.
              </p>
            )}
          </Field>

          {(!hideEpic || !hideParent) && (
            <div className="grid grid-cols-1 gap-4 sm:col-span-2 sm:grid-cols-2">
              {!hideEpic && (
                <Field
                  label="Epic"
                  hint="(tùy chọn)"
                  title="Mảng lớn mà việc này thuộc về. Tiến độ epic tính theo điểm các việc bên trong."
                >
                  <SearchSelect
                    value={epicId}
                    onChange={setEpicId}
                    disabled={!selId}
                    ariaLabel="Epic"
                    searchPlaceholder="Tìm epic theo mã hoặc tiêu đề…"
                    options={epicOptions}
                  />
                </Field>
              )}
              {!hideParent && (
                <Field
                  label="Việc cha"
                  hint="(tùy chọn)"
                  title="Công việc lớn hơn mà việc này là một phần của nó."
                >
                  <SearchSelect
                    value={parentPick}
                    onChange={setParentPick}
                    disabled={!selId}
                    ariaLabel="Việc cha"
                    searchPlaceholder="Tìm việc cha theo mã hoặc tiêu đề…"
                    options={parentOptions}
                  />
                </Field>
              )}
            </div>
          )}

          <Field
            label="Mô tả"
            hint="(tùy chọn)"
            className="sm:col-span-2"
            title="Viết đủ để người khác làm được mà không cần hỏi lại bạn."
          >
            <MarkdownEditor
              value={description}
              onChange={setDescription}
              onSubmit={() => void submitCreate()}
              onSubmitAlt={() => void createAnother()}
              rows={10}
              mentionPeople={assignees.options}
              mentionProjectId={selId || undefined}
              onPasteImages={(fs) => setFiles((prev) => [...prev, ...fs])}
              placeholder="Bối cảnh, các bước, thế nào là xong… (viết được Markdown; chèn ảnh bằng ![](đường-dẫn) hoặc dán ảnh)"
            />
          </Field>

          {isStory && (
            <Field
              label="Tiêu chí chấp nhận"
              hint="(tùy chọn — mỗi dòng một tiêu chí)"
              className="sm:col-span-2"
              title="Điều kiện để Story được coi là xong. Mỗi dòng dạng - [ ] … để tick khi nghiệm thu."
            >
              <MarkdownEditor
                value={acceptance}
                onChange={setAcceptance}
                onSubmit={() => void submitCreate()}
                onSubmitAlt={() => void createAnother()}
                rows={4}
                mentionPeople={assignees.options}
                mentionProjectId={selId || undefined}
                placeholder="- [ ] Người dùng đăng nhập được bằng email&#10;- [ ] Báo lỗi rõ khi sai mật khẩu"
              />
            </Field>
          )}

          <Field label="Tệp đính kèm" hint="(tùy chọn)" className="sm:col-span-2">
            <FileDrop
              files={files}
              onAdd={(fs) => setFiles((prev) => [...prev, ...fs])}
              onRemove={(i) => setFiles((prev) => prev.filter((_, j) => j !== i))}
            />
          </Field>
        </div>
      </form>
    </Dialog>
  );
}
