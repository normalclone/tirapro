import type { MutableRefObject } from 'react';
import { Monitor } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { SearchSelect } from '@/components/ui/SearchSelect';
import { SeverityBadge } from '@/components/ui/SeverityBadge';
import type { ProjectMeta } from '@/features/ai/api';
import { FileDrop } from '@/features/attachments/FileDrop';
import { EnvironmentFields } from '@/features/issue-edit/EnvironmentFields';
import {
  detectEnvironment,
  mergeDetected,
  type EnvironmentDraft,
} from '@/features/issue-edit/environment';

export const FIELD_LABEL = 'mb-1.5 block text-sm font-medium text-muted';

/**
 * Khối chi tiết của chế độ Nâng cao: Mức nghiêm trọng + Môi trường (chỉ Bug) và tệp đính kèm.
 * Mức mặc định + môi trường tự ghi do `useReportDetails` điền sẵn (cả ở chế độ Cơ bản).
 */
export function ReportDetails({
  isBug,
  meta,
  severityId,
  onSeverity,
  severityTouched,
  envDraft,
  onEnvDraft,
  envError,
  onEnvChange,
  files,
  onFiles,
}: {
  isBug: boolean;
  meta: ProjectMeta | undefined;
  severityId: string;
  onSeverity: (v: string) => void;
  /** Cờ do form giữ: người dùng đã tự chọn/bỏ chọn mức → không chọn sẵn lại. */
  severityTouched: MutableRefObject<boolean>;
  envDraft: EnvironmentDraft;
  onEnvDraft: (updater: (d: EnvironmentDraft) => EnvironmentDraft) => void;
  envError: string | null;
  onEnvChange: (k: keyof EnvironmentDraft) => (v: string) => void;
  files: File[];
  onFiles: (updater: (prev: File[]) => File[]) => void;
}) {
  const severities = meta?.severities ?? [];
  const selSeverity = severities.find((s) => s.id === severityId);

  return (
    <div id="ri-details" className="mt-3 space-y-4">
      {isBug && (
        <div>
          <label className={FIELD_LABEL}>Mức nghiêm trọng</label>
          <SearchSelect
            ariaLabel="Mức nghiêm trọng"
            value={severityId}
            disabled={!meta}
            onChange={(v) => {
              severityTouched.current = true;
              onSeverity(v);
            }}
            options={[
              { value: '', label: 'Chưa đánh giá' },
              ...severities.map((s) => ({ value: s.id, label: s.name, color: s.color })),
            ]}
            renderTrigger={() =>
              selSeverity ? (
                <SeverityBadge severity={selSeverity} />
              ) : (
                <span className="text-faint">Chưa đánh giá</span>
              )
            }
          />
          <p className="mt-1 text-xs text-faint">
            {selSeverity?.description ? `${selSeverity.description}. ` : ''}
            Mức nghiêm trọng = lỗi gây hại kỹ thuật đến đâu; khác với Ưu tiên (độ gấp xử lý).
          </p>
        </div>
      )}
      {isBug && (
        <div className="space-y-3 rounded-md border border-border p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 text-sm font-medium text-muted">
              <Monitor className="h-3.5 w-3.5" aria-hidden />
              Môi trường
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                onEnvDraft((d) =>
                  mergeDetected(d, detectEnvironment(navigator, window.screen, window.location)),
                )
              }
            >
              Điền từ phiên hiện tại
            </Button>
          </div>
          <EnvironmentFields
            idPrefix="ri-env"
            draft={envDraft}
            onChange={onEnvChange}
            invalid={!!envError}
          />
          {envError && (
            <p role="alert" className="text-sm text-danger">
              {envError}
            </p>
          )}
        </div>
      )}
      <div>
        <label className={FIELD_LABEL}>
          Tệp đính kèm <span className="font-normal text-faint">(tùy chọn)</span>
        </label>
        <FileDrop
          files={files}
          onAdd={(fs) => onFiles((prev) => [...prev, ...fs])}
          onRemove={(i) => onFiles((prev) => prev.filter((_, j) => j !== i))}
        />
      </div>
    </div>
  );
}
