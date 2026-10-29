import { useRef } from 'react';
import { Link } from 'react-router-dom';
import { Check, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { useCreateIssue } from '@/features/issues/create-api';
import { fmtDate } from '@/lib/dateFormat';
import { apiErrorMessage } from '@/lib/api';
import { useCreateIssueModal } from '@/stores/createIssue';
import { useAssistantPanel } from './panelStore';
import type { Block } from './blocks';
import type { Draft } from './draft';
import { confirmDraft } from './respond';
import type { ConversationAction } from './conversation';

/** Chặn bấm Tạo lặp: chỉ khi thẻ chưa đang tạo/đã tạo/đã bỏ. */
export const canStartCreate = (status: DraftBlock['status']): boolean =>
  status === 'pending' || status === 'failed';

type DraftBlock = Extract<Block, { type: 'draft' }>;

const rowsOf = (d: Draft): [string, string][] =>
  [
    ['Dự án', `${d.projectName} (${d.projectKey})`],
    ['Loại', d.typeName],
    ['Tiêu đề', d.summary],
    ['Ưu tiên', d.priority?.name ?? 'Mặc định của dự án'],
    ['Người phụ trách', d.assignee?.name ?? 'Chưa gán'],
    ['Sprint', d.sprint?.name ?? 'Việc chờ (chưa vào sprint)'],
    ['Điểm', d.points != null ? String(d.points) : '—'],
    ['Hạn', d.due ? fmtDate(d.due) : 'Chưa đặt'],
  ] as [string, string][];

/**
 * Thẻ NHÁP tạo việc (thuần hiển thị). Việc chỉ được tạo khi bấm "Tạo" (`onCreate`); mọi dữ liệu hiện dạng TEXT.
 * Có sẵn "Mở form đầy đủ" (hộp tạo việc điền sẵn) và "Bỏ".
 */
export function DraftCardView({
  block,
  onCreate,
  onOpenForm,
  onCancel,
  onNavigate,
}: {
  block: DraftBlock;
  onCreate: () => void;
  onOpenForm: () => void;
  onCancel: () => void;
  onNavigate?: () => void;
}) {
  const { draft, status } = block;
  const open = status === 'pending' || status === 'failed' || status === 'creating';
  return (
    <section
      aria-label="Nháp công việc"
      className="rounded-lg border border-border bg-surface px-3.5 py-3"
    >
      <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-sm">
        {rowsOf(draft).map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted">{k}</dt>
            <dd className="min-w-0 break-words text-ink-strong">{v}</dd>
          </div>
        ))}
      </dl>
      {draft.typeNote && (
        <p className="mt-2 flex gap-1.5 text-[13px] text-muted">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" aria-hidden />
          {draft.typeNote}
        </p>
      )}
      {draft.unmatched.length > 0 && (
        <p className="mt-2 flex gap-1.5 text-[13px] text-warning">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>
            Không nhận ra: <span className="font-mono">{draft.unmatched.join(' ')}</span> — vẫn nằm
            trong tiêu đề; {draft.unmatchedHint}.
          </span>
        </p>
      )}
      {status === 'failed' && block.error && (
        <p role="alert" className="mt-2 text-[13px] text-danger">
          Chưa tạo được: {block.error}
        </p>
      )}
      {status === 'created' && (
        <p className="mt-3 flex items-center gap-1.5 text-sm text-success">
          <Check className="h-4 w-4" aria-hidden />
          Đã tạo{' '}
          {block.createdKey ? (
            <Link
              to={`/issue/${block.createdKey}`}
              onClick={onNavigate}
              className="font-mono font-medium underline underline-offset-2"
            >
              {block.createdKey}
            </Link>
          ) : null}
        </p>
      )}
      {status === 'cancelled' && <p className="mt-3 text-sm text-muted">Đã bỏ nháp này.</p>}
      {status === 'opened' && (
        <p className="mt-3 text-sm text-muted">Đã mở trong form đầy đủ — hoàn tất ở đó.</p>
      )}
      {open && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            size="sm"
            onClick={onCreate}
            loading={status === 'creating'}
            disabled={status === 'creating'}
          >
            {status === 'failed' ? 'Tạo lại' : 'Tạo'}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={onOpenForm}
            disabled={status === 'creating'}
          >
            Mở form đầy đủ
          </Button>
          <Button size="sm" variant="ghost" onClick={onCancel} disabled={status === 'creating'}>
            Bỏ
          </Button>
        </div>
      )}
    </section>
  );
}

/**
 * Thẻ nháp trong hội thoại. `useCreateIssue(draft.projectId)` là mutation tạo việc CÓ SẴN của hộp tạo việc/thêm nhanh
 * (invalidate board + sprint của dự án) — mỗi thẻ một hook nên đúng dự án của nháp.
 */
export function DraftCard({
  messageId,
  block,
  patch,
  onClose,
}: {
  messageId: string;
  block: DraftBlock;
  patch: (a: Extract<ConversationAction, { type: 'patch-draft' }>) => void;
  onClose: () => void;
}) {
  const create = useCreateIssue(block.draft.projectId);
  const openCreate = useCreateIssueModal((s) => s.openCreate);
  const { draft } = block;
  const inFlight = useRef(false);

  async function onCreate() {
    // Ref chặn bấm đúp trước khi React kịp vẽ lại trạng thái "creating".
    if (inFlight.current || !canStartCreate(block.status)) return;
    inFlight.current = true;
    patch({ type: 'patch-draft', messageId, status: 'creating' });
    const r = await confirmDraft(
      draft,
      (input) => create.mutateAsync(input).then((i) => ({ id: i.id, key: i.key })),
      apiErrorMessage,
    );
    inFlight.current = false;
    if (r.ok) {
      patch({ type: 'patch-draft', messageId, status: 'created', createdKey: r.key });
      // Cửa sổ chat đang mở thì thẻ đã báo "Đã tạo" ngay trong luồng; toast chỉ khi ô chat thu nhỏ/đóng (không đè ô nhập).
      const ui = useAssistantPanel.getState();
      if (!ui.open || ui.minimized) toast.success(`Đã tạo ${r.key}`);
    } else {
      patch({ type: 'patch-draft', messageId, status: 'failed', error: r.error });
    }
  }

  return (
    <DraftCardView
      block={block}
      onCreate={() => void onCreate()}
      onOpenForm={() => {
        openCreate({ projectKey: draft.projectKey, summary: draft.rawText, typeId: draft.typeId });
        patch({ type: 'patch-draft', messageId, status: 'opened' });
        onClose();
      }}
      onCancel={() => patch({ type: 'patch-draft', messageId, status: 'cancelled' })}
      onNavigate={onClose}
    />
  );
}
