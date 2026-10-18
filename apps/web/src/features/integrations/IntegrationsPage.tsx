import { useEffect, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CalendarClock } from 'lucide-react';
import { pageContainer } from '@/components/layout/page';
import { cn } from '@/lib/utils';
import { useConfirmDiscard } from '@/lib/useUnsavedChanges';
import { FEATURES } from '@/lib/features';
import { DigestsSection } from '@/features/digests/DigestsSection';
import { PlatformLogo } from './PlatformLogo';
import { TelegramSection } from './TelegramSection';
import { RepositorySection, RepoStackIcon } from './RepositorySection';
import {
  integrationSections,
  parseIntegrationSection,
  type IntegrationSectionId,
} from './sections';
import { useScrollFade } from '@/lib/useScrollFade';
import { CONNECT_LABELS } from '@/lib/navLabels';

/* ------------------------------------------------------------------ */
/* Submenu — rail dọc trên desktop, hàng pill cuộn ngang trên mobile  */
/* ------------------------------------------------------------------ */

const SECTION_ICON: Record<IntegrationSectionId, ReactNode> = {
  telegram: <PlatformLogo platform="TELEGRAM" size={16} />,
  repos: <RepoStackIcon />,
  digest: <CalendarClock className="h-4 w-4 text-muted" aria-hidden />,
};

const INTEGRATION_NAV = integrationSections(FEATURES);

export function IntegrationsPage() {
  // Lối vào trực tiếp: /connect/integrations?section=digest (vd từ Tổng quan → "Báo cáo định kỳ").
  const [params] = useSearchParams();
  const fromUrl = parseIntegrationSection(params.get('section'), FEATURES);
  const [picked, setPicked] = useState<IntegrationSectionId>(fromUrl ?? 'telegram');
  // Đang ở trang này mà bấm liên kết mang `?section=` khác thì phải chuyển mục theo.
  useEffect(() => {
    if (fromUrl) setPicked(fromUrl);
  }, [fromUrl]);
  // Mục đang chọn không còn trong danh sách (cờ tắt) → rơi về Telegram.
  const active = INTEGRATION_NAV.some((s) => s.id === picked) ? picked : 'telegram';
  const navFade = useScrollFade<HTMLElement>(active, '[aria-current="page"]');
  const confirmDiscard = useConfirmDiscard();
  // Đổi mục là `useState` (không qua router) nên `useBlocker` không bắt: còn form chưa lưu thì hỏi trước khi tháo nó.
  async function pick(id: IntegrationSectionId) {
    if (id === active) return;
    if (await confirmDiscard()) setPicked(id);
  }

  return (
    <div className="flex h-full min-h-0 flex-col lg:flex-row">
      {/* Submenu: rail dọc trên desktop, hàng pill cuộn ngang trên mobile */}
      <nav
        aria-label="Mục tích hợp"
        ref={navFade.ref}
        style={navFade.style}
        className={cn(
          'shrink-0 border-border bg-surface',
          'scroll-fade-x relative flex gap-1 overflow-x-auto border-b px-3 py-2 max-lg:scrollbar-none',
          'lg:w-60 lg:flex-col lg:gap-0.5 lg:overflow-y-auto lg:border-b-0 lg:border-r lg:px-3 lg:py-5',
        )}
      >
        <h1 className="hidden px-3 pb-2 text-xs font-semibold text-faint lg:block">
          {CONNECT_LABELS.integrations}
        </h1>
        {INTEGRATION_NAV.map((item) => {
          const isActive = item.id === active;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => void pick(item.id)}
              aria-current={isActive ? 'page' : undefined}
              className={cn(
                'flex shrink-0 items-center gap-2.5 whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
                isActive
                  ? 'bg-primary-subtle text-primary'
                  : 'text-muted hover:bg-surface-2 hover:text-ink',
              )}
            >
              {SECTION_ICON[item.id]}
              {item.label}
            </button>
          );
        })}
      </nav>

      <div className="min-w-0 flex-1 overflow-auto">
        <div className={pageContainer('sm')}>
          {active === 'telegram' && <TelegramSection />}
          {FEATURES.repos && active === 'repos' && <RepositorySection />}
          {active === 'digest' && <DigestsSection />}
        </div>
      </div>
    </div>
  );
}
