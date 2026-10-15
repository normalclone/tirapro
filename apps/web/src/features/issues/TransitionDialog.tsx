import { useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { CheckCircle2, RotateCcw, Undo2 } from 'lucide-react';
import { Dialog } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';
import { appendReason, type TransitionKind } from './transitionKind';

export type DialogTransitionKind = Exclude<TransitionKind, 'forward'>;

interface TransitionDialogResolution {
  id: string;
  name: string;
  description: string | null;
}

interface TransitionConfirm {
  /** Chỉ có khi `kind='close'`. */
  resolutionId?: string;
  comment?: string;
}

interface Props {
  open: boolean;
  kind: DialogTransitionKind;
  issueKey: string;
  fromName: string;
  toName: string;
  /** Tên hành động của transition (vd "Hoàn thành", "Mở lại") — dùng làm nhãn nút xác nhận. */
  toLabel: string;
  resolutions: TransitionDialogResolution[];
  defaultResolutionId: string | null;
  loading?: boolean;
  onConfirm: (v: TransitionConfirm) => void;
  onCancel: () => void;
}

const REASON_CHIPS = ['Chưa sửa được', 'Thiếu thông tin', 'Phát sinh lỗi mới'];

/**
 * Hỏi thêm khi chuyển trạng thái đáng chú ý: vào Done → Cách giải quyết (chọn sẵn mặc định) + ghi chú;
 * Mở lại / Trả lại → ô lý do (tuỳ chọn, thành bình luận). Mọi ô đều tuỳ chọn để giữ tốc độ "1 phím + Enter".
 * Enter (khi con trỏ không ở ô nhập) = Xác nhận; Cmd/Ctrl+Enter ở ô nhập = Xác nhận; Esc = Huỷ.
 */
export function TransitionDialog({
  open,
  kind,
  issueKey,
  fromName,
  toName,
  toLabel,
  resolutions,
  defaultResolutionId,
  loading,
  onConfirm,
  onCancel,
}: Props) {
  const isClose = kind === 'close';
  const [resolutionId, setResolutionId] = useState<string | null>(defaultResolutionId);
  const [comment, setComment] = useState('');
  const body = useRef<HTMLDivElement>(null);

  const confirm = () => {
    if (loading) return;
    const text = comment.trim();
    onConfirm({
      ...(isClose && resolutionId ? { resolutionId } : {}),
      ...(text ? { comment: text } : {}),
    });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Enter' || e.shiftKey || e.metaKey || e.ctrlKey || e.defaultPrevented) return;
    const el = e.target as HTMLElement;
    if (el.tagName === 'BUTTON') return; // Enter trên nút (chip, Huỷ…) = bấm nút đó
    // Ô ghi chú: Enter xuống dòng; riêng ô còn TRỐNG thì Enter = xác nhận (không có chữ nào để mất).
    if (el.tagName === 'TEXTAREA' && comment.trim()) return;
    e.preventDefault();
    confirm();
  };

  const title = isClose
    ? `Hoàn thành ${issueKey}`
    : kind === 'reopen'
      ? `Mở lại ${issueKey}`
      : `Trả lại ${issueKey}`;
  const Icon = isClose ? CheckCircle2 : kind === 'reopen' ? RotateCcw : Undo2;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onCancel()}
      title={title}
      description={`${fromName} → ${toName}`}
      icon={<Icon className="h-4 w-4" />}
      size="sm"
      onSubmit={confirm}
      // Đưa con trỏ vào đúng chỗ để Enter chạy ngay: mức đang chọn (Done) / ô lý do.
      onOpenAutoFocus={(e) => {
        e.preventDefault();
        const root = body.current;
        const target = isClose
          ? root?.querySelector<HTMLElement>('input[type="radio"]:checked')
          : root?.querySelector<HTMLElement>('textarea');
        (target ?? root?.querySelector<HTMLElement>('textarea'))?.focus({ preventScroll: true });
      }}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Huỷ
          </Button>
          <Button size="sm" onClick={confirm} loading={loading}>
            {toLabel}
          </Button>
        </>
      }
    >
      <div ref={body} onKeyDown={onKeyDown} className="flex flex-col gap-3">
        {isClose && resolutions.length > 0 && (
          <fieldset>
            <legend className="mb-1.5 text-sm font-medium text-ink">Cách giải quyết</legend>
            <div className="flex flex-col gap-1.5">
              {resolutions.map((r) => (
                <label
                  key={r.id}
                  className={cn(
                    'flex cursor-pointer items-start gap-2.5 rounded-md border px-2.5 py-1.5 transition-colors',
                    resolutionId === r.id
                      ? 'border-primary bg-primary-subtle'
                      : 'border-border hover:bg-surface-2',
                  )}
                >
                  <input
                    type="radio"
                    name="transition-resolution"
                    className="mt-0.5 accent-[var(--primary)]"
                    checked={resolutionId === r.id}
                    onChange={() => setResolutionId(r.id)}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm text-ink">{r.name}</span>
                    {r.description && (
                      <span className="block text-xs text-muted">{r.description}</span>
                    )}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        )}
        <div>
          <label htmlFor="transition-comment" className="mb-1.5 block text-sm font-medium text-ink">
            {isClose ? 'Ghi chú (tuỳ chọn)' : 'Lý do (tuỳ chọn)'}
          </label>
          <textarea
            id="transition-comment"
            value={comment}
            maxLength={5000}
            rows={3}
            onChange={(e) => setComment(e.target.value)}
            placeholder={
              isClose ? 'Ghi chú sẽ được lưu thành bình luận' : 'Lý do sẽ được lưu thành bình luận'
            }
            className="w-full resize-y rounded-md border border-border bg-bg px-3 py-2 text-base text-ink placeholder:text-faint focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
          />
          {!isClose && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {REASON_CHIPS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setComment((cur) => appendReason(cur, c))}
                  className="rounded-full border border-border bg-surface px-2.5 py-1 text-xs text-ink transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                >
                  {c}
                </button>
              ))}
            </div>
          )}
          <p className="mt-1.5 text-xs text-faint">
            Enter xác nhận · Cmd/Ctrl+Enter khi đang gõ · Esc huỷ
          </p>
        </div>
      </div>
    </Dialog>
  );
}
