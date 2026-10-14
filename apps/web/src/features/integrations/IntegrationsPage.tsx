import { useState, type ReactNode } from 'react';
import { CalendarClock } from 'lucide-react';
import { pageContainer } from '@/components/layout/page';
import { cn } from '@/lib/utils';
import { DigestsSection } from '@/features/digests/DigestsSection';
import { PlatformLogo } from './PlatformLogo';
import { TelegramSection } from './TelegramSection';
import { RepositorySection, RepoStackIcon } from './RepositorySection';

/* ------------------------------------------------------------------ */
/* Submenu — rail dọc trên desktop, hàng pill cuộn ngang trên mobile  */
/* ------------------------------------------------------------------ */

type SectionId = 'telegram' | 'repos' | 'digest';

const INTEGRATION_NAV: { id: SectionId; label: string; icon: ReactNode }[] = [
  { id: 'telegram', label: 'Telegram', icon: <PlatformLogo platform="TELEGRAM" size={16} /> },
  { id: 'repos', label: 'Kho mã', icon: <RepoStackIcon /> },
  {
    id: 'digest',
    label: 'Digest',
    icon: <CalendarClock className="h-4 w-4 text-muted" aria-hidden />,
  },
];


export function IntegrationsPage() {
  const [active, setActive] = useState<SectionId>('telegram');

  return (
    <div className="flex h-full min-h-0 flex-col lg:flex-row">
      {/* Submenu: rail dọc trên desktop, hàng pill cuộn ngang trên mobile */}
      <nav
        aria-label="Mục tích hợp"
        className={cn(
          'shrink-0 border-border bg-surface',
          'flex gap-1 overflow-x-auto border-b px-3 py-2',
          'lg:w-60 lg:flex-col lg:gap-0.5 lg:overflow-y-auto lg:border-b-0 lg:border-r lg:px-3 lg:py-5',
        )}
      >
        <h1 className="hidden px-3 pb-2 text-xs font-semibold text-faint lg:block">
          Tích hợp
        </h1>
        {INTEGRATION_NAV.map((item) => {
          const isActive = item.id === active;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setActive(item.id)}
              aria-current={isActive ? 'page' : undefined}
              className={cn(
                'flex shrink-0 items-center gap-2.5 whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
                isActive
                  ? 'bg-primary-subtle text-primary'
                  : 'text-muted hover:bg-surface-2 hover:text-ink',
              )}
            >
              {item.icon}
              {item.label}
            </button>
          );
        })}
      </nav>

      <div className="min-w-0 flex-1 overflow-auto">
        <div className={pageContainer('sm')}>
          {active === 'telegram' && <TelegramSection />}
          {active === 'repos' && <RepositorySection />}
          {active === 'digest' && <DigestsSection />}
        </div>
      </div>
    </div>
  );
}
