import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { formatRemaining } from '@/features/integrations/telegramWizard';
import { ErrorText } from '@/features/integrations/TelegramWizardDialog';
import { apiErrorMessage } from '@/lib/api';
import { type LinkPhase, type LinkSession } from './telegramLink';

/**
 * Phiên liên kết: xin mã (một lần khi gọi `issue`), giữ mã + thời điểm bắt đầu hỏi. `mutateAsync` (không phải callback của
 * `mutate`) nên vẫn chạy khi StrictMode tháo/gắn lại observer. `clear` đóng phiên (huỷ / đã xong).
 */
export function useLinkSession<T extends { expiresAt: string }>(create: () => Promise<T>) {
  const [session, setSession] = useState<LinkSession<T> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const issue = useCallback(() => {
    setSession(null);
    setError(null);
    setCreating(true);
    create().then(
      (code) => {
        if (!alive.current) return;
        setCreating(false);
        setSession({ code, startedAt: Date.now() });
      },
      (e: unknown) => {
        if (!alive.current) return;
        setCreating(false);
        setError(apiErrorMessage(e));
      },
    );
  }, [create]);
  /** Bắt đầu lại lịch hỏi (mã vẫn là mã cũ) — nút "Kiểm tra lại". */
  const restart = useCallback(() => {
    setSession((s) => (s ? { ...s, startedAt: Date.now() } : s));
  }, []);
  const clear = useCallback(() => {
    setSession(null);
    setError(null);
    setCreating(false);
  }, []);
  return { session, error, creating, issue, restart, clear };
}

/** Dòng trạng thái khi chờ người dùng gõ mã (aria-live): chờ / tạm dừng / hết hạn / lỗi / xong. */
export function LinkWaiting({
  phase,
  remainingMs,
  hint,
  errorHint,
  waitingText,
  doneText,
  onRetry,
  onNewCode,
}: {
  phase: LinkPhase;
  remainingMs: number;
  /** Gợi ý tạm thời từ máy chủ khi đang chờ (vd chưa kết nối được Telegram). */
  hint?: string;
  errorHint?: string;
  waitingText: string;
  doneText: string;
  /** Hỏi lại ngay (khi đã hết lịch hỏi tự động mà mã còn hạn). */
  onRetry: () => void;
  onNewCode: () => void;
}) {
  return (
    <div aria-live="polite" className="text-sm">
      {phase === 'creating' && (
        <p role="status" className="flex items-center gap-2 text-muted">
          <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden /> Đang
          tạo mã…
        </p>
      )}
      {phase === 'waiting' && (
        <>
          <p className="flex items-center gap-2 text-muted">
            <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />
            {waitingText} (còn {formatRemaining(remainingMs)})
          </p>
          {hint && <p className="mt-1 text-warning-ink">{hint}</p>}
        </>
      )}
      {phase === 'paused' && (
        <p className="flex flex-wrap items-center gap-2 text-muted">
          Vẫn chưa thấy tin nhắn (mã còn {formatRemaining(remainingMs)}).
          <Button type="button" variant="secondary" size="sm" onClick={onRetry}>
            Kiểm tra lại
          </Button>
        </p>
      )}
      {phase === 'expired' && (
        <p className="flex flex-wrap items-center gap-2 text-warning-ink">
          Mã đã hết hạn.
          <Button type="button" variant="secondary" size="sm" onClick={onNewCode}>
            Tạo mã mới
          </Button>
        </p>
      )}
      {phase === 'error' && (
        <div className="space-y-2">
          <ErrorText>{errorHint}</ErrorText>
          <Button type="button" variant="secondary" size="sm" onClick={onNewCode}>
            Thử lại với mã mới
          </Button>
        </div>
      )}
      {phase === 'linked' && (
        <p className="flex items-center gap-1.5 font-medium text-success">
          <CheckCircle2 className="h-4 w-4" aria-hidden />
          {doneText}
        </p>
      )}
    </div>
  );
}
