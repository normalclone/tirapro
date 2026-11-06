import { useEffect, useRef, useState } from 'react';
import { ExternalLink, Send } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { QueryBoundary } from '@/components/ui/QueryBoundary';
import { SectionCard } from '@/components/ui/SectionCard';
import { Skeleton } from '@/components/ui/primitives';
import { CommandBlock, useNow } from '@/features/integrations/TelegramWizardDialog';
import { apiErrorMessage } from '@/lib/api';
import { LinkWaiting, useLinkSession } from './TelegramLinkParts';
import {
  useCreatePersonalLinkCode,
  usePollPersonalLink,
  useTelegramLink,
  useUnlinkTelegram,
  type TelegramLinkStatus,
} from './telegramApi';
import { linkPhase } from './telegramLink';

/** Gợi ý khi tổ chức chưa có bot dùng được — không có nút (người dùng thường không tự cài được bot). */
function unavailableText(reason: TelegramLinkStatus['reason']): string {
  return reason === 'PLATFORM_OFF'
    ? 'Tích hợp đang bị tắt toàn hệ thống — nhờ Quản trị bật lại.'
    : 'Quản trị cần cài bot Telegram ở Kết nối › Telegram.';
}

function LinkFlow({ status, onDone }: { status: TelegramLinkStatus; onDone: () => void }) {
  const create = useCreatePersonalLinkCode();
  const { session, error, creating, issue, restart, clear } = useLinkSession(create.mutateAsync);
  // Tạo mã ngay khi mở (người dùng đã bấm "Liên kết Telegram"); ref chặn chạy hai lần ở StrictMode.
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    issue();
  }, [issue]);
  const poll = usePollPersonalLink(session?.code.code ?? null, session?.startedAt ?? 0);
  const now = useNow(1000);
  const data = poll.data;
  const phase = linkPhase({
    hasSession: !!session || !!error,
    pollStatus: error ? 'error' : data?.status,
    expiresAtMs: session ? Date.parse(session.code.expiresAt) : 0,
    startedAt: session?.startedAt ?? 0,
    now,
  });
  const done = data?.status === 'linked';
  useEffect(() => {
    if (done) {
      toast.success('Đã liên kết Telegram.');
      onDone();
    }
  }, [done, onDone]);
  const remaining = session ? Date.parse(session.code.expiresAt) - now : 0;
  const botName = session?.code.botUsername ?? status.botUsername;

  return (
    <div className="space-y-3">
      {session && phase !== 'linked' && (
        <>
          <ol className="list-decimal space-y-1 pl-5 text-sm text-ink">
            <li>
              Mở Telegram rồi bấm <b>Start</b> (Bắt đầu) với bot
              {botName ? ` @${botName}` : ''}.
            </li>
            <li>Quay lại đây — trang tự nhận khi bạn đã bấm Start.</li>
          </ol>
          <div className="flex flex-wrap items-center gap-2">
            {session.code.deepLink && (
              <a
                href={session.code.deepLink}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-base font-medium text-primary-fg hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] [@media(pointer:coarse)]:h-11"
              >
                <ExternalLink className="h-4 w-4" aria-hidden />
                Mở Telegram
              </a>
            )}
            <Button
              type="button"
              variant="ghost"
              className="[@media(pointer:coarse)]:h-11"
              onClick={() => {
                clear();
                onDone();
              }}
            >
              Huỷ
            </Button>
          </div>
          <details className="text-sm text-muted">
            <summary className="cursor-pointer [@media(pointer:coarse)]:py-2.5">
              Không mở được liên kết?
            </summary>
            <p className="mt-2">
              Mở chat với bot{botName ? ` @${botName}` : ''} và gõ đúng dòng này:
            </p>
            <div className="mt-2">
              <CommandBlock command={session.code.command} />
            </div>
          </details>
        </>
      )}
      <LinkWaiting
        phase={phase}
        remainingMs={remaining}
        hint={data?.status === 'waiting' ? data.hint : undefined}
        errorHint={error ?? (data?.status === 'error' ? data.hint : undefined)}
        waitingText="Đang chờ bạn bấm Start trong Telegram…"
        doneText="Đã liên kết"
        onRetry={() => {
          restart();
          void poll.refetch();
        }}
        onNewCode={issue}
      />
      {creating && !session && <span className="sr-only">Đang tạo mã</span>}
    </div>
  );
}

function CardBody({ status }: { status: TelegramLinkStatus }) {
  const unlink = useUnlinkTelegram();
  const [linking, setLinking] = useState(false);

  if (status.linked) {
    const who = status.linked.username
      ? `@${status.linked.username}`
      : 'tài khoản Telegram của bạn';
    return (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink">
          <span className="font-medium text-success">Đã liên kết</span> với{' '}
          <b className="font-semibold text-ink-strong">{who}</b>
        </p>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="[@media(pointer:coarse)]:h-11"
          loading={unlink.isPending}
          onClick={() =>
            unlink.mutate(undefined, {
              onSuccess: () => toast.success('Đã huỷ liên kết Telegram.'),
              onError: (e) => toast.error(apiErrorMessage(e)),
            })
          }
        >
          Huỷ liên kết
        </Button>
      </div>
    );
  }
  if (!status.available)
    return <p className="text-sm text-muted">{unavailableText(status.reason)}</p>;
  if (linking) return <LinkFlow status={status} onDone={() => setLinking(false)} />;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-muted">
        Chưa liên kết. Liên kết xong, bạn chọn loại thông báo nào gửi qua Telegram ở danh sách bên
        dưới.
      </p>
      <Button
        type="button"
        className="[@media(pointer:coarse)]:h-11"
        onClick={() => setLinking(true)}
      >
        <Send className="h-4 w-4" aria-hidden />
        Liên kết Telegram
      </Button>
    </div>
  );
}

/** Mục "Telegram" đầu trang Cài đặt › Thông báo: liên kết / huỷ liên kết chat riêng với bot của tổ chức. */
export function TelegramLinkCard() {
  const query = useTelegramLink();
  return (
    <SectionCard
      data-tour="notif-telegram-link"
      icon={<Send className="h-4 w-4" />}
      title="Telegram"
      description="Nhận thông báo của bạn ngay trong Telegram, qua bot của tổ chức."
    >
      <QueryBoundary query={query} skeleton={<Skeleton className="h-10 w-full" />}>
        {(status) => <CardBody status={status} />}
      </QueryBoundary>
    </SectionCard>
  );
}
