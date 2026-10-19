import { useEffect, useReducer } from 'react';
import { useMutationState } from '@tanstack/react-query';
import { CheckCircle2, WifiOff } from 'lucide-react';
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

/**
 * Phần trình bày thuần. Vùng `role="status"` (aria-live polite) LUÔN có trong DOM để trình đọc màn hình đọc chữ mới khi
 * banner hiện; chữ chỉ đổi khi đổi pha (không đọc lại mỗi lần thử nối lại).
 * - `paused`: WS đứt nhưng mạng còn → REST vẫn chạy, mọi thay đổi vẫn lưu; chỉ cập nhật tự động tạm dừng.
 * - `offline`: trình duyệt báo mất mạng → mutation mới tạm dừng và tự gửi khi có mạng (chỉ khi trang còn mở: không lưu bền).
 */
export function ConnectionBannerView({
  phase,
  pausedCount,
}: {
  phase: BannerPhase;
  pausedCount: number;
}) {
  return (
    <div role="status" aria-live="polite">
      {phase === 'restored' && (
        <div className="flex items-start gap-2 border-b border-success/30 bg-success/10 px-4 py-2 text-sm text-ink">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden />
          <span className="min-w-0">Đã kết nối lại</span>
        </div>
      )}
      {(phase === 'paused' || phase === 'offline') && (
        <div className="flex items-start gap-2 border-b border-warning/30 bg-warning/10 px-4 py-2 text-sm text-ink">
          <WifiOff className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
          <span className="min-w-0">
            {phase === 'paused'
              ? 'Mất kết nối thời gian thực — đang thử lại… (thay đổi vẫn được lưu)'
              : 'Không có mạng — thay đổi sẽ được gửi khi có mạng lại. Giữ trang này mở.'}
            {pausedCount > 0 && ` · ${pausedCount} thay đổi đang chờ gửi`}
          </span>
        </div>
      )}
    </div>
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
