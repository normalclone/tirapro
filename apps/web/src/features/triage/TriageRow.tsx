import { useId, useState } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Link } from 'react-router-dom';
import { Check, ChevronRight, Clock, ExternalLink, Repeat2, X } from 'lucide-react';
import type { TriageItemDto } from '@tirapro/types';
import { Avatar } from '@/components/ui/primitives';
import { Button } from '@/components/ui/Button';
import { SeverityBadge } from '@/components/ui/SeverityBadge';
import { MarkdownView } from '@/features/issue-edit/MarkdownView';
import { IssueKeyLink } from '@/features/issues/peek/IssueKeyLink';
import { rowPeekProps } from '@/features/issues/peek/rowPeekProps';
import { fmtDateTime, fmtRelative } from '@/lib/dateFormat';
import { cn } from '@/lib/utils';
import { AcceptForm } from './AcceptForm';
import {
  formatEnvironmentLine,
  isLongDescription,
  kindLabel,
  type AcceptPayload,
} from './triageLogic';
import { PriorityIcon } from '@/components/ui/PriorityIcon';
import { usePriorityRanks } from '@/features/settings-admin/api';

const SNOOZE_CHOICES: { label: string; days: number }[] = [
  { label: '1 ngày', days: 1 },
  { label: '3 ngày', days: 3 },
  { label: '1 tuần', days: 7 },
];

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0 break-words text-ink">{children}</dd>
    </>
  );
}

/** Nút Tạm hoãn + menu 1 ngày / 3 ngày / 1 tuần (Radix: Esc đóng, mũi tên chọn, focus trả về nút). */
function SnoozeMenu({
  compact,
  pending,
  onPick,
}: {
  compact: boolean;
  pending: boolean;
  onPick: (days: number, label: string) => void;
}) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <Button variant="secondary" size="sm" disabled={pending} title="Tạm hoãn">
          <Clock className="h-4 w-4" />
          <span className={compact ? 'sr-only' : undefined}>Tạm hoãn</span>
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={4}
          collisionPadding={12}
          className="z-dropdown w-32 overflow-hidden rounded-md border border-border bg-surface py-1 shadow-lg animate-in fade-in zoom-in-95 duration-150"
        >
          {SNOOZE_CHOICES.map((c) => (
            <DropdownMenu.Item
              key={c.days}
              onSelect={() => onPick(c.days, c.label)}
              className="block w-full cursor-pointer px-3 py-1.5 text-left text-sm text-ink outline-none transition-colors data-[highlighted]:bg-surface-2"
            >
              {c.label}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/** Vùng mở rộng của một dòng: mô tả, thông tin người gửi/môi trường, Nhận… (AcceptForm) và Mở trang. */
function TriageDetail({
  id,
  issue,
  projectKey,
  canTriage,
  pending,
  onPeek,
  onAccept,
}: {
  id: string;
  issue: TriageItemDto;
  projectKey: string;
  canTriage: boolean;
  pending: boolean;
  onPeek: (key: string) => void;
  onAccept: (issue: TriageItemDto, payload: AcceptPayload) => void;
}) {
  const [accepting, setAccepting] = useState(false);
  const env = formatEnvironmentLine(issue.environment);
  const long = isLongDescription(issue.description);
  return (
    <div
      id={id}
      role="region"
      aria-label={`Chi tiết ${issue.key}`}
      className="grid gap-4 border-t border-border bg-surface-2/50 px-4 py-3 md:grid-cols-[minmax(0,1fr)_18rem]"
    >
      <div className="min-w-0">
        {issue.description ? (
          <>
            <div className={cn(long && 'max-h-[17rem] overflow-hidden')}>
              <MarkdownView text={issue.description} />
            </div>
            {long && (
              <button
                type="button"
                onClick={() => onPeek(issue.key)}
                className="mt-1.5 text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
              >
                Xem đầy đủ
              </button>
            )}
          </>
        ) : (
          <p className="text-sm text-muted">Người gửi không viết mô tả.</p>
        )}
      </div>

      <div className="min-w-0 space-y-3">
        <dl className="grid grid-cols-[88px_minmax(0,1fr)] gap-x-2 gap-y-1.5 text-sm">
          <InfoRow label="Người gửi">
            {issue.reporter ? (
              <span className="inline-flex items-center gap-1.5">
                <Avatar
                  name={issue.reporter.displayName}
                  src={issue.reporter.avatarUrl}
                  size={18}
                />
                {issue.reporter.displayName}
              </span>
            ) : (
              'Không rõ'
            )}
          </InfoRow>
          <InfoRow label="Gửi lúc">
            {fmtRelative(issue.createdAt)} · {fmtDateTime(issue.createdAt)}
          </InfoRow>
          <InfoRow label="Loại yêu cầu">{kindLabel(issue.kind)}</InfoRow>
          {issue.severity && (
            <InfoRow label="Nghiêm trọng">
              <SeverityBadge severity={issue.severity} />
            </InfoRow>
          )}
          {env && <InfoRow label="Môi trường">{env}</InfoRow>}
          {issue.occurrenceCount > 1 && (
            <InfoRow label="Số lần báo">
              ×{issue.occurrenceCount}
              {issue.lastOccurredAt && <> · gần nhất {fmtRelative(issue.lastOccurredAt)}</>}
            </InfoRow>
          )}
        </dl>
        <div className="flex flex-wrap items-center gap-2">
          {canTriage && (
            <Button
              size="sm"
              variant={accepting ? 'secondary' : 'outline'}
              onClick={() => setAccepting((v) => !v)}
              aria-expanded={accepting}
              disabled={pending}
            >
              <Check className="h-4 w-4" />
              Nhận…
            </Button>
          )}
          <Link
            to={`/issue/${issue.key}`}
            className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-sm text-muted transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
          >
            <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            Mở trang
          </Link>
        </div>
      </div>

      {canTriage && accepting && (
        <div className="md:col-span-2">
          <AcceptForm
            issue={issue}
            projectKey={projectKey}
            pending={pending}
            onCancel={() => setAccepting(false)}
            onSubmit={(payload) => onAccept(issue, payload)}
          />
        </div>
      )}
    </div>
  );
}

/**
 * Một dòng Việc mới vào. Bấm tiêu đề/Enter = xem nhanh (panel bên phải, như mọi danh sách); nút mũi tên (aria-expanded)
 * mở rộng tại chỗ để đọc mô tả, người gửi, giờ gửi, loại yêu cầu, môi trường rồi Nhận (chọn Loại/Ưu tiên/Sprint) hoặc Từ chối.
 * Nút "Nhận" ở dòng thu gọn giữ đường nhận một chạm.
 */
export function TriageRow({
  issue,
  projectKey,
  compact,
  peeking,
  canTriage,
  pending,
  onPeek,
  onAccept,
  onDecline,
  onSnooze,
}: {
  issue: TriageItemDto;
  projectKey: string;
  /** Panel xem nhanh đang mở → cột hẹp: bỏ chip phụ, nút chỉ còn biểu tượng. */
  compact: boolean;
  peeking: boolean;
  canTriage: boolean;
  pending: boolean;
  onPeek: (key: string) => void;
  onAccept: (issue: TriageItemDto, payload: AcceptPayload) => void;
  onDecline: (issue: TriageItemDto) => void;
  onSnooze: (issue: TriageItemDto, days: number, label: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const regionId = useId();
  const ranks = usePriorityRanks();

  return (
    <li data-issue-key={issue.key} className={cn(peeking && 'bg-primary-subtle/60')}>
      <div
        role="group"
        tabIndex={0}
        data-nav-item
        aria-label={`Xem nhanh ${issue.key}: ${issue.summary}`}
        {...rowPeekProps(issue.key, onPeek)}
        className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5 transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--ring)]"
      >
        {/* Dưới sm: dòng 1 = mở rộng + mã + tiêu đề (tối đa 2 dòng), dòng 2 = chip/ưu tiên/người + nút hành động (`ml-auto`).
            Từ sm trải phẳng một hàng như cũ (`sm:contents`). */}
        <div className="flex min-w-0 basis-full items-center gap-x-3 sm:contents">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            aria-controls={regionId}
            aria-label={`${expanded ? 'Thu gọn' : 'Mở rộng'} ${issue.key}`}
            title={expanded ? 'Thu gọn' : 'Đọc mô tả và duyệt tại chỗ'}
            className="grid h-6 w-6 shrink-0 place-items-center rounded text-muted transition-colors hover:bg-surface-3 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
          >
            <ChevronRight
              className={cn('h-4 w-4 transition-transform duration-150', expanded && 'rotate-90')}
              aria-hidden
            />
          </button>

          {issue.occurrenceCount > 1 && (
            <span
              className="tabular inline-flex shrink-0 items-center gap-0.5 rounded-full bg-surface-3 px-1.5 py-0.5 text-xs font-medium text-ink"
              title={`Lặp lại ${issue.occurrenceCount} lần`}
            >
              <Repeat2 className="h-3 w-3" />×{issue.occurrenceCount}
            </span>
          )}

          <IssueKeyLink issueKey={issue.key} onPeek={onPeek} />

          <span
            className="min-w-0 flex-1 text-left text-sm text-ink-strong max-sm:line-clamp-2 max-sm:break-words sm:min-w-[8rem] sm:truncate"
            title={issue.summary}
          >
            {issue.summary}
          </span>
        </div>

        {issue.kind && !compact && (
          <span className="hidden shrink-0 rounded-full bg-primary-subtle px-2 py-0.5 text-xs font-medium text-primary sm:inline">
            {kindLabel(issue.kind)}
          </span>
        )}

        {!compact && <SeverityBadge severity={issue.severity} className="hidden sm:inline-flex" />}

        {issue.priority && (
          <PriorityIcon
            name={issue.priority.name}
            rank={issue.priority.rank}
            ranks={ranks}
            color={issue.priority.color}
          />
        )}

        {/* Có loại yêu cầu thì chip ở trên đã đủ nghĩa (Bug / Yêu cầu tính năng / Câu hỏi) — bớt một chip cho dòng thoáng. */}
        {!compact && !issue.kind && (
          <span className="hidden shrink-0 rounded bg-surface-2 px-1.5 py-0.5 text-xs text-muted md:inline">
            {issue.type.name}
          </span>
        )}

        <span className="shrink-0">
          {issue.assignee && (
            <Avatar name={issue.assignee.displayName} src={issue.assignee.avatarUrl} size={22} />
          )}
        </span>

        {canTriage && (
          <div className="ml-auto flex shrink-0 items-center gap-1">
            <Button
              variant="primary"
              size="sm"
              onClick={() => onAccept(issue, { version: issue.version })}
              disabled={pending}
              title="Nhận công việc này vào Việc chờ (giữ nguyên loại và ưu tiên)"
            >
              <Check className="h-4 w-4" />
              <span className={compact ? 'sr-only' : undefined}>Nhận</span>
            </Button>

            <SnoozeMenu
              compact={compact}
              pending={pending}
              onPick={(days, label) => onSnooze(issue, days, label)}
            />

            <Button
              variant="ghost"
              size="sm"
              onClick={() => onDecline(issue)}
              disabled={pending}
              className="text-muted hover:text-ink"
              title="Từ chối công việc này (cần ghi lý do)"
            >
              <X className="h-4 w-4" />
              <span className={compact ? 'sr-only' : undefined}>Từ chối</span>
            </Button>
          </div>
        )}
      </div>

      {expanded && (
        <TriageDetail
          id={regionId}
          issue={issue}
          projectKey={projectKey}
          canTriage={canTriage}
          pending={pending}
          onPeek={onPeek}
          onAccept={onAccept}
        />
      )}
    </li>
  );
}
