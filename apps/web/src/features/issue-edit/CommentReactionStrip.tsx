import { useId, useRef, useState, type MutableRefObject } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { SmilePlus } from 'lucide-react';
import { COMMENT_REACTION_EMOJIS } from '@tirapro/shared';
import type { CommentDto, CommentReactionDto } from '@tirapro/types';
import { useCanIn, useProjectArchived } from '@/features/projects/permissions';
import { CHIP_ROW_GAP_COARSE, CHIP_TOUCH_HIT } from '@/lib/touchHit';
import { cn } from '@/lib/utils';
import { useAuth } from '@/stores/auth';
import { useReactToComment } from './api';
import {
  REACTION_LABELS,
  nextPickerIndex,
  reactionChipName,
  reactionUsersText,
} from './commentReactions';

const CHIP_BASE =
  'inline-flex h-7 items-center gap-1 rounded-full border px-2 text-xs transition-colors motion-reduce:transition-none';
const RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]';

/**
 * Chip một emoji: "👍 3". Tên truy cập = "👍 3 — bạn và 2 người khác" (bắt đầu bằng chữ nhìn thấy); danh sách tên đầy đủ ở
 * `aria-describedby` (đọc được) + `title` (tooltip tức thì khi rê/focus) — không nhét vào tên. Trạng thái "của mình" = `aria-pressed`
 * và đậm hơn + nền nhạt (không chỉ khác màu). `onToggle = null` → chỉ-đọc (dự án lưu trữ): không phải nút.
 */
export function ReactionChip({
  reaction,
  meId,
  onToggle,
}: {
  reaction: CommentReactionDto;
  meId: string | undefined;
  onToggle: (() => void) | null;
}) {
  const descId = useId();
  const name = reactionChipName(reaction);
  const users = reactionUsersText(reaction, meId);
  const body = (
    <>
      <span aria-hidden="true" className="text-sm leading-none">
        {reaction.emoji}
      </span>
      <span aria-hidden="true" className="tabular-nums">
        {reaction.count}
      </span>
    </>
  );
  const tone = reaction.mine
    ? 'border-transparent bg-primary-subtle font-semibold text-primary'
    : 'border-border font-medium text-muted';
  if (!onToggle) {
    return (
      <span
        role="img"
        aria-label={name}
        aria-describedby={descId}
        title={users}
        className={cn(CHIP_BASE, tone)}
      >
        {body}
        <span id={descId} className="sr-only">
          {users}
        </span>
      </span>
    );
  }
  return (
    <button
      type="button"
      aria-pressed={reaction.mine}
      aria-label={name}
      aria-describedby={descId}
      title={users}
      onClick={onToggle}
      className={cn(
        CHIP_BASE,
        CHIP_TOUCH_HIT,
        tone,
        'hover:bg-surface-2',
        reaction.mine && 'hover:bg-primary-subtle',
        RING,
      )}
    >
      {body}
      <span id={descId} className="sr-only">
        {users}
      </span>
    </button>
  );
}

/**
 * Lưới 6 emoji cố định trong popover. Mỗi ô là nút bật/tắt (`aria-pressed`, tên tiếng Việt) — người dùng có thể thả nhiều emoji,
 * nên là nhóm nút chứ không phải radiogroup một-lựa-chọn; điều hướng kiểu radio: một Tab stop (roving tabindex), mũi tên/Home/End
 * di chuyển, Enter/Space bật/tắt. Ô 44px trên cảm ứng. `firstRef` trỏ ô đang là Tab stop (Radix focus vào đó khi mở).
 */
export function ReactionPickerPanel({
  reactions,
  onPick,
  firstRef,
}: {
  reactions: readonly CommentReactionDto[];
  onPick: (emoji: string, on: boolean) => void;
  firstRef: MutableRefObject<HTMLButtonElement | null>;
}) {
  const count = COMMENT_REACTION_EMOJIS.length;
  const firstMine = COMMENT_REACTION_EMOJIS.findIndex((e) =>
    reactions.some((r) => r.emoji === e && r.mine),
  );
  const [active, setActive] = useState(firstMine < 0 ? 0 : firstMine);
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const tabStop = Math.min(Math.max(active, 0), count - 1); // kẹp ở lúc render
  return (
    <div role="group" aria-label="Chọn cảm xúc" className="flex items-center gap-1">
      {COMMENT_REACTION_EMOJIS.map((emoji, i) => {
        const mine = reactions.some((r) => r.emoji === emoji && r.mine);
        return (
          <button
            key={emoji}
            ref={(el) => {
              refs.current[i] = el;
              if (i === tabStop) firstRef.current = el;
            }}
            type="button"
            aria-label={REACTION_LABELS[emoji]}
            aria-pressed={mine}
            tabIndex={i === tabStop ? 0 : -1}
            title={REACTION_LABELS[emoji]}
            onClick={() => onPick(emoji, !mine)}
            onFocus={() => setActive(i)}
            onKeyDown={(e) => {
              const next = nextPickerIndex(i, e.key, count, e.nativeEvent);
              if (next === null) return;
              e.preventDefault();
              setActive(next);
              refs.current[next]?.focus();
            }}
            className={cn(
              'inline-flex h-8 w-8 items-center justify-center rounded-md text-lg leading-none transition-colors motion-reduce:transition-none [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11',
              mine ? 'bg-primary-subtle ring-1 ring-primary/40' : 'hover:bg-surface-2',
              RING,
            )}
          >
            <span aria-hidden="true">{emoji}</span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * Dải cảm xúc dưới thân bình luận: chip (emoji + số) + nút "+" mở ô chọn. Cập nhật lạc quan, hoàn tác về bản máy chủ xác nhận
 * khi lỗi (`useReactToComment`). Ai XEM được việc đều thả được (kể cả chỉ-xem); dự án lưu trữ → chip chỉ-đọc, không có "+".
 * Không sinh thông báo cho người viết bình luận (chủ ý, tránh spam).
 */
export function CommentReactions({
  comment,
  issueId,
  projectId,
}: {
  comment: CommentDto;
  issueId: string;
  projectId: string;
}) {
  const meId = useAuth((s) => s.user?.id);
  const can = useCanIn(projectId);
  const archived = useProjectArchived(projectId);
  const canReact = can('project:view') && !archived;
  const react = useReactToComment(issueId);
  const [open, setOpen] = useState(false);
  const firstRef = useRef<HTMLButtonElement | null>(null);
  const reactions = comment.reactions ?? [];
  if (reactions.length === 0 && !canReact) return null;
  const toggle = (emoji: string, on: boolean) => react.mutate({ commentId: comment.id, emoji, on });
  return (
    <div
      role="group"
      aria-label="Cảm xúc"
      className={cn('flex flex-wrap items-center gap-1.5', CHIP_ROW_GAP_COARSE)}
    >
      {reactions.map((r) => (
        <ReactionChip
          key={r.emoji}
          reaction={r}
          meId={meId}
          onToggle={canReact ? () => toggle(r.emoji, !r.mine) : null}
        />
      ))}
      {canReact && (
        <Popover.Root open={open} onOpenChange={setOpen}>
          <Popover.Trigger asChild>
            <button
              type="button"
              aria-label="Thả cảm xúc"
              title="Thả cảm xúc"
              className={cn(
                'inline-flex h-7 w-7 items-center justify-center rounded-full border border-border text-faint transition-colors hover:bg-surface-2 hover:text-ink motion-reduce:transition-none [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11',
                RING,
              )}
            >
              <SmilePlus className="h-4 w-4" aria-hidden="true" />
            </button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content
              align="start"
              sideOffset={6}
              collisionPadding={8}
              aria-label="Thả cảm xúc"
              onOpenAutoFocus={(e) => {
                e.preventDefault();
                firstRef.current?.focus();
              }}
              className="z-dropdown rounded-lg border border-border bg-surface p-1.5 shadow-lg outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 motion-reduce:animate-none"
            >
              <ReactionPickerPanel
                reactions={reactions}
                firstRef={firstRef}
                onPick={(emoji, on) => {
                  toggle(emoji, on);
                  setOpen(false);
                }}
              />
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      )}
    </div>
  );
}
