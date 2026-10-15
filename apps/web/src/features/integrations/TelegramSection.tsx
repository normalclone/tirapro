import { useState } from 'react';
import { Send, Plus, Trash2, ChevronDown, ChevronRight, Hash } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { useConfirm } from '@/components/ui/useConfirm';
import { Input } from '@/components/ui/Input';
import { Badge, EmptyState, Skeleton } from '@/components/ui/primitives';
import { apiErrorMessage } from '@/lib/api';
import { PlatformLogo } from './PlatformLogo';
import {
  useIntegrations,
  useCreateTelegram,
  useDeleteIntegration,
  useChannels,
  useAddChannel,
  useDeleteChannel,
  useTestIntegration,
  type Integration,
  type IntegrationStatus,
} from './api';
import { QueryBoundary } from '@/components/ui/QueryBoundary';
import { SectionCard } from './SectionCard';

const STATUS_LABEL: Record<IntegrationStatus, string> = {
  ACTIVE: 'Hoạt động',
  INACTIVE: 'Tạm dừng',
  ERROR: 'Lỗi',
};

function StatusBadge({ status }: { status: IntegrationStatus }) {
  const cls =
    status === 'ACTIVE'
      ? 'bg-surface-2 text-success'
      : status === 'ERROR'
        ? 'bg-surface-2 text-danger'
        : 'bg-surface-2 text-muted';
  return (
    <Badge className={cls} dotColor="currentColor">
      {STATUS_LABEL[status] ?? status}
    </Badge>
  );
}

/* ------------------------------------------------------------------ */
/* Section 1 — Telegram                                               */
/* ------------------------------------------------------------------ */

export function TelegramSection() {
  const confirm = useConfirm();
  const integrationsQuery = useIntegrations();
  const { data } = integrationsQuery;
  const create = useCreateTelegram();
  const remove = useDeleteIntegration();

  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [botToken, setBotToken] = useState('');

  const integrations = data ?? [];

  function resetAdd() {
    setName('');
    setBotToken('');
    setAdding(false);
  }

  function submitAdd() {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error('Vui lòng nhập tên kết nối.');
      return;
    }
    const token = botToken.trim();
    create.mutate(
      { name: trimmed, botToken: token === '' ? undefined : token },
      {
        onSuccess: () => {
          resetAdd();
          toast.success('Đã kết nối Telegram.');
        },
        onError: (e) => toast.error(apiErrorMessage(e)),
      },
    );
  }

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

  return (
    <SectionCard
      icon={<PlatformLogo platform="TELEGRAM" size={18} />}
      title="Telegram"
      description="Gửi thông báo công việc tới nhóm hoặc kênh Telegram. Bỏ trống token thì dùng bot chung của hệ thống."
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
        empty={() => integrations.length === 0 && !adding}
        emptyState={
          <EmptyState
            icon={<Send className="h-6 w-6" />}
            title="Chưa có kết nối Telegram"
            description="Nối Tirapro với Telegram để cập nhật về công việc và sprint được đẩy thẳng vào nhóm chat. Bấm Kết nối Telegram để bắt đầu."
            action={
              <Button size="sm" onClick={() => setAdding(true)}>
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
              />
            ))}
          </ul>
        )}
      </QueryBoundary>

      {/* Form kết nối */}
      {adding ? (
        <div className="mt-4 rounded-md border border-border bg-surface-2 p-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="tg-name" className="mb-1 block text-xs font-medium text-muted">
                Tên kết nối
              </label>
              <Input
                id="tg-name"
                value={name}
                autoFocus
                placeholder="VD: Nhóm Dev"
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submitAdd();
                  if (e.key === 'Escape') resetAdd();
                }}
              />
            </div>
            <div>
              <label htmlFor="tg-token" className="mb-1 block text-xs font-medium text-muted">
                Bot token <span className="text-faint">(tùy chọn)</span>
              </label>
              <Input
                id="tg-token"
                value={botToken}
                type="password"
                autoComplete="off"
                placeholder="Bỏ trống để dùng bot chung"
                onChange={(e) => setBotToken(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submitAdd();
                  if (e.key === 'Escape') resetAdd();
                }}
              />
            </div>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <Button size="sm" onClick={submitAdd} loading={create.isPending}>
              Kết nối
            </Button>
            <Button size="sm" variant="ghost" onClick={resetAdd} disabled={create.isPending}>
              Huỷ
            </Button>
          </div>
        </div>
      ) : (
        integrations.length > 0 && (
          <Button variant="secondary" size="sm" className="mt-4" onClick={() => setAdding(true)}>
            <Plus className="h-4 w-4" />
            Kết nối Telegram
          </Button>
        )
      )}
    </SectionCard>
  );
}

function TelegramRow({
  integration,
  onDelete,
  deleting,
}: {
  integration: Integration;
  onDelete: () => void;
  deleting: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const test = useTestIntegration();

  function handleTest() {
    test.mutate(integration.id, {
      onSuccess: (res) => {
        if (res.enabled === false) {
          toast.info('Chưa cấu hình bot token (global), bỏ qua gửi.');
        } else {
          toast.success(`Đã gửi ${res.sent}/${res.total}.`);
        }
      },
      onError: (e) => toast.error(apiErrorMessage(e)),
    });
  }

  return (
    <li className="rounded-md border border-border">
      <div className="flex items-center gap-3 px-3 py-2.5">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] rounded-sm"
          aria-expanded={expanded}
        >
          {expanded ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-faint" />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0 text-faint" />
          )}
          <span className="truncate text-sm font-medium text-ink">{integration.name}</span>
          <StatusBadge status={integration.status} />
          <span className="font-mono text-xs text-faint">token: ***</span>
        </button>

        <div className="flex shrink-0 items-center gap-1">
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

      {expanded && (
        <div className="border-t border-border bg-surface-2 px-3 py-3">
          <ChannelList integrationId={integration.id} />
        </div>
      )}
    </li>
  );
}

function ChannelList({ integrationId }: { integrationId: string }) {
  const confirm = useConfirm();
  const channelsQuery = useChannels(integrationId);
  const { data } = channelsQuery;
  const add = useAddChannel(integrationId);
  const remove = useDeleteChannel(integrationId);

  const [externalId, setExternalId] = useState('');
  const [title, setTitle] = useState('');

  const channels = data ?? [];

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
            Chưa có kênh nào. Thêm chat_id của nhóm hoặc kênh Telegram bên dưới.
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

      {/* Form thêm kênh */}
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
      <p className="mt-2 text-xs text-faint">
        Mặc định kênh nhận tất cả loại thông báo. Lọc theo từng loại sẽ bổ sung sau.
      </p>
    </div>
  );
}
