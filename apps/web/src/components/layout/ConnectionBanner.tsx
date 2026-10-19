import { useEffect, useReducer } from 'react';
import { useMutationState } from '@tanstack/react-query';
import { CheckCircle2, WifiOff } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { deriveBanner, nextChangeIn, type BannerPhase } from '@/lib/connectionState';
import { useConnectionState } from '@/lib/socket';

/** Số mutation THẬT SỰ đang tạm dừng (TanStack `networkMode:'online'` chờ có mạng) — không đếm mutation đang chạy bình thường. */
function usePausedCount(): number {
  const paused = useMutationState({
    filters: { status: 'pending' },
    select: (m) => m.state.isPaused,
  });
  return paused.filter(Boolean).length;
}

const MESSAGE: Record<Exclude<BannerPhase, 'hidden'>, string> = {
  paused: 'Mất kết nối thời gian thực — đang thử lại… (thay đổi vẫn được lưu)',
  offline: 'Không có mạng — thay đổi sẽ được gửi khi có mạng lại. Giữ trang này mở.',
  restored: 'Đã kết nối lại',
  stopped: 'Mất kết nối thời gian thực — tải lại trang để thử lại',
};

/**
 * Phần trình bày thuần. Vùng `role="status"` (aria-live polite) LUÔN có trong DOM (ẩn khỏi mắt, `sr-only`) và chỉ chứa CÂU CHÍNH:
 * chữ chỉ đổi khi đổi pha → không đọc lại mỗi lần thử nối lại, cũng không đọc lại khi số "đang chờ gửi" đổi (số nằm ở chữ
 * `aria-hidden` của hộp nhìn thấy). Hộp nhìn thấy không phải vùng live nên nút "Tải lại" vẫn tiếp cận được bình thường.
 * - `paused`: WS đứt nhưng mạng còn → REST vẫn chạy, mọi thay đổi vẫn lưu; chỉ cập nhật tự động tạm dừng.
 * - `offline`: trình duyệt báo mất mạng → mutation mới tạm dừng và tự gửi khi có mạng (chỉ khi trang còn mở: không lưu bền).
 * - `stopped`: đã hết lượt nối lại tự động (hoặc phiên không làm mới được) → chữ ổn định + nút phụ "Tải lại".
 */
export function ConnectionBannerView({
  phase,
  pausedCount,
}: {
  phase: BannerPhase;
  pausedCount: number;
}) {
  const restored = phase === 'restored';
  return (
    <>
      <div role="status" aria-live="polite" className="sr-only">
        {phase !== 'hidden' && MESSAGE[phase]}
      </div>
      {phase !== 'hidden' && (
        <div
          className={
            restored
              ? 'flex items-start gap-2 border-b border-success/30 bg-success/10 px-4 py-2 text-sm text-ink'
              : 'flex items-start gap-2 border-b border-warning/30 bg-warning/10 px-4 py-2 text-sm text-ink'
          }
        >
          {restored ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden />
          ) : (
            <WifiOff className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
          )}
          <span className="min-w-0 flex-1" aria-hidden>
            {MESSAGE[phase]}
            {pausedCount > 0 && ` · ${pausedCount} thay đổi đang chờ gửi`}
          </span>
          {phase === 'stopped' && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="shrink-0"
              onClick={() => window.location.reload()}
            >
              Tải lại
            </Button>
          )}
        </div>
      )}
    </>
  );
}

/**
 * Banner trạng thái kết nối realtime (091), cạnh `MaintenanceBanner`: nằm TRONG luồng trên `<main>` (không che nội dung,
 * không đụng thanh tab đáy). Chỉ hiện khi mất kết nối > 3s; nối lại → "Đã kết nối lại" 2s. Không hiện trước lần nối đầu tiên,
 * khi tab ẩn, hay khi chưa đăng nhập (store được reset lúc đăng xuất). Không phải hàng đợi: chỉ báo, không lưu/gửi lại gì.
 */
export function ConnectionBanner() {
  const state = useConnectionState();
  const [tick, bump] = useReducer((n: number) => n + 1, 0);
  const pausedCount = usePausedCount();
  const phase = deriveBanner(state, Date.now());
  useEffect(() => {
    const ms = nextChangeIn(state, Date.now());
    if (ms === null) return;
    const id = window.setTimeout(bump, ms);
    return () => window.clearTimeout(id);
  }, [state, tick]);
  return <ConnectionBannerView phase={phase} pausedCount={pausedCount} />;
}
