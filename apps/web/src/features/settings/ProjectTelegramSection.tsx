import { useEffect, useId, useRef, useState } from 'react';
import { ChevronDown, ExternalLink, Plus, Send, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { QueryBoundary } from '@/components/ui/QueryBoundary';
import { SectionCard } from '@/components/ui/SectionCard';
import { Switch } from '@/components/ui/Switch';
import { Skeleton } from '@/components/ui/primitives';
import { CommandBlock, useNow } from '@/features/integrations/TelegramWizardDialog';
import { apiErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { LinkWaiting, useLinkSession } from './TelegramLinkParts';
import {
  useCreateProjectLinkCode,
  useDeleteProjectChannel,
  useManagedProjects,
  usePollProjectLink,
  useProjectTelegram,
  useUpdateProjectChannel,
  type ManagedProject,
  type ProjectChannel,
  type ProjectTelegramOverview,
} from './telegramApi';
import {
  CHANNEL_EVENT_LABELS,
  channelEventsSummary,
  linkPhase,
  nextChannelEvents,
} from './telegramLink';

function ChannelRow({
  projectId,
  channel,
  eventTypes,
}: {
  projectId: string;
  channel: ProjectChannel;
  eventTypes: string[];
}) {
  const update = useUpdateProjectChannel(projectId);
  const remove = useDeleteProjectChannel(projectId);
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const id = useId();
  const selected = channel.events.length === 0 ? eventTypes : channel.events;
  const fail = (e: unknown) => toast.error(apiErrorMessage(e));

  return (
    <li className="py-3 first:pt-0 last:pb-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <Switch
            id={`${id}-enabled`}
            checked={channel.isEnabled}
            onChange={(next) =>
              update.mutate({ channelId: channel.id, isEnabled: next }, { onError: fail })
            }
            label={channel.title ?? 'Nhóm/kênh Telegram'}
            description={`${channelEventsSummary(channel.events, eventTypes)}${channel.isEnabled ? '' : ' · đang tắt'}`}
          />
        </div>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-4">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={`${id}-events`}
          onClick={() => setOpen((v) => !v)}
          className="inline-flex items-center gap-1 rounded text-xs text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] [@media(pointer:coarse)]:min-h-11"
        >
          <ChevronDown
            aria-hidden="true"
            className={cn(
              'h-3.5 w-3.5 transition-transform duration-fast motion-reduce:transition-none',
              open && 'rotate-180',
            )}
          />
          Chọn sự kiện gửi vào kênh
        </button>
        {confirming ? (
          <span className="inline-flex items-center gap-2 text-xs [@media(pointer:coarse)]:min-h-11">
            <span className="text-muted">Gỡ kênh này khỏi dự án?</span>
            <Button
              type="button"
              variant="danger"
              size="sm"
              loading={remove.isPending}
              onClick={() =>
                remove.mutate(channel.id, {
                  onSuccess: () => toast.success('Đã gỡ kênh.'),
                  onError: fail,
                })
              }
            >
              Gỡ
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setConfirming(false)}>
              Không
            </Button>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="inline-flex items-center gap-1 rounded text-xs text-muted hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] [@media(pointer:coarse)]:min-h-11"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden />
            Gỡ kênh
          </button>
        )}
      </div>
      <div
        id={`${id}-events`}
        role="group"
        aria-label="Sự kiện gửi vào kênh"
        className={cn(
          'grid transition-[grid-template-rows,visibility] duration-base ease-out-quart motion-reduce:transition-none',
          open ? 'grid-rows-[1fr]' : 'invisible grid-rows-[0fr]',
        )}
      >
        <div className="overflow-hidden">
          <ul className="mt-2 space-y-1">
            {eventTypes.map((type) => {
              const meta = CHANNEL_EVENT_LABELS[type];
              const checked = selected.includes(type);
              return (
                <li key={type}>
                  <label className="flex items-start gap-2.5 text-sm text-ink [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:items-center">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => {
                        const next = nextChannelEvents(
                          channel.events,
                          eventTypes,
                          type,
                          e.target.checked,
                        );
                        if (next === null) {
                          toast.info('Kênh cần nhận ít nhất một sự kiện — hoặc tắt hẳn kênh.');
                          return;
                        }
                        update.mutate({ channelId: channel.id, events: next }, { onError: fail });
                      }}
                      className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border-border accent-[var(--primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                    />
                    <span>
                      <span className="font-medium">{meta?.label ?? type}</span>
                      {meta && <span className="block text-xs text-faint">{meta.hint}</span>}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </li>
  );
}

function LinkChannelFlow({
  projectId,
  botUsername,
  onDone,
}: {
  projectId: string;
  botUsername: string | null;
  onDone: () => void;
}) {
  const create = useCreateProjectLinkCode(projectId);
  const { session, error, creating, issue, restart, clear } = useLinkSession(create.mutateAsync);
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    issue();
  }, [issue]);
  const poll = usePollProjectLink(projectId, session?.code.code ?? null, session?.startedAt ?? 0);
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
  const linkedTitle = data?.status === 'linked' ? data.channel.title : null;
  useEffect(() => {
    if (!done) return;
    toast.success(linkedTitle ? `Đã gắn nhóm “${linkedTitle}”.` : 'Đã gắn nhóm/kênh.');
    onDone();
  }, [done, linkedTitle, onDone]);
  const name = session?.code.botUsername ?? botUsername;

  return (
    <div className="mt-3 space-y-3 rounded-md border border-border bg-surface-2 p-4">
      {session && phase !== 'linked' && (
        <>
          <ol className="list-decimal space-y-1 pl-5 text-sm text-ink">
            <li>
              Thêm bot{name ? ` @${name}` : ''} vào nhóm/kênh Telegram (kênh: thêm làm quản trị
              viên).{' '}
              {session.code.startGroupUrl && (
                <a
                  href={session.code.startGroupUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-primary hover:underline"
                >
                  Mở Telegram <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                </a>
              )}
            </li>
            <li>Gõ đúng dòng này trong nhóm/kênh đó:</li>
          </ol>
          <CommandBlock command={session.code.command} />
        </>
      )}
      <LinkWaiting
        phase={phase}
        remainingMs={session ? Date.parse(session.code.expiresAt) - now : 0}
        hint={data?.status === 'waiting' ? data.hint : undefined}
        errorHint={error ?? (data?.status === 'error' ? data.hint : undefined)}
        waitingText="Đang chờ lệnh trong nhóm/kênh…"
        doneText="Đã gắn nhóm/kênh"
        onRetry={() => {
          restart();
          void poll.refetch();
        }}
        onNewCode={issue}
      />
      {creating && !session && <span className="sr-only">Đang tạo mã</span>}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => {
          clear();
          onDone();
        }}
      >
        Đóng
      </Button>
    </div>
  );
}

function ProjectChannels({
  projectId,
  data,
}: {
  projectId: string;
  data: ProjectTelegramOverview;
}) {
  const [linking, setLinking] = useState(false);
  if (!data.botReady) {
    return (
      <p className="text-sm text-muted">
        {data.reason === 'PLATFORM_OFF'
          ? 'Tích hợp đang bị tắt toàn hệ thống — nhờ quản trị hệ thống bật lại.'
          : 'Quản trị tổ chức cần cài bot Telegram ở Kết nối › Telegram trước.'}
      </p>
    );
  }
  return (
    <div>
      {data.channels.length === 0 && !linking ? (
        <p className="text-sm text-muted">
          Chưa có nhóm/kênh nào. Gắn một nhóm/kênh để dự án gửi thông báo vào Telegram.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {data.channels.map((c) => (
            <ChannelRow key={c.id} projectId={projectId} channel={c} eventTypes={data.eventTypes} />
          ))}
        </ul>
      )}
      {linking ? (
        <LinkChannelFlow
          projectId={projectId}
          botUsername={data.botUsername}
          onDone={() => setLinking(false)}
        />
      ) : (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="mt-3"
          onClick={() => setLinking(true)}
        >
          <Plus className="h-4 w-4" aria-hidden />
          Gắn nhóm/kênh
        </Button>
      )}
    </div>
  );
}

function ProjectBlock({ project, defaultOpen }: { project: ManagedProject; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  // Chỉ tải kênh khi mở (quản trị tổ chức có thể quản trị hàng trăm dự án).
  const query = useProjectTelegram(open ? project.id : null);
  return (
    <li className="py-2 first:pt-0 last:pb-0">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 rounded text-left text-sm font-medium text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] [@media(pointer:coarse)]:min-h-11"
      >
        <ChevronDown
          aria-hidden="true"
          className={cn(
            'h-4 w-4 shrink-0 text-muted transition-transform duration-fast motion-reduce:transition-none',
            !open && '-rotate-90',
          )}
        />
        <span className="font-mono text-xs text-faint">{project.key}</span>
        <span className="min-w-0 truncate">{project.name}</span>
      </button>
      {open && (
        <div id={id} className="mt-2 pl-6">
          <QueryBoundary query={query} skeleton={<Skeleton className="h-16 w-full" />}>
            {(data) => <ProjectChannels projectId={project.id} data={data} />}
          </QueryBoundary>
        </div>
      )}
    </li>
  );
}

/**
 * "Kênh Telegram của dự án" — CHỈ hiện với người là Project Admin của ít nhất một dự án (quản trị tổ chức: mọi dự án).
 * Lỗi/đang tải: không hiện gì (mục phụ, không làm phiền người không quản trị dự án nào).
 */
export function ProjectTelegramSection() {
  const managed = useManagedProjects();
  const projects = managed.data ?? [];
  if (projects.length === 0) return null;
  return (
    <SectionCard
      data-tour="notif-telegram-projects"
      icon={<Send className="h-4 w-4" />}
      title="Kênh Telegram của dự án"
      description="Gắn nhóm hoặc kênh Telegram để cả nhóm nhận thông báo của dự án bạn quản trị. Bấm là lưu ngay."
    >
      <ul className="divide-y divide-border">
        {projects.map((p) => (
          <ProjectBlock key={p.id} project={p} defaultOpen={projects.length === 1} />
        ))}
      </ul>
    </SectionCard>
  );
}
