import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Send, Plus, Trash2, ChevronDown, ChevronRight, Hash } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { useConfirm } from '@/components/ui/useConfirm';
import { useOpenSession } from '@/lib/useOpenSession';
import { Input } from '@/components/ui/Input';
import { Badge, EmptyState, Skeleton } from '@/components/ui/primitives';
import { apiErrorMessage } from '@/lib/api';
import { PlatformLogo } from './PlatformLogo';
import {
  useIntegrations,
  useDeleteIntegration,
  useChannels,
  useAddChannel,
  useDeleteChannel,
  useTestIntegration,
  type Integration,
  type TelegramHealth,
} from './api';
import { HEALTH_TONE, lastTestLabel, testToast, type StatusTone } from './telegramStatus';
import { QueryBoundary } from '@/components/ui/QueryBoundary';
import { SectionCard } from './SectionCard';
import { TelegramWizard } from './TelegramWizardDialog';
import { wizardEntry, type WizardStep } from './telegramWizard';

const TONE_CLASS: Record<StatusTone, string> = {
  success: 'bg-surface-2 text-success',
  warning: 'bg-surface-2 text-warning',
  danger: 'bg-surface-2 text-danger',
  muted: 'bg-surface-2 text-muted',
};

/** Nhãn trạng thái THẬT do server tính (không còn "Hoạt động" giả chỉ vì bản ghi tồn tại). */
function HealthBadge({ health }: { health: TelegramHealth }) {
  return (
    <Badge
      className={`shrink-0 whitespace-nowrap ${TONE_CLASS[HEALTH_TONE[health.state]]}`}
      dotColor="currentColor"
    >
      {health.label}
    </Badge>
  );
}

/* ------------------------------------------------------------------ */
/* Section 1 — Telegram                                               */
/* ------------------------------------------------------------------ */

interface WizardTarget {
  integrationId?: string;
  step: WizardStep;
}

export function TelegramSection() {
  const confirm = useConfirm();
  const integrationsQuery = useIntegrations();
  const { data } = integrationsQuery;
  const remove = useDeleteIntegration();
  const [searchParams, setSearchParams] = useSearchParams();

  const [wizard, setWizard] = useState<WizardTarget | null>(null);
  // Giữ cấu hình cuối cùng khi đóng để nội dung không nhảy trong lúc chạy hiệu ứng đóng.
  const [lastTarget, setLastTarget] = useState<WizardTarget>({ step: 'bot' });
  const session = useOpenSession(wizard !== null);

  const integrations = data ?? [];

  function openWizard(target: WizardTarget) {
    setLastTarget(target);
    setWizard(target);
  }

  // Lối vào từ checklist onboarding: /connect/integrations?wizard=telegram
  const entryHandled = useRef(false);
  useEffect(() => {
    if (entryHandled.current || searchParams.get('wizard') !== 'telegram' || !data) return;
    entryHandled.current = true;
    const target = wizardEntry(data);
    setLastTarget(target);
    setWizard(target);
    const next = new URLSearchParams(searchParams);
    next.delete('wizard');
    setSearchParams(next, { replace: true });
  }, [data, searchParams, setSearchParams]);

  async function handleDelete(it: Integration) {
    if (
      !(await confirm({
        title: `Xoá kết nối "${it.name}"? Hành động này không thể hoàn tác.`,
        destructive: true,
      }))
    )
      return;
    remove.mutate(it.id, {
      onSuccess: () => toast.success('Đã xoá kết nối.'),
      onError: (e) => toast.error(apiErrorMessage(e)),
    });
  }

  const startNew = () => openWizard({ step: 'bot' });

  return (
    <SectionCard
      icon={<PlatformLogo platform="TELEGRAM" size={18} />}
      title="Telegram"
      description="Gửi thông báo công việc tới nhóm Telegram. Kết nối từng bước: chọn bot, thêm bot vào nhóm, gõ mã liên kết, gửi thử."
    >
      <QueryBoundary
        query={integrationsQuery}
        skeleton={
          <div className="space-y-2">
            {Array.from({ length: 2 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        }
        empty={() => integrations.length === 0}
        emptyState={
          <EmptyState
            icon={<Send className="h-6 w-6" />}
            title="Chưa có kết nối Telegram"
            description="Nối Tirapro với Telegram để cập nhật về công việc và sprint được đẩy thẳng vào nhóm chat. Mất khoảng 2 phút, không cần biết chat_id."
            action={
              <Button size="sm" onClick={startNew}>
                <Plus className="h-4 w-4" />
                Kết nối Telegram
              </Button>
            }
          />
        }
      >
        {() => (
          <ul className="space-y-2.5">
            {integrations.map((it) => (
              <TelegramRow
                key={it.id}
                integration={it}
                onDelete={() => handleDelete(it)}
                deleting={remove.isPending}
                onContinue={() => openWizard({ integrationId: it.id, step: 'addToGroup' })}
              />
            ))}
          </ul>
        )}
      </QueryBoundary>

      {integrations.length > 0 && (
        <Button variant="secondary" size="sm" className="mt-4" onClick={startNew}>
          <Plus className="h-4 w-4" />
          Kết nối Telegram
        </Button>
      )}

      <TelegramWizard
        key={session}
        open={wizard !== null}
        integrationId={lastTarget.integrationId}
        initialStep={lastTarget.step}
        onClose={() => setWizard(null)}
      />
    </SectionCard>
  );
}

function TelegramRow({
  integration,
  onDelete,
  deleting,
  onContinue,
}: {
  integration: Integration;
  onDelete: () => void;
  deleting: boolean;
  /** Mở wizard ở bước thêm bot vào nhóm cho kết nối này. */
  onContinue: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const test = useTestIntegration();

  function handleTest() {
    test.mutate(integration.id, {
      onSuccess: (res) => {
        const { kind, text } = testToast(res);
        toast[kind](text);
      },
      onError: (e) => toast.error(apiErrorMessage(e)),
    });
  }

  return (
    <li className="rounded-md border border-border">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex min-w-[14rem] flex-1 items-center gap-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] rounded-sm"
          aria-expanded={expanded}
        >
          {expanded ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-faint" />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0 text-faint" />
          )}
          <span className="truncate text-sm font-medium text-ink">{integration.name}</span>
          <HealthBadge health={integration.health} />
          <span className="truncate font-mono text-xs text-faint">
            {integration.botUsername ? `@${integration.botUsername}` : 'bot chung'}
          </span>
        </button>

        <div className="flex shrink-0 items-center gap-1">
          {integration.health.state === 'NO_CHANNEL' && (
            <Button size="sm" onClick={onContinue}>
              Hoàn tất kết nối
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={handleTest}
            loading={test.isPending}
            title="Gửi tin nhắn kiểm tra tới tất cả kênh đang bật"
          >
            <Send className="h-4 w-4" />
            Kiểm tra
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={onDelete}
            disabled={deleting}
            className="text-muted hover:text-danger"
            title="Xoá kết nối"
          >
            <Trash2 className="h-4 w-4" />
            <span className="sr-only">Xoá {integration.name}</span>
          </Button>
        </div>
      </div>

      {integration.health.state !== 'READY' && (
        <p className="border-t border-border px-3 py-2 text-xs text-muted">
          {integration.health.hint}
        </p>
      )}
      {lastTestLabel(integration.lastTest) && (
        <p className="border-t border-border px-3 py-1.5 text-xs text-faint">
          {lastTestLabel(integration.lastTest)}
        </p>
      )}

      {expanded && (
        <div className="border-t border-border bg-surface-2 px-3 py-3">
          <ChannelList integrationId={integration.id} onLinkGroup={onContinue} />
        </div>
      )}
    </li>
  );
}

function ChannelList({
  integrationId,
  onLinkGroup,
}: {
  integrationId: string;
  onLinkGroup: () => void;
}) {
  const confirm = useConfirm();
  const channelsQuery = useChannels(integrationId);
  const { data } = channelsQuery;
  const remove = useDeleteChannel(integrationId);

  const [advanced, setAdvanced] = useState(false);

  const channels = data ?? [];

  async function handleDelete(channelId: string, label: string) {
    if (!(await confirm({ title: `Xoá kênh "${label}"?`, destructive: true }))) return;
    remove.mutate(channelId, {
      onSuccess: () => toast.success('Đã xoá kênh.'),
      onError: (e) => toast.error(apiErrorMessage(e)),
    });
  }

  return (
    <div>
      <p className="mb-2 text-xs font-medium text-faint">Kênh nhận thông báo</p>

      <QueryBoundary
        query={channelsQuery}
        skeleton={
          <div className="space-y-2">
            {Array.from({ length: 2 }).map((_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        }
        empty={() => channels.length === 0}
        emptyState={
          <p className="rounded-md border border-dashed border-border px-3 py-3 text-center text-xs text-muted">
            Chưa có kênh nào. Bấm &ldquo;Thêm nhóm bằng mã&rdquo; để liên kết một nhóm Telegram.
          </p>
        }
      >
        {() => (
          <ul className="divide-y divide-border rounded-md border border-border bg-surface">
            {channels.map((ch) => {
              const label = ch.title || ch.externalId;
              return (
                <li key={ch.id} className="flex items-center gap-2 px-3 py-2">
                  <Hash className="h-3.5 w-3.5 shrink-0 text-faint" aria-hidden />
                  <span className="truncate text-sm text-ink">{label}</span>
                  <span className="truncate font-mono text-xs text-faint">{ch.externalId}</span>
                  <Badge className="bg-surface-2 text-muted">
                    {ch.events.length === 0 ? 'Tất cả sự kiện' : `${ch.events.length} sự kiện`}
                  </Badge>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="ml-auto h-7 w-7 text-muted hover:text-danger"
                    onClick={() => handleDelete(ch.id, label)}
                    disabled={remove.isPending}
                    title="Xoá kênh"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    <span className="sr-only">Xoá {label}</span>
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </QueryBoundary>

      <Button variant="secondary" size="sm" className="mt-3" onClick={onLinkGroup}>
        <Plus className="h-4 w-4" />
        Thêm nhóm bằng mã
      </Button>

      <div className="mt-3">
        <button
          type="button"
          onClick={() => setAdvanced((v) => !v)}
          aria-expanded={advanced}
          className="flex items-center gap-1 rounded-sm text-xs font-medium text-muted hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
        >
          {advanced ? (
            <ChevronDown className="h-3.5 w-3.5" aria-hidden />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" aria-hidden />
          )}
          Nâng cao: nhập chat_id thủ công
        </button>
        {advanced && <ManualChannelForm integrationId={integrationId} />}
      </div>
      <p className="mt-2 text-xs text-faint">Kênh nhận mọi loại thông báo của kết nối này.</p>
    </div>
  );
}

/** Nhập chat_id thủ công — dành cho trường hợp liên kết bằng mã không dùng được (mục "Nâng cao"). */
function ManualChannelForm({ integrationId }: { integrationId: string }) {
  const add = useAddChannel(integrationId);
  const [externalId, setExternalId] = useState('');
  const [title, setTitle] = useState('');

  function submitAdd() {
    const chatId = externalId.trim();
    if (!chatId) {
      toast.error('Vui lòng nhập chat_id.');
      return;
    }
    add.mutate(
      { externalId: chatId, title: title.trim() || undefined },
      {
        onSuccess: () => {
          setExternalId('');
          setTitle('');
          toast.success('Đã thêm kênh.');
        },
        onError: (e) => toast.error(apiErrorMessage(e)),
      },
    );
  }

  return (
    <div className="mt-3 flex flex-wrap items-end gap-2">
      <div className="min-w-[9rem] flex-1">
        <label
          htmlFor={`ch-id-${integrationId}`}
          className="mb-1 block text-xs font-medium text-muted"
        >
          chat_id
        </label>
        <Input
          id={`ch-id-${integrationId}`}
          value={externalId}
          placeholder="VD: -1001234567890"
          onChange={(e) => setExternalId(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submitAdd();
          }}
        />
      </div>
      <div className="min-w-[9rem] flex-1">
        <label
          htmlFor={`ch-title-${integrationId}`}
          className="mb-1 block text-xs font-medium text-muted"
        >
          Tên hiển thị <span className="text-faint">(tùy chọn)</span>
        </label>
        <Input
          id={`ch-title-${integrationId}`}
          value={title}
          placeholder="VD: Kênh thông báo"
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submitAdd();
          }}
        />
      </div>
      <Button size="sm" onClick={submitAdd} loading={add.isPending}>
        <Plus className="h-4 w-4" />
        Thêm kênh
      </Button>
    </div>
  );
}
