import { useEffect, useRef, useState } from 'react';
import { UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog } from '@/components/ui/Dialog';
import { Input } from '@/components/ui/Input';
import { Avatar } from '@/components/ui/primitives';
import { useAssigneeOptions } from '@/features/issue-edit/useAssigneeOptions';
import { useIssue, useUpdateIssue } from '@/features/issues/api';
import { useCanEditIssue, useCanIn, useProjectPermissions } from '@/features/projects/permissions';
import { apiErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { ASSIGN_REQUEST_EVENT, type AssignRequestDetail } from './events';

/** Cùng câu chữ với `BoardPage` khi thả thẻ sang hàng người khác mà không được đổi người phụ trách. */
export const ASSIGN_DENIED_NOTICE = 'Bạn không có quyền đổi người phụ trách việc này.';

type Phase = 'idle' | 'checking' | 'open';

/**
 * Hộp chọn người phụ trách mở bằng phím `a` (sự kiện `tirapro:assign`, xem `requestAssign`): gõ để lọc, ↑/↓ chọn, Enter gán.
 * Quyền kiểm TRƯỚC khi mở (`AssignGate`): không đủ quyền → chỉ hiện thông báo, không bật hộp.
 * Mount một lần ở khung ứng dụng; danh sách người chỉ tải khi hộp thật sự mở.
 */
export function QuickAssignDialog() {
  const [issueKey, setIssueKey] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  // Dòng/thẻ đang focus lúc bấm `a` → trả focus về đó khi đóng (không có nút mở để Radix tự trả).
  const returnFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    function onRequest(e: Event) {
      const key = (e as CustomEvent<AssignRequestDetail>).detail?.issueKey;
      if (!key) return;
      returnFocus.current = document.activeElement as HTMLElement | null;
      setIssueKey(key);
      setPhase('checking');
    }
    window.addEventListener(ASSIGN_REQUEST_EVENT, onRequest);
    return () => window.removeEventListener(ASSIGN_REQUEST_EVENT, onRequest);
  }, []);

  return (
    <>
      {phase === 'checking' && issueKey && (
        <AssignGate
          key={issueKey}
          issueKey={issueKey}
          onReady={() => setPhase('open')}
          onDeny={(msg) => {
            toast.info(msg);
            setPhase('idle');
          }}
        />
      )}
      <Dialog
        open={phase === 'open'}
        onOpenChange={(o) => {
          if (!o) setPhase('idle');
        }}
        title={issueKey ? `Gán người phụ trách cho ${issueKey}` : 'Gán người phụ trách'}
        icon={<UserPlus className="h-4 w-4" />}
        size="sm"
        onCloseAutoFocus={(e) => {
          const el = returnFocus.current;
          if (el?.isConnected) {
            e.preventDefault();
            el.focus({ preventScroll: true });
          }
        }}
      >
        {issueKey && <AssignBody issueKey={issueKey} onClose={() => setPhase('idle')} />}
      </Dialog>
    </>
  );
}

/** Không dựng gì: chờ công việc + quyền của dự án chứa nó tải xong rồi báo `onReady` hoặc `onDeny` đúng một lần. */
function AssignGate({
  issueKey,
  onReady,
  onDeny,
}: {
  issueKey: string;
  onReady: () => void;
  onDeny: (message: string) => void;
}) {
  const { data: issue, isError } = useIssue(issueKey);
  const perms = useProjectPermissions(issue?.projectId);
  const canAssign = useCanIn(issue?.projectId)('issue:assign');
  const canEdit = useCanEditIssue(issue?.projectId)(issue ?? {});
  const done = useRef(false);

  useEffect(() => {
    if (done.current) return;
    if (isError) {
      done.current = true;
      onDeny(
        `Không mở được ${issueKey} để gán người — công việc không còn hoặc bạn không xem được.`,
      );
      return;
    }
    if (!issue || !(perms.isSuccess || perms.isError)) return;
    done.current = true;
    if (canAssign && canEdit) onReady();
    else onDeny(ASSIGN_DENIED_NOTICE);
  }, [
    issue,
    isError,
    perms.isSuccess,
    perms.isError,
    canAssign,
    canEdit,
    issueKey,
    onReady,
    onDeny,
  ]);

  return null;
}

function AssignBody({ issueKey, onClose }: { issueKey: string; onClose: () => void }) {
  const { data: issue } = useIssue(issueKey);
  const options = useAssigneeOptions(issue?.projectId);
  const updateIssue = useUpdateIssue(issue?.projectId);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);

  const query = q.trim().toLowerCase();
  const filtered = query ? options.filter((o) => o.search.includes(query)) : options;
  // Mục đầu = "Chưa gán" (chỉ khi không lọc), rồi tới từng người.
  const rows = [
    ...(query === '' ? [{ id: '', name: 'Chưa gán', avatarUrl: null, position: '' }] : []),
    ...filtered,
  ];
  const current = issue?.assigneeId ?? '';
  const activeIdx = Math.min(active, Math.max(0, rows.length - 1));

  // Hộp đóng ngay khi chọn nên component này bị gỡ (observer của mutation mất) → callback của `mutate` không chạy.
  // Dùng mutateAsync + try/catch như `IssueContextGroup`: promise vẫn chạy tiếp nên toast vẫn hiện.
  async function pick(id: string, name: string) {
    if (!issue) return;
    onClose();
    if (id === current) return;
    try {
      await updateIssue.mutateAsync({
        id: issue.id,
        key: issue.key,
        patch: { assigneeId: id || null },
        version: issue.version,
      });
      toast.success(
        id ? `Đã giao ${issue.key} cho ${name}` : `Đã bỏ người phụ trách ${issue.key}`,
        {
          duration: 2000,
        },
      );
    } catch (e) {
      toast.error(apiErrorMessage(e));
    }
  }

  if (!issue) return <p className="py-6 text-center text-sm text-muted">Đang tải…</p>;

  return (
    <div className="-mx-1">
      <p className="mb-2 truncate px-1 text-sm text-muted" title={issue.summary}>
        {issue.summary}
      </p>
      <Input
        autoFocus
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setActive(0);
        }}
        placeholder="Tìm tên, vị trí, nhóm…"
        aria-label="Tìm người phụ trách"
        className="h-9 text-sm"
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            const d = e.key === 'ArrowDown' ? 1 : -1;
            setActive(Math.max(0, Math.min(rows.length - 1, activeIdx + d)));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            const row = rows[activeIdx];
            if (row) void pick(row.id, row.name);
          }
        }}
      />
      <ul
        className="mt-2 max-h-72 overflow-y-auto"
        role="listbox"
        aria-label="Người có thể phụ trách"
      >
        {rows.map((o, i) => (
          <li key={o.id || 'none'} role="presentation">
            <button
              type="button"
              role="option"
              aria-selected={o.id === current}
              tabIndex={-1}
              ref={(el) => {
                if (el && i === activeIdx) el.scrollIntoView({ block: 'nearest' });
              }}
              onClick={() => void pick(o.id, o.name)}
              onMouseMove={() => setActive(i)}
              className={cn(
                'flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors',
                i === activeIdx && 'bg-surface-2',
              )}
            >
              {o.id ? (
                <Avatar name={o.name} src={o.avatarUrl} size={26} />
              ) : (
                <span className="h-[26px] w-[26px] shrink-0" aria-hidden />
              )}
              <span className="min-w-0 flex-1">
                <span className={cn('block truncate text-sm', o.id ? 'text-ink' : 'text-muted')}>
                  {o.name}
                </span>
                {o.position && (
                  <span className="block truncate text-[11px] text-muted">{o.position}</span>
                )}
              </span>
              {o.id === current && (
                <span className="shrink-0 text-xs text-faint">Đang phụ trách</span>
              )}
            </button>
          </li>
        ))}
        {rows.length === 0 && (
          <li className="px-2 py-3 text-center text-sm text-muted">Không tìm thấy</li>
        )}
      </ul>
    </div>
  );
}
