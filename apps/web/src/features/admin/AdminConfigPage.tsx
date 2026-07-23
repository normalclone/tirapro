import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { pageContainer } from '@/components/layout/page';
import { Skeleton } from '@/components/ui/primitives';
import { Button } from '@/components/ui/Button';
import { QueryError } from '@/components/ui/QueryError';
import { apiErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useAdminConfig, useUpdateFlags, type SystemFlags } from './api';
import { InfoRow } from './_ui';

/** Công tắc bật/tắt (accessible). */
function Switch({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] disabled:opacity-50',
        checked ? 'bg-primary' : 'bg-surface-3',
      )}
    >
      <span className={cn('inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform', checked ? 'translate-x-4' : 'translate-x-0.5')} />
    </button>
  );
}

function FlagRow({ label, desc, checked, onChange, disabled }: { label: string; desc: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 py-3.5">
      <div className="min-w-0">
        <div className="text-sm font-medium text-ink">{label}</div>
        <p className="mt-0.5 text-xs text-muted">{desc}</p>
      </div>
      <Switch checked={checked} onChange={onChange} disabled={disabled} />
    </div>
  );
}

const YesNo = ({ v, yes = 'Có', no = 'Không' }: { v: boolean; yes?: string; no?: string }) => (
  <span className={v ? 'text-success' : 'text-faint'}>{v ? yes : no}</span>
);

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-surface p-4">
      <h2 className="mb-1 text-sm font-semibold text-ink">{title}</h2>
      <div className="divide-y divide-border">{children}</div>
    </section>
  );
}

export function AdminConfigPage() {
  const { data, isLoading, isError, error, refetch } = useAdminConfig();
  const update = useUpdateFlags();
  const [banner, setBanner] = useState('');

  useEffect(() => { if (data) setBanner(data.flags.maintenanceBanner); }, [data]);

  function setFlag(patch: Partial<SystemFlags>) {
    update.mutate(patch, { onError: (e) => toast.error(apiErrorMessage(e)) });
  }
  function saveBanner() {
    update.mutate({ maintenanceBanner: banner }, {
      onSuccess: () => toast.success(banner.trim() ? 'Đã bật banner bảo trì' : 'Đã ẩn banner'),
      onError: (e) => toast.error(apiErrorMessage(e)),
    });
  }

  if (isError) {
    return <div className={pageContainer('md')}><QueryError error={error} onRetry={() => void refetch()} /></div>;
  }
  if (isLoading || !data) {
    return <div className={pageContainer('md')}><Skeleton className="h-96 w-full" /></div>;
  }

  const f = data.flags;
  return (
    <div className={pageContainer('md')}>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-ink-strong">Cấu hình &amp; Feature flags</h1>
        <p className="mt-1 text-sm text-muted">Cờ runtime bật/tắt ngay, không cần deploy. Cấu hình nền lấy từ biến môi trường.</p>
      </header>

      <div className="space-y-4">
        {/* Feature flags (chỉnh được) */}
        <section className="rounded-lg border border-border bg-surface p-4">
          <h2 className="mb-1 text-sm font-semibold text-ink">Feature flags</h2>
          <div className="divide-y divide-border">
            <FlagRow
              label="Cho phép đăng ký công khai"
              desc="Tắt để chỉ admin cấp tài khoản (self-signup bị chặn)."
              checked={f.signupEnabled}
              onChange={(v) => setFlag({ signupEnabled: v })}
              disabled={update.isPending}
            />
            <FlagRow
              label="Tắt khẩn cấp AI (kill-switch)"
              desc="Vô hiệu mọi tính năng AI dù đã cấu hình key — hệ thống rơi về heuristic."
              checked={f.aiKillSwitch}
              onChange={(v) => setFlag({ aiKillSwitch: v })}
              disabled={update.isPending}
            />
            <FlagRow
              label="Bật tích hợp ngoài"
              desc="Telegram, dev links… Tắt để ngưng toàn bộ tích hợp."
              checked={f.integrationsEnabled}
              onChange={(v) => setFlag({ integrationsEnabled: v })}
              disabled={update.isPending}
            />
          </div>

          <div className="mt-3 border-t border-border pt-3.5">
            <label htmlFor="banner" className="text-sm font-medium text-ink">Banner bảo trì</label>
            <p className="mt-0.5 text-xs text-muted">Hiển thị cho mọi người dùng. Để trống để ẩn.</p>
            <textarea
              id="banner"
              value={banner}
              onChange={(e) => setBanner(e.target.value)}
              rows={2}
              maxLength={500}
              placeholder="VD: Hệ thống bảo trì 22:00–23:00 hôm nay…"
              className="mt-2 w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-ink placeholder:text-faint focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
            />
            <div className="mt-2 flex justify-end">
              <Button size="sm" onClick={saveBanner} disabled={update.isPending || banner === f.maintenanceBanner}>Lưu banner</Button>
            </div>
          </div>
        </section>

        {/* Cấu hình nền (đọc từ .env) */}
        <div className="grid gap-4 md:grid-cols-2">
          <Panel title="AI">
            <InfoRow label="Bật (env)"><YesNo v={data.ai.enabled} /></InfoRow>
            <InfoRow label="ANTHROPIC_API_KEY"><YesNo v={data.ai.hasKey} yes="đã cấu hình" no="thiếu" /></InfoRow>
            <InfoRow label="Model chính">{data.ai.modelPrimary ?? '—'}</InfoRow>
            <InfoRow label="Model nhanh">{data.ai.modelFast ?? '—'}</InfoRow>
            <InfoRow label="Quota token / ws / tháng">{data.ai.monthlyQuotaPerWorkspace?.toLocaleString('vi-VN') ?? '—'}</InfoRow>
          </Panel>
          <Panel title="Embedding / Tìm kiếm ngữ nghĩa">
            <InfoRow label="Nhà cung cấp">{data.embedding.provider}</InfoRow>
            <InfoRow label="Số chiều">{data.embedding.dim ?? '—'}</InfoRow>
            <InfoRow label="API key"><YesNo v={data.embedding.hasKey} yes="đã cấu hình" no={data.embedding.provider === 'none' ? 'không dùng' : 'thiếu'} /></InfoRow>
          </Panel>
          <Panel title="Redis (realtime / cache)">
            <InfoRow label="Đã cấu hình"><YesNo v={data.redis.configured} /></InfoRow>
            <InfoRow label="Kết nối"><YesNo v={data.redis.available} yes="hoạt động" no="giảm cấp" /></InfoRow>
          </Panel>
          <Panel title="Lưu trữ & Giới hạn">
            <InfoRow label="Driver">{data.storage.driver}</InfoRow>
            <InfoRow label="Tệp tối đa">{data.storage.maxFileSizeMb ? `${data.storage.maxFileSizeMb} MB` : '—'}</InfoRow>
            <InfoRow label="S3 bucket">{data.storage.s3Bucket ?? '—'}</InfoRow>
            <InfoRow label="Rate limit">{data.throttle.limit != null ? `${data.throttle.limit} / ${data.throttle.ttl}s` : '—'}</InfoRow>
            <InfoRow label="Telegram"><YesNo v={data.integrations.telegram} yes="bật" no="tắt" /></InfoRow>
            <InfoRow label="Môi trường">{data.nodeEnv}</InfoRow>
          </Panel>
        </div>
      </div>
    </div>
  );
}
