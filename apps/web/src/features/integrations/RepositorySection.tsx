import { useState } from 'react';
import { Plus, Trash2, Check, Webhook, Copy } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { useConfirm } from '@/components/ui/useConfirm';
import { Input } from '@/components/ui/Input';
import { Badge, EmptyState, Skeleton } from '@/components/ui/primitives';
import { apiErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { PlatformLogo, RepoProviderLogo } from './PlatformLogo';
import {
  useRepositories,
  useCreateRepository,
  useDeleteRepository,
  type Repository,
  type RepositoryProvider,
} from './api';
import { QueryBoundary } from '@/components/ui/QueryBoundary';
import { SectionCard } from '@/components/ui/SectionCard';
import { SegmentedControl } from '@/components/ui/SegmentedControl';

/** Icon "kho mã" — chồng logo GitHub + GitLab để gợi ý nhóm nguồn. */
export function RepoStackIcon() {
  return (
    <span className="flex items-center" aria-hidden>
      <PlatformLogo platform="GITHUB" size={16} />
      <PlatformLogo platform="GITLAB" size={14} className="-ml-1" />
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Section 2 — Repositories                                           */
/* ------------------------------------------------------------------ */

const PROVIDER_LABEL: Record<RepositoryProvider, string> = {
  GITHUB: 'GitHub',
  GITLAB: 'GitLab',
};

export function RepositorySection() {
  const confirm = useConfirm();
  const reposQuery = useRepositories();
  const { data } = reposQuery;
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
        // integrationId của loại GITHUB/GITLAB trùng provider — backend tự khớp theo không gian làm việc.
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

  async function handleDelete(repo: Repository) {
    if (!(await confirm({ title: `Xoá repo "${repo.name}"?`, destructive: true }))) return;
    remove.mutate(repo.id, {
      onSuccess: () => toast.success('Đã xoá repo.'),
      onError: (e) => toast.error(apiErrorMessage(e)),
    });
  }

  return (
    <SectionCard
      icon={<RepoStackIcon />}
      title="Kho mã (GitHub / GitLab)"
      description="Liên kết kho mã để gắn commit và pull request vào đúng công việc, tiện theo dõi tiến độ lập trình."
    >
      <QueryBoundary
        query={reposQuery}
        skeleton={
          <div className="space-y-2">
            {Array.from({ length: 2 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        }
        empty={() => repos.length === 0 && !adding}
        emptyState={
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
        }
      >
        {() => (
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
      </QueryBoundary>

      {/* Form thêm repo */}
      {adding ? (
        <div className="mt-4 rounded-md border border-border bg-surface-2 p-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <span id="repo-provider-label" className="mb-1 block text-xs font-medium text-muted">
                Nhà cung cấp
              </span>
              <SegmentedControl<RepositoryProvider>
                ariaLabelledby="repo-provider-label"
                value={provider}
                onChange={setProvider}
                fullWidth
                options={[
                  { value: 'GITHUB', label: 'GitHub' },
                  { value: 'GITLAB', label: 'GitLab' },
                ]}
              />
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
          {copied ? (
            <Check className="h-3.5 w-3.5 text-success" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
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
