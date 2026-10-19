import { useState } from 'react';
import {
  CalendarClock,
  Play,
  Trash2,
  Plus,
  Pencil,
  ChevronDown,
  ChevronRight,
  Mail,
  Send,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { useConfirm } from '@/components/ui/useConfirm';
import { Badge, EmptyState, Skeleton } from '@/components/ui/primitives';
import { apiErrorMessage } from '@/lib/api';
import { useAuth } from '@/stores/auth';
import { ReadOnlyNote } from '@/components/ui/NoAccess';
import { cn } from '@/lib/utils';
import { SWITCH_TOUCH_HIT } from '@/lib/touchHit';
import { useDigests, useUpdateDigest, useDeleteDigest, useRunDigest, type Digest } from './api';
import { DigestEditorDialog } from './DigestEditorDialog';
import { describeSchedule } from './schedule';
import { QueryBoundary } from '@/components/ui/QueryBoundary';
import { fmtRelative } from '@/lib/dateFormat';

function truncate(text: string, max = 140): string {
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
}

/** Hộp thoại tạo/sửa: `nonce` đổi mỗi lần mở để form khởi tạo lại; đóng chỉ hạ `open` (giữ nội dung cho hiệu ứng đóng). */
interface EditorState {
  open: boolean;
  digest: Digest | null;
  nonce: number;
}

/* ------------------------------------------------------------------ */
/* Section                                                            */
/* ------------------------------------------------------------------ */

export function DigestsSection() {
  const confirm = useConfirm();
  const digestsQuery = useDigests();
  const { data } = digestsQuery;
  const remove = useDeleteDigest();
  // Ghi digest (tạo/sửa/xoá/chạy) cần `integration:manage`; người không có quyền chỉ xem.
  const canManage = useAuth((s) => s.can('integration:manage'));
  const [editor, setEditor] = useState<EditorState>({ open: false, digest: null, nonce: 0 });

  const digests = data ?? [];
  const openEditor = (digest: Digest | null) =>
    setEditor((e) => ({ open: true, digest, nonce: e.nonce + 1 }));

  async function handleDelete(digest: Digest) {
    if (
      !(await confirm({
        title: `Xoá báo cáo "${digest.name}"? Hành động này không thể hoàn tác.`,
        destructive: true,
      }))
    )
      return;
    remove.mutate(digest.id, {
      onSuccess: () => toast.success('Đã xoá báo cáo.'),
      onError: (e) => toast.error(apiErrorMessage(e)),
    });
  }

  return (
    <section className="rounded-lg border border-border bg-surface">
      {/* Mobile (<sm): biểu tượng + tiêu đề/mô tả một hàng, nút "Tạo" xuống hàng dưới full-width (không ép chữ thành cột hẹp). */}
      <div className="flex flex-wrap items-start gap-3 border-b border-border px-5 py-4 sm:flex-nowrap">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary-subtle text-primary">
          <CalendarClock className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold text-ink-strong">Báo cáo định kỳ</h2>
          <p className="mt-0.5 text-sm text-muted">
            Tổng hợp tiến độ dự án theo lịch rồi gửi qua Telegram và/hoặc email.
          </p>
        </div>
        {canManage && digests.length > 0 && (
          <Button size="sm" className="shrink-0 max-sm:w-full" onClick={() => openEditor(null)}>
            <Plus className="h-4 w-4" />
            Tạo báo cáo định kỳ
          </Button>
        )}
      </div>

      <div className="p-5">
        {!canManage && <ReadOnlyNote />}
        <QueryBoundary
          query={digestsQuery}
          skeleton={
            <div className="space-y-2">
              {Array.from({ length: 2 }).map((_, i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          }
          empty={() => digests.length === 0}
          emptyState={
            <EmptyState
              icon={<CalendarClock className="h-6 w-6" />}
              title="Chưa có báo cáo định kỳ nào"
              description={
                canManage
                  ? 'Tạo báo cáo để tự động tổng hợp tiến độ dự án theo lịch.'
                  : 'Chưa có báo cáo định kỳ nào. Nhờ quản trị chung tạo giúp.'
              }
              action={
                canManage ? (
                  <Button size="sm" onClick={() => openEditor(null)}>
                    <Plus className="h-4 w-4" />
                    Tạo báo cáo định kỳ
                  </Button>
                ) : undefined
              }
            />
          }
        >
          {() => (
            <ul className="space-y-2.5">
              {digests.map((digest) => (
                <DigestRow
                  key={digest.id}
                  digest={digest}
                  canManage={canManage}
                  onEdit={() => openEditor(digest)}
                  onDelete={() => handleDelete(digest)}
                  deleting={remove.isPending}
                />
              ))}
            </ul>
          )}
        </QueryBoundary>
      </div>

      <DigestEditorDialog
        key={editor.nonce}
        open={editor.open}
        onOpenChange={(open) => setEditor((e) => ({ ...e, open }))}
        digest={editor.digest}
      />
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Hàng digest                                                        */
/* ------------------------------------------------------------------ */

function DigestRow({
  digest,
  canManage,
  onEdit,
  onDelete,
  deleting,
}: {
  digest: Digest;
  canManage: boolean;
  onEdit: () => void;
  onDelete: () => void;
  deleting: boolean;
}) {
  const update = useUpdateDigest();
  const run = useRunDigest();
  const confirm = useConfirm();

  const [summary, setSummary] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  function handleToggle() {
    update.mutate(
      { id: digest.id, isEnabled: !digest.isEnabled },
      {
        onSuccess: () =>
          toast.success(digest.isEnabled ? 'Đã tạm dừng báo cáo.' : 'Đã bật báo cáo.'),
        onError: (e) => toast.error(apiErrorMessage(e)),
      },
    );
  }

  async function handleRun() {
    // Có email: "Chạy ngay" xếp thư THẬT cho từng người nhận → xác nhận trước (server còn giới hạn ≥ 1 phút/lần).
    if (
      digest.deliverEmail &&
      !(await confirm({
        title: `Gửi ngay "${digest.name}" tới ${digest.recipients.length} người nhận qua email?`,
        description: 'Mỗi người nhận một thư thật, kể cả khi họ đã tắt email thông báo.',
        confirmLabel: 'Gửi ngay',
      }))
    )
      return;
    run.mutate(digest.id, {
      onSuccess: (res) => {
        // Backend trả văn bản thuần (escape HTML chỉ ở kênh Telegram) — không cần xử lý thẻ/entity ở đây.
        const text = (res.summaryText ?? '').trim();
        setSummary(text);
        setExpanded(true);
        if (res.skippedRecipients?.length) {
          toast.warning(
            `Không gửi email cho ${res.skippedRecipients.join(', ')} vì họ không thấy dự án của báo cáo này.`,
          );
        }
        if (res.channelSkipped) {
          toast.warning(
            'Dự án riêng tư chưa được phép đăng vào nhóm Telegram nên không gửi vào nhóm — bật "Cho phép đăng vào nhóm Telegram" khi sửa báo cáo nếu muốn.',
          );
        }
        if (res.sent) {
          toast.success(text ? truncate(text) : 'Đã gửi báo cáo.');
        } else if (!res.channelSkipped) {
          toast.info(text ? truncate(text) : 'Đã tạo bản tổng hợp nhưng chưa gửi (chưa có kênh).');
        }
      },
      onError: (e) => toast.error(apiErrorMessage(e)),
    });
  }

  const lastRunLabel = digest.lastRunAt ? fmtRelative(digest.lastRunAt) : 'Chưa chạy lần nào';

  return (
    <li className="rounded-md border border-border">
      {/* Mobile (<sm): tên + lịch chiếm trọn dòng trên (được xuống dòng), công tắc + hành động ở dòng dưới. */}
      <div className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center sm:gap-3">
        <div className="min-w-0 sm:flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <span className="break-words text-sm font-medium text-ink sm:truncate">
              {digest.name}
            </span>
            {!digest.isEnabled && <Badge className="bg-surface-2 text-faint">Tạm dừng</Badge>}
            {digest.channelId && (
              <Badge className="bg-surface-2 text-muted">
                <Send className="h-3 w-3" aria-hidden />
                Telegram
              </Badge>
            )}
            {digest.deliverEmail && (
              <Badge className="bg-surface-2 text-muted">
                <Mail className="h-3 w-3" aria-hidden />
                Email · {digest.recipients.length} người
              </Badge>
            )}
          </div>
          <p className="mt-0.5 text-xs text-muted sm:truncate">
            {describeSchedule(digest)}
            <span className="hidden text-faint sm:inline"> · {lastRunLabel}</span>
          </p>
        </div>

        {canManage && (
          <div className="flex shrink-0 flex-wrap items-center gap-1">
            {/* Bật / tắt báo cáo */}
            <button
              type="button"
              role="switch"
              aria-checked={digest.isEnabled}
              aria-label={digest.isEnabled ? 'Tắt báo cáo' : 'Bật báo cáo'}
              onClick={handleToggle}
              disabled={update.isPending}
              title={digest.isEnabled ? 'Đang bật — bấm để tạm dừng' : 'Đang tạm dừng — bấm để bật'}
              className={cn(
                SWITCH_TOUCH_HIT,
                // Giữ disabled:opacity (không dùng token vô hiệu) — công tắc: trạng thái bật/tắt phải còn đọc được khi vô hiệu.
                'inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] disabled:opacity-50',
                digest.isEnabled ? 'bg-primary' : 'bg-surface-3',
              )}
            >
              <span
                className={cn(
                  'inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-150',
                  digest.isEnabled ? 'translate-x-[1.125rem]' : 'translate-x-0.5',
                )}
              />
            </button>

            <Button
              variant="ghost"
              size="sm"
              onClick={handleRun}
              loading={run.isPending}
              title="Chạy báo cáo ngay và xem bản tổng hợp"
            >
              <Play className="h-4 w-4" />
              Chạy ngay
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={onEdit}
              className="text-muted hover:text-ink"
              title="Sửa báo cáo"
            >
              <Pencil className="h-4 w-4" />
              <span className="sr-only">Sửa {digest.name}</span>
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={onDelete}
              disabled={deleting}
              className="text-muted hover:text-danger"
              title="Xoá báo cáo"
            >
              <Trash2 className="h-4 w-4" />
              <span className="sr-only">Xoá {digest.name}</span>
            </Button>
          </div>
        )}
      </div>

      {/* lastRunAt cho màn hình hẹp */}
      <p className="px-3 pb-2 text-xs text-faint sm:hidden">{lastRunLabel}</p>

      {/* Bản tổng hợp sau khi chạy */}
      {summary !== null && (
        <div className="border-t border-border bg-surface-2 px-3 py-2.5">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="flex items-center gap-1.5 rounded-sm text-xs font-medium text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
            aria-expanded={expanded}
          >
            {expanded ? (
              <ChevronDown className="h-3.5 w-3.5 text-faint" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 text-faint" />
            )}
            Bản tổng hợp
          </button>
          {expanded && (
            <pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-surface p-3 font-mono text-xs text-ink">
              {summary || 'Không có nội dung tổng hợp.'}
            </pre>
          )}
        </div>
      )}
    </li>
  );
}
