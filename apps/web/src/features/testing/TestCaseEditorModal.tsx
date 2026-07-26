import { useEffect, useMemo, useState } from 'react';
import { Link2, Plus, Search, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { PeoplePicker } from '@/components/ui/PeoplePicker';
import { EmptyState, Skeleton } from '@/components/ui/primitives';
import { useAssigneeOptions } from '@/features/issue-edit/useAssigneeOptions';
import { apiErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Field, ModalShell, textareaClass } from './ModalShell';
import {
  useCreateTestCase, useDebounced, useLinkTestCaseIssues, useProjectIssueSearch,
  useUnlinkTestCaseIssues, useUpdateTestCase, type TestCaseDto,
} from './api';

/** Modal tạo/sửa ca kiểm thử: tiêu đề, tiền điều kiện, các bước, kết quả mong đợi, thư mục, chủ sở hữu. */
export function TestCaseEditorModal({
  open,
  projectId,
  testCase,
  folders,
  onClose,
}: {
  open: boolean;
  projectId: string;
  testCase?: TestCaseDto | null;
  folders: string[];
  onClose: () => void;
}) {
  const create = useCreateTestCase(projectId);
  const update = useUpdateTestCase(projectId);
  const people = useAssigneeOptions(projectId);
  const editing = !!testCase;

  const [title, setTitle] = useState('');
  const [precondition, setPrecondition] = useState('');
  const [steps, setSteps] = useState('');
  const [expected, setExpected] = useState('');
  const [folder, setFolder] = useState('');
  const [ownerId, setOwnerId] = useState('');

  useEffect(() => {
    if (!open) return;
    setTitle(testCase?.title ?? '');
    setPrecondition(testCase?.precondition ?? '');
    setSteps(testCase?.steps ?? '');
    setExpected(testCase?.expected ?? '');
    setFolder(testCase?.folder ?? '');
    setOwnerId(testCase?.owner?.id ?? '');
  }, [open, testCase]);

  const busy = create.isPending || update.isPending;
  const canSave = title.trim().length > 0 && !busy;

  async function save() {
    if (!canSave) return;
    const payload = {
      title: title.trim(),
      precondition: precondition.trim() || null,
      steps: steps.trim() || null,
      expected: expected.trim() || null,
      folder: folder.trim() || null,
      ownerId: ownerId || null,
    };
    try {
      if (editing && testCase) {
        await update.mutateAsync({ caseId: testCase.id, ...payload });
        toast.success(`Đã lưu ${testCase.key}`);
      } else {
        const created = await create.mutateAsync(payload);
        toast.success(`Đã tạo ${created.key}`);
      }
      onClose();
    } catch (e) {
      toast.error(apiErrorMessage(e));
    }
  }

  return (
    <ModalShell
      open={open}
      size="lg"
      title={editing ? `Sửa ca kiểm thử ${testCase?.key ?? ''}` : 'Tạo ca kiểm thử'}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Hủy</Button>
          <Button onClick={() => void save()} loading={busy} disabled={!canSave}>
            {editing ? 'Lưu' : 'Tạo ca kiểm thử'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Tiêu đề" htmlFor="tc-title">
          <Input
            id="tc-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="VD: Đăng nhập bằng email và mật khẩu hợp lệ"
            autoFocus
            maxLength={255}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Thư mục" hint="(tùy chọn)" htmlFor="tc-folder">
            <Input
              id="tc-folder"
              list="tc-folder-options"
              value={folder}
              onChange={(e) => setFolder(e.target.value)}
              placeholder="VD: Đăng nhập, Thanh toán…"
              maxLength={120}
            />
            <datalist id="tc-folder-options">
              {folders.map((f) => (
                <option key={f} value={f} />
              ))}
            </datalist>
          </Field>

          <Field label="Chủ sở hữu" hint="(tùy chọn)">
            <PeoplePicker
              value={ownerId}
              onChange={setOwnerId}
              options={people}
              emptyLabel="Chưa gán"
              ariaLabel="Chủ sở hữu ca kiểm thử"
            />
          </Field>
        </div>

        <Field label="Tiền điều kiện" hint="(tùy chọn)" htmlFor="tc-pre">
          <textarea
            id="tc-pre"
            value={precondition}
            onChange={(e) => setPrecondition(e.target.value)}
            rows={2}
            maxLength={5000}
            placeholder="VD: Đã có tài khoản kích hoạt, đang ở trang đăng nhập."
            className={textareaClass}
          />
        </Field>

        <Field label="Các bước thực hiện" hint="(mỗi bước một dòng)" htmlFor="tc-steps">
          <textarea
            id="tc-steps"
            value={steps}
            onChange={(e) => setSteps(e.target.value)}
            rows={5}
            maxLength={20000}
            placeholder={'1. Mở trang đăng nhập\n2. Nhập email và mật khẩu\n3. Bấm Đăng nhập'}
            className={textareaClass}
          />
        </Field>

        <Field label="Kết quả mong đợi" htmlFor="tc-expected">
          <textarea
            id="tc-expected"
            value={expected}
            onChange={(e) => setExpected(e.target.value)}
            rows={3}
            maxLength={20000}
            placeholder="VD: Vào được trang chủ, hiển thị tên người dùng ở góc phải."
            className={textareaClass}
          />
        </Field>
      </div>
    </ModalShell>
  );
}

/** Modal gắn/gỡ issue cho một ca kiểm thử (traceability yêu cầu ↔ kiểm thử). */
export function LinkIssuesModal({
  open,
  projectId,
  testCase,
  onClose,
}: {
  open: boolean;
  projectId: string;
  testCase: TestCaseDto | null;
  onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const search = useDebounced(q.trim());
  const { data: issues, isLoading } = useProjectIssueSearch(open && testCase ? projectId : undefined, search);
  const link = useLinkTestCaseIssues(projectId);
  const unlink = useUnlinkTestCaseIssues(projectId);

  useEffect(() => {
    if (!open) setQ('');
  }, [open]);

  const linkedIds = useMemo(() => new Set((testCase?.issues ?? []).map((i) => i.id)), [testCase]);

  async function toggle(issueId: string) {
    if (!testCase) return;
    try {
      if (linkedIds.has(issueId)) await unlink.mutateAsync({ caseId: testCase.id, issueIds: [issueId] });
      else await link.mutateAsync({ caseId: testCase.id, issueIds: [issueId] });
    } catch (e) {
      toast.error(apiErrorMessage(e));
    }
  }

  return (
    <ModalShell
      open={open && !!testCase}
      title={`Issue liên kết · ${testCase?.key ?? ''}`}
      onClose={onClose}
      footer={<Button variant="secondary" onClick={onClose}>Xong</Button>}
    >
      <div className="space-y-4">
        {testCase && testCase.issues.length > 0 && (
          <div>
            <p className="mb-1.5 text-sm font-medium text-muted">Đã liên kết ({testCase.issues.length})</p>
            <ul className="flex flex-wrap gap-1.5">
              {testCase.issues.map((i) => (
                <li key={i.id}>
                  <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-2 py-1 pl-2 pr-1 text-sm">
                    <span className="font-mono text-xs text-muted">{i.key}</span>
                    <span className="max-w-[16rem] truncate text-ink">{i.summary}</span>
                    <button
                      type="button"
                      onClick={() => void toggle(i.id)}
                      aria-label={`Gỡ liên kết ${i.key}`}
                      className="rounded p-0.5 text-faint transition-colors hover:bg-surface-3 hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div>
          <label htmlFor="tc-issue-q" className="mb-1.5 block text-sm font-medium text-muted">Tìm issue trong dự án</label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" aria-hidden />
            <Input
              id="tc-issue-q"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Nhập tiêu đề issue…"
              className="pl-8"
              autoFocus
            />
          </div>
        </div>

        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-9 w-full" />)}
          </div>
        ) : !issues || issues.length === 0 ? (
          <EmptyState title="Không tìm thấy issue" description="Thử từ khóa khác hoặc tạo issue trước khi liên kết." />
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {issues.map((i) => {
              const linked = linkedIds.has(i.id);
              return (
                <li key={i.id}>
                  <button
                    type="button"
                    onClick={() => void toggle(i.id)}
                    className={cn(
                      'flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-surface-2',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--ring)]',
                    )}
                  >
                    <span className="font-mono text-xs text-muted">{i.key}</span>
                    <span className="min-w-0 flex-1 truncate text-ink">{i.summary}</span>
                    <span className={cn('inline-flex items-center gap-1 text-xs', linked ? 'text-primary' : 'text-faint')}>
                      {linked ? <><Link2 className="h-3.5 w-3.5" /> Đã gắn</> : <><Plus className="h-3.5 w-3.5" /> Gắn</>}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </ModalShell>
  );
}
