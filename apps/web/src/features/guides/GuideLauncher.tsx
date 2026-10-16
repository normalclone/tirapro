import { useCallback, useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { HelpCircle } from 'lucide-react';
import type { DriveStep, Driver, Config } from 'driver.js';
import type { TourContent, TourStepDef } from '@tirapro/shared';
import { Button } from '@/components/ui/Button';
import { useScreenGuides, useMarkGuide, type ScreenGuide } from './api';
import { isTour, primaryTourOf, routeToScreen } from './routeToScreen';

/** Đổi step shape (shared) → DriveStep (driver.js), lọc bỏ step có selector không tồn tại. */
function toDriveSteps(steps: TourStepDef[]): DriveStep[] {
  return [...steps]
    .sort((a, b) => a.order - b.order)
    .filter((s) => !s.selector || !!document.querySelector(s.selector))
    .map((s) => ({
      element: s.selector,
      popover: {
        title: s.title,
        description: s.body,
        // driver.js Side không có 'auto' → để mặc định; các giá trị còn lại hợp lệ.
        side: s.placement === 'auto' ? undefined : s.placement,
      },
    }));
}

export function GuideLauncher() {
  const location = useLocation();
  const screen = routeToScreen(location.pathname);
  const { data: guides, isPending } = useScreenGuides(screen);
  const markGuide = useMarkGuide();
  // Đảm bảo intro chỉ auto-start một lần / màn / phiên.
  const autoStarted = useRef<Set<string>>(new Set());
  // Đang tải/đang chạy tour: chặn bấm đúp mở hai tour chồng nhau (mở khoá khi tour đóng).
  const launching = useRef(false);

  const runTour = useCallback(
    async (guide: ScreenGuide, opts: { markSeen?: boolean }) => {
      if (!isTour(guide.content)) return;
      const steps = toDriveSteps(guide.content.steps);
      if (steps.length === 0) return;
      // driver.js + CSS chỉ tải khi thật sự chạy tour (không nằm trong bundle đầu).
      if (launching.current) return;
      launching.current = true;
      let driver: (config?: Config) => Driver;
      try {
        [{ driver }] = await Promise.all([
          import('driver.js'),
          import('driver.js/dist/driver.css'),
        ]);
      } catch {
        launching.current = false;
        return; // mất mạng khi tải thư viện: bỏ qua, người dùng bấm lại “Hướng dẫn màn này” sau
      }
      if (opts.markSeen) markGuide.mutate({ key: guide.key, action: 'seen' });
      const d = driver({
        showProgress: true,
        nextBtnText: 'Tiếp',
        prevBtnText: 'Trước',
        doneBtnText: 'Xong',
        progressText: '{{current}}/{{total}}',
        steps,
        onDestroyed: () => {
          launching.current = false;
          markGuide.mutate({ key: guide.key, action: 'complete' });
        },
      });
      d.drive();
    },
    [markGuide],
  );

  // Tìm tour của màn (đầu tiên theo order) để gắn nút "Hướng dẫn".
  const primaryTour = primaryTourOf(guides);
  const autoStart =
    primaryTour !== undefined && (primaryTour.content as TourContent).autoStart === true;

  // `runTour` đổi danh tính mỗi lần render (phụ thuộc kết quả useMutation) → giữ bản mới nhất trong ref để hẹn giờ auto-start
  // KHÔNG bị huỷ/chạy lại mỗi lần render (trước đây hẹn giờ bị huỷ ngay mà `autoStarted` đã đánh dấu ⇒ tour không bao giờ tự chạy).
  const runTourRef = useRef(runTour);
  useEffect(() => {
    runTourRef.current = runTour;
  }, [runTour]);

  // Auto-start CHỈ tour có `autoStart` (Tổng quan), chưa xem, một lần duy nhất / màn / phiên — các màn khác chạy khi bấm "?".
  useEffect(() => {
    if (!primaryTour || !autoStart || primaryTour.seen) return;
    if (autoStarted.current.has(screen)) return;
    // Đợi một nhịp cho DOM (data-tour targets) render xong; đánh dấu "đã chạy" lúc thật sự chạy.
    const t = window.setTimeout(() => {
      if (autoStarted.current.has(screen)) return;
      autoStarted.current.add(screen);
      void runTourRef.current(primaryTour, { markSeen: true });
    }, 350);
    return () => window.clearTimeout(t);
  }, [primaryTour, autoStart, screen]);

  // Bảng lệnh có thể yêu cầu chạy tour màn hiện tại (sự kiện dùng chung).
  useEffect(() => {
    const onTour = () => {
      if (primaryTour) void runTour(primaryTour, { markSeen: !primaryTour.seen });
    };
    window.addEventListener('tirapro:tour', onTour);
    return () => window.removeEventListener('tirapro:tour', onTour);
  }, [primaryTour, runTour]);

  // Màn không có tour → KHÔNG hiện nút (không để nút xám vô nghĩa). Đang tải: giữ chỗ 36×36 trong suốt để thanh trên
  // không nhảy bố cục khi nút hiện ra.
  if (!primaryTour) return isPending ? <span className="inline-block h-9 w-9" aria-hidden /> : null;

  return (
    <>
      <style>{GUIDE_THEME_CSS}</style>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Hướng dẫn màn này"
        title="Hướng dẫn màn này"
        onClick={() => {
          void runTour(primaryTour, { markSeen: !primaryTour.seen });
        }}
      >
        <HelpCircle className="h-4 w-4" />
      </Button>
    </>
  );
}

/**
 * Override token-based cho popover driver.js để khớp design system Tirapro (cobalt,
 * Geist, bo góc / viền theo token). Tham chiếu CSS var nên tự đổi theo light/dark.
 */
const GUIDE_THEME_CSS = `
.driver-popover {
  background: var(--surface);
  color: var(--ink);
  border: 1px solid var(--border);
  border-radius: 0.625rem;
  box-shadow: 0 12px 32px -8px oklch(0.2 0.02 256 / 0.28);
  font-family: inherit;
}
.driver-popover-title { color: var(--ink-strong); font-weight: 600; }
.driver-popover-description { color: var(--ink); }
.driver-popover-progress-text { color: var(--ink); opacity: 0.65; font-variant-numeric: tabular-nums; }
.driver-popover-arrow-side-top.driver-popover-arrow { border-top-color: var(--surface); }
.driver-popover-arrow-side-bottom.driver-popover-arrow { border-bottom-color: var(--surface); }
.driver-popover-arrow-side-left.driver-popover-arrow { border-left-color: var(--surface); }
.driver-popover-arrow-side-right.driver-popover-arrow { border-right-color: var(--surface); }
.driver-popover-footer button {
  text-shadow: none;
  font-family: inherit;
  border-radius: 0.375rem;
  border: 1px solid var(--border);
  background: var(--surface-2);
  color: var(--ink);
}
.driver-popover-footer button:hover { background: var(--surface-3); }
.driver-popover-footer .driver-popover-next-btn {
  background: var(--primary);
  color: var(--primary-fg);
  border-color: var(--primary);
}
.driver-popover-footer .driver-popover-next-btn:hover { background: var(--primary-hover); }
.driver-popover-close-btn { color: var(--ink); opacity: 0.6; }
.driver-popover-close-btn:hover { opacity: 1; }
`;
