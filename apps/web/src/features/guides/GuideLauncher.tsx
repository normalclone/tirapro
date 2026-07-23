import { useCallback, useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { HelpCircle } from 'lucide-react';
import { driver, type DriveStep } from 'driver.js';
import type { TourContent, TourStepDef } from '@tirapro/shared';
import { GuideType } from '@tirapro/types';
import { Button } from '@/components/ui/Button';
import { useScreenGuides, useMarkGuide, type ScreenGuide } from './api';
import 'driver.js/dist/driver.css';

/**
 * Chuẩn hoá pathname cụ thể → screen pattern khớp với BE.
 * Vd `/p/PROJ-1/board` → `/p/:key/board`. Project key là segment sau `/p/`.
 */
function routeToScreen(pathname: string): string {
  const m = /^\/p\/[^/]+(\/.*)?$/.exec(pathname);
  if (m) return `/p/:key${m[1] ?? ''}`.replace(/\/$/, '') || '/p/:key';
  // Bỏ trailing slash (trừ root) để khớp screen đã seed.
  if (pathname.length > 1 && pathname.endsWith('/')) return pathname.slice(0, -1);
  return pathname;
}

/** Type-guard: content có phải tour (có mảng steps) không. */
function isTour(content: ScreenGuide['content']): content is TourContent {
  return !!content && Array.isArray((content as Partial<TourContent>).steps);
}

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
  const { data: guides } = useScreenGuides(screen);
  const markGuide = useMarkGuide();
  // Đảm bảo intro chỉ auto-start một lần / màn / phiên.
  const autoStarted = useRef<Set<string>>(new Set());

  const runTour = useCallback(
    (guide: ScreenGuide, opts: { markSeen?: boolean }) => {
      if (!isTour(guide.content)) return;
      const steps = toDriveSteps(guide.content.steps);
      if (steps.length === 0) return;
      if (opts.markSeen) markGuide.mutate({ key: guide.key, action: 'seen' });
      const d = driver({
        showProgress: true,
        nextBtnText: 'Tiếp',
        prevBtnText: 'Trước',
        doneBtnText: 'Xong',
        progressText: '{{current}}/{{total}}',
        steps,
        onDestroyed: () => {
          markGuide.mutate({ key: guide.key, action: 'complete' });
        },
      });
      d.drive();
    },
    [markGuide],
  );

  // Tìm tour của màn (đầu tiên theo order) để gắn nút "Hướng dẫn".
  const tours = (guides ?? []).filter((g) => g.type === GuideType.TOUR && isTour(g.content));
  const primaryTour = tours[0];

  // Auto-start tour intro chưa xem, một lần duy nhất / màn / phiên.
  useEffect(() => {
    if (!primaryTour || primaryTour.seen) return;
    if (autoStarted.current.has(screen)) return;
    autoStarted.current.add(screen);
    // Đợi 1 frame cho DOM (data-tour targets) render xong.
    const t = window.setTimeout(() => runTour(primaryTour, { markSeen: true }), 350);
    return () => window.clearTimeout(t);
  }, [primaryTour, screen, runTour]);

  // Bảng lệnh có thể yêu cầu chạy tour màn hiện tại (sự kiện dùng chung).
  useEffect(() => {
    const onTour = () => primaryTour && runTour(primaryTour, { markSeen: !primaryTour.seen });
    window.addEventListener('tirapro:tour', onTour);
    return () => window.removeEventListener('tirapro:tour', onTour);
  }, [primaryTour, runTour]);

  return (
    <>
      <style>{GUIDE_THEME_CSS}</style>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Hướng dẫn màn này"
        title="Hướng dẫn màn này"
        disabled={!primaryTour}
        onClick={() => primaryTour && runTour(primaryTour, { markSeen: !primaryTour.seen })}
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
