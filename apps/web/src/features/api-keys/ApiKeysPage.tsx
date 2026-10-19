import { useMemo, useState } from 'react';
import {
  AlertCircle,
  BookOpen,
  Check,
  Compass,
  Copy,
  KeyRound,
  Plug,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import { toast } from 'sonner';
import { useCopyToClipboard } from '@/lib/useCopyToClipboard';
import axios from 'axios';
import { PageFrame } from '@/components/layout/PageFrame';
import { PageHeader } from '@/components/layout/PageHeader';
import { Badge, EmptyState, Skeleton } from '@/components/ui/primitives';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { QueryError } from '@/components/ui/QueryError';
import { useConfirm } from '@/components/ui/useConfirm';
import { apiErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import {
  useApiKeys,
  useCreateApiKey,
  useRevokeApiKey,
  type ApiKey,
  type CreatedApiKey,
} from './api';
import { fmtDate, fmtDateTime } from '@/lib/dateFormat';
import { SearchSelect } from '@/components/ui/SearchSelect';
import { SETTINGS_LABELS } from '@/lib/navLabels';

// Chỉ fallback localhost khi chạy dev; production để trống nếu thiếu env (không lộ URL localhost sai).
const DEV_FALLBACK = import.meta.env.DEV;
const REST_URL =
  import.meta.env.VITE_API_URL ?? (DEV_FALLBACK ? 'http://localhost:4000/api/v1' : '');
const MCP_URL = import.meta.env.VITE_MCP_URL ?? (DEV_FALLBACK ? 'http://localhost:4100/mcp' : '');
const DOCS_URL = REST_URL ? `${REST_URL.replace(/\/api\/v\d+\/?$/, '')}/api/docs` : '';
const HELP_URL = REST_URL ? `${REST_URL.replace(/\/$/, '')}/help` : '';

/** Tuỳ chọn thời hạn khoá. */
const EXPIRY_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: 'Không hết hạn' },
  { value: 30, label: '30 ngày' },
  { value: 90, label: '90 ngày' },
  { value: 365, label: '365 ngày' },
];

function CopyRow({ label, value }: { label: string; value: string }) {
  const { copied: done, copy: copyValue } = useCopyToClipboard();
  const copy = () => void copyValue(value);
  return (
    <div className="flex items-center gap-2">
      <span className="w-28 shrink-0 text-xs text-muted">{label}</span>
      <code className="min-w-0 flex-1 truncate rounded-md bg-surface-2 px-2.5 py-1.5 font-mono text-xs text-ink">
        {value}
      </code>
      <button
        type="button"
        onClick={copy}
        className="shrink-0 rounded-md border border-border p-1.5 text-muted transition-colors hover:bg-surface-2 hover:text-ink"
        title="Sao chép"
        aria-label="Sao chép"
      >
        {done ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
}

export function ApiKeysPage() {
  const { data: keys, isLoading, isError, error, refetch } = useApiKeys();
  const create = useCreateApiKey();
  const revoke = useRevokeApiKey();
  const confirm = useConfirm();
  const [name, setName] = useState('');
  const [write, setWrite] = useState(false);
  const [expiresInDays, setExpiresInDays] = useState(0);
  const [created, setCreated] = useState<CreatedApiKey | null>(null);
  const [hideRevoked, setHideRevoked] = useState(true);

  // 403 = không có quyền workspace:admin → hiện trạng thái "không có quyền" thay vì form tạo (sẽ 403).
  const forbidden = axios.isAxiosError(error) && error.response?.status === 403;

  const visibleKeys = useMemo(
    () => (keys ?? []).filter((k) => (hideRevoked ? !k.revoked : true)),
    [keys, hideRevoked],
  );
  const revokedCount = (keys ?? []).filter((k) => k.revoked).length;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    create.mutate(
      { name: name.trim(), write, expiresInDays: expiresInDays || undefined },
      {
        onSuccess: (k) => {
          setCreated(k);
          setName('');
          setWrite(false);
          setExpiresInDays(0);
        },
        onError: (err) => toast.error(apiErrorMessage(err)),
      },
    );
  }

  const { copied: copiedKey, copy: copyKeyText } = useCopyToClipboard();
  function copyFullKey() {
    if (!created) return;
    void copyKeyText(created.key);
  }

  return (
    <PageFrame size="sm">
      <PageHeader
        title={SETTINGS_LABELS.api}
        description="Cấp khoá API để phần mềm khác và trợ lý AI (MCP) khai thác dữ liệu."
      />

      {/* Điểm kết nối */}
      <section className="mb-5 rounded-lg border border-border bg-surface p-4">
        <h2 className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-ink">
          <Plug className="h-4 w-4 text-muted" /> Điểm kết nối
        </h2>
        <div className="space-y-2">
          {REST_URL && <CopyRow label="REST API" value={REST_URL} />}
          {MCP_URL && <CopyRow label="MCP (HTTP)" value={MCP_URL} />}
          <CopyRow label="Xác thực" value="Authorization: Bearer <API_KEY>" />
        </div>
        <p className="mt-3 text-xs text-muted">
          REST: gọi thẳng các endpoint (vd{' '}
          <code className="font-mono">GET /issues?projectId=…</code>). MCP: cấu hình server type
          “HTTP”, URL như trên, header Authorization = API key — trợ lý AI sẽ có các tool{' '}
          <code className="font-mono">get_context</code>,{' '}
          <code className="font-mono">list_issues</code>,{' '}
          <code className="font-mono">create_issue</code>…
        </p>
        {(DOCS_URL || HELP_URL) && (
          <div className="mt-3 flex flex-wrap gap-4 border-t border-border pt-3 text-xs">
            {DOCS_URL && (
              <a
                href={DOCS_URL}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 font-medium text-primary hover:underline"
              >
                <BookOpen className="h-3.5 w-3.5" /> Tài liệu API (Swagger)
              </a>
            )}
            {HELP_URL && (
              <a
                href={HELP_URL}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 font-medium text-primary hover:underline"
              >
                <Compass className="h-3.5 w-3.5" /> Bản đồ API (JSON)
              </a>
            )}
          </div>
        )}
      </section>

      {/* Khoá vừa tạo — hiện 1 lần */}
      {created && (
        <section className="mb-5 rounded-lg border border-warning/40 bg-warning/10 p-4">
          <div className="flex items-center gap-1.5 text-sm font-semibold text-ink">
            <TriangleAlert className="h-4 w-4 text-warning" /> Sao chép khoá ngay — chỉ hiển thị một
            lần
          </div>
          <div className="mt-2 flex items-center gap-2">
            <code className="min-w-0 flex-1 break-all rounded-md bg-surface px-2.5 py-2 font-mono text-xs text-ink">
              {created.key}
            </code>
            <button
              type="button"
              onClick={copyFullKey}
              className="shrink-0 rounded-md border border-border bg-surface p-2 text-muted transition-colors hover:bg-surface-2 hover:text-ink"
              title="Sao chép"
              aria-label="Sao chép"
            >
              {copiedKey ? (
                <Check className="h-4 w-4 text-success" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
            </button>
          </div>
          <div className="mt-2 flex justify-end">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setCreated(null);
              }}
            >
              Đã lưu, đóng
            </Button>
          </div>
        </section>
      )}

      {forbidden ? (
        <section className="flex flex-col items-center justify-center gap-3 rounded-lg border border-border bg-surface px-6 py-12 text-center">
          <span className="grid h-10 w-10 place-items-center rounded-full bg-warning/10 text-warning">
            <AlertCircle className="h-5 w-5" aria-hidden />
          </span>
          <div>
            <p className="text-sm font-medium text-ink">Không có quyền quản lý API key</p>
            <p className="mx-auto mt-1 max-w-sm text-sm text-muted">
              Chỉ quản trị chung mới tạo và quản lý được khoá API. Liên hệ quản trị chung của bạn để
              được cấp quyền.
            </p>
          </div>
        </section>
      ) : isError ? (
        <QueryError error={error} onRetry={() => void refetch()} />
      ) : (
        <>
          {/* Tạo khoá mới */}
          <form
            onSubmit={submit}
            className="mb-6 flex flex-wrap items-end gap-3 rounded-lg border border-border bg-surface p-4"
          >
            <div className="min-w-48 flex-1">
              <label htmlFor="key-name" className="mb-1.5 block text-sm font-medium text-muted">
                Tên khoá
              </label>
              <Input
                id="key-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="VD: n8n, Zapier, Claude…"
                className="text-sm"
              />
            </div>
            <div>
              <label htmlFor="key-expiry" className="mb-1.5 block text-sm font-medium text-muted">
                Thời hạn
              </label>
              <SearchSelect
                id="key-expiry"
                value={String(expiresInDays)}
                onChange={(v) => setExpiresInDays(Number(v))}
                options={EXPIRY_OPTIONS.map((o) => ({ value: String(o.value), label: o.label }))}
                className="w-48"
              />
            </div>
            <label className="inline-flex cursor-pointer items-center gap-2 py-2 text-sm text-muted">
              <input
                type="checkbox"
                checked={write}
                onChange={(e) => setWrite(e.target.checked)}
                className="h-4 w-4 rounded border-border accent-[var(--primary)]"
              />
              Cho phép ghi (tạo/sửa)
            </label>
            <Button type="submit" size="sm" disabled={create.isPending || !name.trim()}>
              Tạo khoá
            </Button>
          </form>

          {/* Bộ lọc */}
          {revokedCount > 0 && (
            <div className="mb-3 flex justify-end">
              <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-muted">
                <input
                  type="checkbox"
                  checked={hideRevoked}
                  onChange={(e) => setHideRevoked(e.target.checked)}
                  className="h-4 w-4 rounded border-border accent-[var(--primary)]"
                />
                Ẩn khoá đã thu hồi ({revokedCount})
              </label>
            </div>
          )}

          {/* Danh sách khoá */}
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          ) : visibleKeys.length === 0 ? (
            <EmptyState
              icon={<KeyRound className="h-6 w-6" />}
              title={keys && keys.length > 0 ? 'Không có khoá đang hoạt động' : 'Chưa có API key'}
              description={
                keys && keys.length > 0
                  ? 'Mọi khoá đã bị thu hồi. Bỏ lọc để xem lại.'
                  : 'Tạo khoá đầu tiên để tích hợp phần mềm ngoài hoặc MCP.'
              }
            />
          ) : (
            <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
              {visibleKeys.map((k) => (
                <KeyRow
                  key={k.id}
                  k={k}
                  revoking={revoke.isPending}
                  onRevoke={(key) => void handleRevoke(key)}
                />
              ))}
            </ul>
          )}
        </>
      )}
    </PageFrame>
  );

  async function handleRevoke(k: ApiKey) {
    const ok = await confirm({
      title: `Thu hồi khoá “${k.name}”?`,
      description: 'Mọi tích hợp dùng khoá này sẽ ngừng hoạt động.',
      confirmLabel: 'Thu hồi',
      destructive: true,
    });
    if (!ok) return;
    revoke.mutate(k.id, { onError: (e) => toast.error(apiErrorMessage(e)) });
  }
}

/** Một dòng khoá — hiện scope, thời hạn (badge "hết hạn" nếu quá hạn) và nút thu hồi. */
function KeyRow({
  k,
  revoking,
  onRevoke,
}: {
  k: ApiKey;
  revoking: boolean;
  onRevoke: (k: ApiKey) => void;
}) {
  const expired = k.expiresAt != null && new Date(k.expiresAt).getTime() < Date.now();
  return (
    <li className={cn('flex items-center gap-3 px-4 py-3', (k.revoked || expired) && 'opacity-50')}>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate font-medium text-ink">{k.name}</span>
          {k.scopes.includes('write') ? (
            <Badge className="text-primary">đọc·ghi</Badge>
          ) : (
            <Badge className="text-muted">chỉ đọc</Badge>
          )}
          {k.revoked && <Badge className="text-danger">đã thu hồi</Badge>}
          {!k.revoked && expired && <Badge className="text-danger">hết hạn</Badge>}
        </div>
        <div className="mt-0.5 font-mono text-xs text-faint">
          {k.prefix}…
          {k.lastUsedAt ? ` · dùng gần nhất ${fmtDateTime(k.lastUsedAt)}` : ' · chưa dùng'}
          {k.expiresAt
            ? ` · ${expired ? 'đã hết hạn' : 'hết hạn'} ${fmtDate(k.expiresAt)}`
            : ' · không hết hạn'}
        </div>
      </div>
      {!k.revoked && (
        <button
          type="button"
          onClick={() => onRevoke(k)}
          disabled={revoking}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-transparent px-2.5 py-1.5 text-xs font-medium text-danger transition-colors hover:bg-danger/10"
        >
          <Trash2 className="h-3.5 w-3.5" /> Thu hồi
        </button>
      )}
    </li>
  );
}
