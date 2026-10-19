import { useId, useRef, useState, type ReactNode } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { ChevronDown } from 'lucide-react';
import type { IssueDto } from '@tirapro/types';
import {
  IssueAssigneeControl,
  IssueDueField,
  IssuePrioritySelect,
} from '@/features/issue-edit/IssueProperties';
import { useAuth } from '@/stores/auth';
import { cn } from '@/lib/utils';
import { otherFactsKey, readOtherOpen, writeOtherOpen } from './issueFacts';
import type { NextStatus } from './nextStatuses';

export const CATEGORY_COLOR: Record<string, string> = {
  TODO: 'var(--status-todo)',
  IN_PROGRESS: 'var(--status-progress)',
  DONE: 'var(--status-done)',
};

/** Vùng bấm ≥ 44px; biến thể cảm ứng của các control gốc (`min-h-9`) phải bị đè đúng biến thể. */
const TAP = 'min-h-11 [@media(pointer:coarse)]:min-h-11';

/** Ô của dải thuộc tính: nhãn nhỏ nhìn thấy + điều khiển, vùng bấm cao tối thiểu 44px. Nhóm có tên = nhãn. */
export function FactTile({ label, children }: { label: string; children: ReactNode }) {
  const labelId = useId();
  return (
    <div role="group" aria-labelledby={labelId} className="min-w-0">
      <span id={labelId} className="block text-xs font-medium text-muted">
        {label}
      </span>
      <div className="flex min-h-11 min-w-0 items-center">{children}</div>
    </div>
  );
}

function StatusChip({ status }: { status: { name: string; category: string } }) {
  return (
    <>
      <span
        className="h-2 w-2 shrink-0 rounded-full"
        style={{ background: CATEGORY_COLOR[status.category] ?? 'var(--faint)' }}
        aria-hidden
      />
      <span className="truncate">{status.name}</span>
    </>
  );
}

/**
 * Trạng thái trong dải: có quyền chuyển + có bước kế → nút mở menu các bước kế (đi đúng cổng `onPick` =
 * `requestTransition` của trang: hộp Cách giải quyết/lý do khi cần, toast Hoàn tác). Ngược lại hiện giá trị thẳng
 * (không phải nút vô hiệu). Hành động chạy sau khi menu đóng hẳn để focus của hộp hỏi không bị menu kéo lại.
 */
export function IssueStatusField({
  status,
  options,
  canTransition,
  pending,
  onPick,
}: {
  status: { id: string; name: string; category: string };
  options: readonly NextStatus[];
  canTransition: boolean;
  pending: boolean;
  onPick: (statusId: string) => void;
}) {
  const picked = useRef<string | null>(null);
  if (!canTransition || options.length === 0) {
    return (
      <span
        className="inline-flex min-w-0 items-center gap-1.5 px-1.5 text-sm font-medium text-ink"
        title="Trạng thái hiện tại của công việc"
      >
        <StatusChip status={status} />
      </span>
    );
  }
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          disabled={pending}
          aria-label={`Trạng thái: ${status.name}`}
          title="Đổi trạng thái: chọn bước kế tiếp theo quy trình"
          className="inline-flex min-h-11 min-w-0 items-center gap-1.5 rounded-md px-1.5 text-sm font-medium text-ink transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] disabled:cursor-not-allowed disabled:text-disabled-fg"
        >
          <StatusChip status={status} />
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-faint" aria-hidden />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          sideOffset={4}
          collisionPadding={8}
          onCloseAutoFocus={(e) => {
            const id = picked.current;
            if (!id) return; // Esc / bấm ra ngoài: trả focus về nút như thường
            picked.current = null;
            e.preventDefault();
            onPick(id);
          }}
          className="z-dropdown min-w-48 overflow-hidden rounded-lg border border-border bg-surface p-1 shadow-lg animate-in fade-in zoom-in-95 duration-150 motion-reduce:animate-none"
        >
          {options.map((o) => (
            <DropdownMenu.Item
              key={o.id}
              onSelect={() => {
                picked.current = o.id;
              }}
              title={o.label !== o.name ? `${o.label} → “${o.name}”` : `Chuyển sang “${o.name}”`}
              className="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-ink outline-none transition-colors data-[highlighted]:bg-surface-2 sm:min-h-0"
            >
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ background: CATEGORY_COLOR[o.category] ?? 'var(--faint)' }}
                aria-hidden
              />
              {o.label}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/**
 * Dải thuộc tính chính ngay dưới tiêu đề (CHỈ dưới `md`, do trang quyết định bằng `factLayout`): Trạng thái, Người phụ
 * trách, Hạn, Ưu tiên. Mỗi ô dùng đúng control + mutation của cột phải/hàng tiêu đề (không viết lại logic), nên cùng
 * quyền, cùng `version`; chỉ xem thì hiện giá trị thẳng.
 */
export function IssueKeyFacts({
  issue,
  canEditRestricted,
  canTransition,
  nextStatuses,
  transitionPending,
  onTransition,
}: {
  issue: IssueDto;
  canEditRestricted: boolean;
  canTransition: boolean;
  nextStatuses: readonly NextStatus[];
  transitionPending: boolean;
  onTransition: (statusId: string) => void;
}) {
  return (
    <section aria-label="Thuộc tính chính" className="mt-2 grid grid-cols-2 gap-x-3">
      <FactTile label="Trạng thái">
        <IssueStatusField
          status={issue.status}
          options={nextStatuses}
          canTransition={canTransition}
          pending={transitionPending}
          onPick={onTransition}
        />
      </FactTile>
      <FactTile label="Người phụ trách">
        <IssueAssigneeControl
          issue={issue}
          className={`max-w-full justify-start ${TAP}`}
          suggestClassName={TAP}
        />
      </FactTile>
      <FactTile label="Hạn">
        <IssueDueField issue={issue} canEdit={canEditRestricted} layout="tile" />
      </FactTile>
      <FactTile label="Ưu tiên">
        <IssuePrioritySelect issue={issue} className={TAP} />
      </FactTile>
    </section>
  );
}

/**
 * "Thuộc tính khác" (dưới `md`): nút mở/thu có `aria-expanded` + `aria-controls`; mặc định thu gọn, nhớ mở/thu theo người
 * dùng (localStorage, mọi chạm có try/catch trong `issueFacts`). Nội dung chỉ dựng khi mở (nhẹ cho trang dài).
 */
export function OtherFactsDisclosure({ children }: { children: ReactNode }) {
  const userId = useAuth((s) => s.user?.id);
  const key = userId ? otherFactsKey(userId) : null;
  const [state, setState] = useState(() => ({ key, open: readOtherOpen(key) }));
  // Đổi người dùng → nạp lại lựa chọn của người đó.
  const current = state.key === key ? state : { key, open: readOtherOpen(key) };
  if (current !== state) setState(current);
  const open = current.open;
  const uid = useId();
  const panelId = `${uid}-panel`;
  const buttonId = `${uid}-button`;
  return (
    <div className="mb-4">
      <button
        type="button"
        id={buttonId}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => {
          const next = !open;
          setState({ key, open: next });
          if (key) writeOtherOpen(key, next);
        }}
        className="flex min-h-11 w-full items-center justify-between gap-2 border-y border-border px-1 text-sm font-medium text-ink transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
      >
        Thuộc tính khác
        <ChevronDown
          className={cn(
            'h-4 w-4 shrink-0 text-faint transition-transform motion-reduce:transition-none',
            open && 'rotate-180',
          )}
          aria-hidden
        />
      </button>
      <div id={panelId} role="region" aria-labelledby={buttonId} hidden={!open} className="pt-3">
        {open && <div className="space-y-5">{children}</div>}
      </div>
    </div>
  );
}
