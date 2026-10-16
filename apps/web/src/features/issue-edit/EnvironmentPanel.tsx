import { useState } from 'react';
import { Monitor } from 'lucide-react';
import { toast } from 'sonner';
import { environmentSchema, normalizeEnvironment, type EnvironmentInput } from '@tirapro/shared';
import type { IssueDto, IssueEnvironment } from '@tirapro/types';
import { Button } from '@/components/ui/Button';
import { useUpdateIssue } from '@/features/issues/api';
import { useCanEditIssue } from '@/features/projects/permissions';
import { apiErrorMessage } from '@/lib/api';
import { EnvironmentFields } from './EnvironmentFields';
import {
  detectEnvironment,
  ENV_KIND_LABEL,
  mergeDetected,
  toDraft,
  type EnvironmentDraft,
} from './environment';
import { isBugType } from './severity';

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
      <EnvironmentFields
        idPrefix={`env-${issue.id}`}
        draft={draft}
        onChange={set}
        invalid={!!error}
      />
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
