import { useState, type ReactNode } from 'react';
import {
  Send,
  Plus,
  Trash2,
  Check,
  ChevronDown,
  ChevronRight,
  Webhook,
  Hash,
  Copy,
  CalendarClock,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Badge, EmptyState, Skeleton } from '@/components/ui/primitives';
import { apiErrorMessage } from '@/lib/api';
import { pageContainer } from '@/components/layout/page';
import { cn } from '@/lib/utils';
import { DigestsSection } from '@/features/digests/DigestsSection';
import { PlatformLogo, RepoProviderLogo } from './PlatformLogo';
import {
  useIntegrations,
  useCreateTelegram,
  useDeleteIntegration,
  useChannels,
  useAddChannel,
  useDeleteChannel,
  useTestIntegration,
  useRepositories,
  useCreateRepository,
  useDeleteRepository,
  type Integration,
  type IntegrationStatus,
  type Repository,
  type RepositoryProvider,
} from './api';

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

/** Icon "kho mã" — chồng logo GitHub + GitLab để gợi ý nhóm nguồn. */
function RepoStackIcon() {
  return (
    <span className="flex items-center" aria-hidden>
      <PlatformLogo platform="GITHUB" size={16} />
      <PlatformLogo platform="GITLAB" size={14} className="-ml-1" />
    </span>
  );
}

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

/* ------------------------------------------------------------------ */
/* Khung section                                                      */
/* ------------------------------------------------------------------ */

function SectionCard({
  icon,
  title,
  description,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-border bg-surface">
      <div className="flex items-start gap-3 border-b border-border px-5 py-4">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-surface-2">
          {icon}
        </span>
        <div>
          <h2 className="text-base font-semibold text-ink-strong">{title}</h2>
          {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
        </div>
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

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

function TelegramSection() {
  const { data, isLoading } = useIntegrations();
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

  function handleDelete(it: Integration) {
    if (!window.confirm(`Xoá kết nối "${it.name}"? Hành động này không thể hoàn tác.`)) return;
    remove.mutate(it.id, {
      onSuccess: () => toast.success('Đã xoá kết nối.'),
      onError: (e) => toast.error(apiErrorMessage(e)),
    });
  }

  return (
    <SectionCard
      icon={<PlatformLogo platform="TELEGRAM" size={18} />}
      title="Telegram"
      description="Gửi thông báo issue tới nhóm hoặc kênh Telegram. Không nhập token = dùng bot chung của hệ thống."
    >
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : integrations.length === 0 && !adding ? (
        <EmptyState
          icon={<Send className="h-6 w-6" />}
          title="Chưa có kết nối Telegram"
          description="Kết nối Telegram để bắt đầu nhận thông báo về issue và sprint."
          action={
            <Button size="sm" onClick={() => setAdding(true)}>
              <Plus className="h-4 w-4" />
              Kết nối Telegram
            </Button>
          }
        />
      ) : (
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
  const { data, isLoading } = useChannels(integrationId);
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

  function handleDelete(channelId: string, label: string) {
    if (!window.confirm(`Xoá kênh "${label}"?`)) return;
    remove.mutate(channelId, {
      onSuccess: () => toast.success('Đã xoá kênh.'),
      onError: (e) => toast.error(apiErrorMessage(e)),
    });
  }

  return (
    <div>
      <p className="mb-2 text-xs font-medium text-faint">Kênh nhận thông báo</p>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      ) : channels.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-3 py-3 text-center text-xs text-muted">
          Chưa có kênh nào. Thêm chat_id của nhóm hoặc kênh Telegram bên dưới.
        </p>
      ) : (
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

      {/* Form thêm kênh */}
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <div className="min-w-[9rem] flex-1">
          <label htmlFor={`ch-id-${integrationId}`} className="mb-1 block text-xs font-medium text-muted">
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
          <label htmlFor={`ch-title-${integrationId}`} className="mb-1 block text-xs font-medium text-muted">
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

/* ------------------------------------------------------------------ */
/* Section 2 — Repositories                                           */
/* ------------------------------------------------------------------ */

const PROVIDER_LABEL: Record<RepositoryProvider, string> = {
  GITHUB: 'GitHub',
  GITLAB: 'GitLab',
};

function RepositorySection() {
  const { data, isLoading } = useRepositories();
  const create = useCreateRepository();
  const remove = useDeleteRepository();

  const [adding, setAdding] = useState(false);
  const [provider, setProvider] = useState<RepositoryProvider>('GITHUB');
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [externalId, setExternalId] = useState('');
  const [webhookSecret, setWebhookSecret] = useState('');

  const repos = data ?? [];

  function resetAdd() {
    setProvider('GITHUB');
    setName('');
    setUrl('');
    setExternalId('');
    setWebhookSecret('');
    setAdding(false);
  }

  function submitAdd() {
    const trimmedName = name.trim();
    const trimmedUrl = url.trim();
    const trimmedExternal = externalId.trim();
    if (!trimmedName || !trimmedUrl || !trimmedExternal) {
      toast.error('Vui lòng nhập tên, URL và externalId của repo.');
      return;
    }
    const secret = webhookSecret.trim();
    create.mutate(
      {
        // integrationId của loại GITHUB/GITLAB trùng provider — backend tự khớp theo workspace.
        integrationId: provider,
        provider,
        externalId: trimmedExternal,
        name: trimmedName,
        url: trimmedUrl,
        webhookSecret: secret === '' ? undefined : secret,
      },
      {
        onSuccess: () => {
          resetAdd();
          toast.success('Đã thêm repo.');
        },
        onError: (e) => toast.error(apiErrorMessage(e)),
      },
    );
  }

  function handleDelete(repo: Repository) {
    if (!window.confirm(`Xoá repo "${repo.name}"?`)) return;
    remove.mutate(repo.id, {
      onSuccess: () => toast.success('Đã xoá repo.'),
      onError: (e) => toast.error(apiErrorMessage(e)),
    });
  }

  return (
    <SectionCard
      icon={<RepoStackIcon />}
      title="Kho mã (GitHub / GitLab)"
      description="Liên kết repo để gắn commit và pull request với issue, theo dõi hoạt động phát triển."
    >
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : repos.length === 0 && !adding ? (
        <EmptyState
          icon={<PlatformLogo platform="GITHUB" size={24} />}
          title="Chưa có repo nào"
          description="Thêm repo GitHub hoặc GitLab để liên kết hoạt động code với dự án."
          action={
            <Button size="sm" onClick={() => setAdding(true)}>
              <Plus className="h-4 w-4" />
              Thêm repo
            </Button>
          }
        />
      ) : (
        <ul className="space-y-2.5">
          {repos.map((repo) => (
            <RepositoryRow
              key={repo.id}
              repo={repo}
              onDelete={() => handleDelete(repo)}
              deleting={remove.isPending}
            />
          ))}
        </ul>
      )}

      {/* Form thêm repo */}
      {adding ? (
        <div className="mt-4 rounded-md border border-border bg-surface-2 p-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="repo-provider" className="mb-1 block text-xs font-medium text-muted">
                Nhà cung cấp
              </label>
              <select
                id="repo-provider"
                value={provider}
                onChange={(e) => setProvider(e.target.value as RepositoryProvider)}
                className="h-9 w-full rounded-md border border-border bg-bg px-3 text-base text-ink focus-visible:outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
              >
                <option value="GITHUB">GitHub</option>
                <option value="GITLAB">GitLab</option>
              </select>
            </div>
            <div>
              <label htmlFor="repo-name" className="mb-1 block text-xs font-medium text-muted">
                Tên repo
              </label>
              <Input
                id="repo-name"
                value={name}
                autoFocus
                placeholder="org/repo"
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="repo-url" className="mb-1 block text-xs font-medium text-muted">
                URL
              </label>
              <Input
                id="repo-url"
                value={url}
                placeholder="https://github.com/org/repo"
                onChange={(e) => setUrl(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="repo-external" className="mb-1 block text-xs font-medium text-muted">
                externalId
              </label>
              <Input
                id="repo-external"
                value={externalId}
                placeholder="ID repo phía nhà cung cấp"
                onChange={(e) => setExternalId(e.target.value)}
              />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="repo-secret" className="mb-1 block text-xs font-medium text-muted">
                Webhook secret <span className="text-faint">(tùy chọn)</span>
              </label>
              <Input
                id="repo-secret"
                value={webhookSecret}
                type="password"
                autoComplete="off"
                placeholder="Bí mật để xác thực webhook"
                onChange={(e) => setWebhookSecret(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submitAdd();
                  if (e.key === 'Escape') resetAdd();
                }}
              />
            </div>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <Button size="sm" onClick={submitAdd} loading={create.isPending}>
              Thêm repo
            </Button>
            <Button size="sm" variant="ghost" onClick={resetAdd} disabled={create.isPending}>
              Huỷ
            </Button>
          </div>
        </div>
      ) : (
        repos.length > 0 && (
          <Button variant="secondary" size="sm" className="mt-4" onClick={() => setAdding(true)}>
            <Plus className="h-4 w-4" />
            Thêm repo
          </Button>
        )
      )}
    </SectionCard>
  );
}

function RepositoryRow({
  repo,
  onDelete,
  deleting,
}: {
  repo: Repository;
  onDelete: () => void;
  deleting: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const webhookPath = `POST /api/v1/dev/webhook/${repo.id}`;

  async function copyWebhook() {
    try {
      await navigator.clipboard.writeText(`/api/v1/dev/webhook/${repo.id}`);
      setCopied(true);
      toast.success('Đã sao chép đường dẫn webhook.');
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error('Không sao chép được. Vui lòng sao chép thủ công.');
    }
  }

  return (
    <li className="rounded-md border border-border px-3 py-2.5">
      <div className="flex items-center gap-2">
        <span
          className="flex items-center gap-1.5 rounded-md bg-surface-2 px-2 py-0.5 text-xs font-medium text-muted"
          title={PROVIDER_LABEL[repo.provider]}
        >
          <RepoProviderLogo provider={repo.provider} size={14} />
          {PROVIDER_LABEL[repo.provider]}
        </span>
        <span className="truncate text-sm font-medium text-ink">{repo.name}</span>
        {!repo.isEnabled && <Badge className="bg-surface-2 text-muted">Tạm dừng</Badge>}
        <Button
          variant="ghost"
          size="icon"
          onClick={onDelete}
          disabled={deleting}
          className="ml-auto text-muted hover:text-danger"
          title="Xoá repo"
        >
          <Trash2 className="h-4 w-4" />
          <span className="sr-only">Xoá {repo.name}</span>
        </Button>
      </div>

      <a
        href={repo.url}
        target="_blank"
        rel="noreferrer"
        className="mt-1 block truncate text-xs text-muted underline-offset-2 hover:text-primary hover:underline"
      >
        {repo.url}
      </a>

      <div className="mt-2 flex items-center gap-2 rounded-md border border-border bg-surface-2 px-2.5 py-1.5">
        <Webhook className="h-3.5 w-3.5 shrink-0 text-faint" aria-hidden />
        <code className="min-w-0 flex-1 truncate font-mono text-xs text-muted">{webhookPath}</code>
        <button
          type="button"
          onClick={copyWebhook}
          className={cn(
            'flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted transition-colors hover:bg-surface-3 hover:text-ink',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
          )}
          title="Sao chép đường dẫn webhook"
        >
          {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
          <span className="sr-only">Sao chép đường dẫn webhook</span>
        </button>
      </div>
      <p className="mt-1.5 text-xs text-faint">
        Cấu hình đường dẫn này làm webhook trong cài đặt repo của bạn{' '}
        {repo.hasWebhookSecret ? '(đã đặt secret).' : '(chưa có secret).'}
      </p>
    </li>
  );
}
