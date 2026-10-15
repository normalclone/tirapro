import { useState } from 'react';
import { Monitor } from 'lucide-react';
import { toast } from 'sonner';
import { environmentSchema, normalizeEnvironment, type EnvironmentInput } from '@tirapro/shared';
import type { IssueDto, IssueEnvironment } from '@tirapro/types';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { SearchSelect } from '@/components/ui/SearchSelect';
import { useUpdateIssue } from '@/features/issues/api';
import { useCanEditIssue } from '@/features/projects/permissions';
import { apiErrorMessage } from '@/lib/api';
import {
  detectEnvironment,
  ENV_KIND_LABEL,
  mergeDetected,
  toDraft,
  type EnvironmentDraft,
} from './environment';
import { isBugType } from './severity';

const KIND_OPTIONS = [
  { value: '', label: '—' },
  ...Object.entries(ENV_KIND_LABEL).map(([value, label]) => ({ value, label })),
];

/**
 * Khối "Môi trường" của Bug: loại môi trường, trình duyệt, hệ điều hành, build, màn hình, URL.
 * Chỉ hiện với Bug; trống thì thu gọn thành một nút ("Thêm thông tin môi trường"), người chỉ xem thì không thấy gì.
 */
export function EnvironmentPanel({ issue }: { issue: IssueDto }) {
  const canEdit = useCanEditIssue(issue.projectId)(issue);
  const [editing, setEditing] = useState(false);
  if (!isBugType(issue.type)) return null;
  const env = issue.environment;

  if (editing && canEdit) {
    return <EnvironmentForm issue={issue} onDone={() => setEditing(false)} />;
  }
  if (!env) {
    if (!canEdit) return null;
    return (
      <div>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="inline-flex items-center gap-1.5 rounded-md text-sm font-medium text-muted transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
        >
          <Monitor className="h-3.5 w-3.5" aria-hidden="true" />
          Thêm thông tin môi trường
        </button>
      </div>
    );
  }
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm font-medium text-muted">
          <Monitor className="h-3.5 w-3.5" aria-hidden="true" />
          Môi trường
        </p>
        {canEdit && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="rounded-md px-1.5 text-xs font-medium text-muted transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
          >
            Sửa
          </button>
        )}
      </div>
      <dl className="grid grid-cols-[110px_1fr] gap-y-1.5 text-sm">
        {env.env && <Row label="Loại" value={ENV_KIND_LABEL[env.env]} />}
        {env.browser && <Row label="Trình duyệt" value={env.browser} />}
        {env.os && <Row label="Hệ điều hành" value={env.os} />}
        {env.build && <Row label="Build" value={env.build} />}
        {env.viewport && <Row label="Màn hình" value={env.viewport} />}
        {env.url && (
          <Row
            label="URL"
            value={
              <a
                href={env.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline-offset-2 hover:underline"
              >
                {env.url}
              </a>
            }
          />
        )}
      </dl>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <>
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0 break-words text-ink">{value}</dd>
    </>
  );
}

function EnvironmentForm({ issue, onDone }: { issue: IssueDto; onDone: () => void }) {
  const patch = useUpdateIssue(issue.projectId);
  const [draft, setDraft] = useState<EnvironmentDraft>(() => toDraft(issue.environment));
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof EnvironmentDraft) => (v: string) => {
    setError(null);
    setDraft((d) => ({ ...d, [k]: v }));
  };

  function fillFromSession() {
    const detected: IssueEnvironment = detectEnvironment(navigator, window.screen, window.location);
    setError(null);
    setDraft((d) => mergeDetected(d, detected));
  }

  function save() {
    const normalized = normalizeEnvironment(draft as EnvironmentInput);
    if (normalized) {
      const parsed = environmentSchema.safeParse(normalized);
      if (!parsed.success) {
        setError(parsed.error.issues[0]?.message ?? 'Thông tin môi trường không hợp lệ');
        return;
      }
    }
    patch.mutate(
      { id: issue.id, key: issue.key, patch: { environment: normalized }, version: issue.version },
      {
        onSuccess: onDone,
        onError: (e) => toast.error(apiErrorMessage(e)),
      },
    );
  }

  const id = (k: string) => `env-${issue.id}-${k}`;
  return (
    <div className="space-y-3 rounded-md border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm font-medium text-muted">
          <Monitor className="h-3.5 w-3.5" aria-hidden="true" />
          Môi trường
        </p>
        <Button type="button" variant="outline" size="sm" onClick={fillFromSession}>
          Điền từ phiên hiện tại
        </Button>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field id={id('kind')} label="Loại môi trường">
          <SearchSelect
            id={id('kind')}
            ariaLabel="Loại môi trường"
            value={draft.env}
            options={KIND_OPTIONS}
            onChange={set('env')}
            placeholder="—"
          />
        </Field>
        <Field id={id('build')} label="Build / phiên bản">
          <Input
            id={id('build')}
            value={draft.build}
            maxLength={120}
            placeholder="vd 2.3.1"
            onChange={(e) => set('build')(e.target.value)}
          />
        </Field>
        <Field id={id('browser')} label="Trình duyệt">
          <Input
            id={id('browser')}
            value={draft.browser}
            maxLength={120}
            placeholder="vd Chrome 126"
            onChange={(e) => set('browser')(e.target.value)}
          />
        </Field>
        <Field id={id('os')} label="Hệ điều hành">
          <Input
            id={id('os')}
            value={draft.os}
            maxLength={120}
            placeholder="vd macOS 14"
            onChange={(e) => set('os')(e.target.value)}
          />
        </Field>
        <Field id={id('viewport')} label="Kích thước màn hình">
          <Input
            id={id('viewport')}
            value={draft.viewport}
            maxLength={20}
            placeholder="vd 1440×900"
            onChange={(e) => set('viewport')(e.target.value)}
          />
        </Field>
        <Field id={id('url')} label="URL" className="sm:col-span-2">
          <Input
            id={id('url')}
            type="url"
            value={draft.url}
            maxLength={500}
            placeholder="https://…"
            aria-invalid={error ? true : undefined}
            onChange={(e) => set('url')(e.target.value)}
          />
        </Field>
      </div>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onDone} disabled={patch.isPending}>
          Hủy
        </Button>
        <Button type="button" size="sm" onClick={save} loading={patch.isPending}>
          Lưu
        </Button>
      </div>
    </div>
  );
}

function Field({
  id,
  label,
  className,
  children,
}: {
  id: string;
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-muted">
        {label}
      </label>
      {children}
    </div>
  );
}
