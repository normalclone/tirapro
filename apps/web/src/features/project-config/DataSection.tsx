import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Download, Upload, History } from 'lucide-react';
import { toast } from 'sonner';
import { Badge, EmptyState, Skeleton } from '@/components/ui/primitives';
import { Button } from '@/components/ui/Button';
import { apiErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useAuth } from '@/stores/auth';
import {
  useImportJobs,
  useImportCsv,
  useImportJson,
  downloadProjectExport,
  type ImportJob,
  type ImportStatus,
  type ImportResult,
} from './api';
import { QueryBoundary } from '@/components/ui/QueryBoundary';
import { SectionCard } from './SectionCard';
import { importResultMessage } from './importResult';
import { fmtDateTime } from '@/lib/dateFormat';

/** Nhãn + style cho từng trạng thái job import. */
const IMPORT_STATUS: Record<ImportStatus, { label: string; className: string }> = {
  PENDING: { label: 'Chờ xử lý', className: 'bg-surface-2 text-muted' },
  PROCESSING: { label: 'Đang xử lý', className: 'bg-primary-subtle text-primary' },
  COMPLETED: { label: 'Hoàn tất', className: 'bg-success/10 text-success' },
  FAILED: { label: 'Thất bại', className: 'bg-danger/10 text-danger' },
};

/** Thông báo kết quả import (created / failed / total + người phụ trách bị bỏ gán). */
function importResultToast(result: ImportResult) {
  const { level, text } = importResultMessage(result);
  toast[level](text);
}

/* ------------------------------------------------------------------ */
/* Section — Xuất / Nhập dữ liệu                                       */
/* ------------------------------------------------------------------ */

const CSV_HEADER_HINT = 'Summary, Type, Description, Priority, Story Points';

export function DataSection({ projectId, canImport }: { projectId?: string; canImport: boolean }) {
  const jobsQuery = useImportJobs();
  const { data: jobsData } = jobsQuery;
  const canAdminImport = useAuth((s) => s.can('workspace:admin'));
  const importCsv = useImportCsv();
  const importJson = useImportJson();

  const [exporting, setExporting] = useState(false);
  const [csv, setCsv] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const jobs = jobsData ?? [];
  const importing = importCsv.isPending || importJson.isPending;

  async function handleExport() {
    if (!projectId) return;
    setExporting(true);
    try {
      await downloadProjectExport(projectId);
    } catch (e) {
      toast.error(apiErrorMessage(e));
    } finally {
      setExporting(false);
    }
  }

  function handleImportCsv() {
    if (!projectId) return;
    const trimmed = csv.trim();
    if (!trimmed) {
      toast.error('Vui lòng dán nội dung CSV.');
      return;
    }
    importCsv.mutate(
      { projectId, csv: trimmed },
      {
        onSuccess: (result) => {
          importResultToast(result);
          setCsv('');
        },
        onError: (e) => toast.error(apiErrorMessage(e)),
      },
    );
  }

  function handleImportJsonFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Cho phép chọn lại cùng một file lần nữa.
    e.target.value = '';
    if (!file || !projectId) return;

    void file
      .text()
      .then((text) => {
        let data: unknown;
        try {
          data = JSON.parse(text);
        } catch {
          toast.error('File JSON không hợp lệ.');
          return;
        }
        importJson.mutate(
          { projectId, data },
          {
            onSuccess: (result) => importResultToast(result),
            onError: (err) => toast.error(apiErrorMessage(err)),
          },
        );
      })
      .catch(() => toast.error('Không đọc được file.'));
  }

  return (
    <SectionCard
      icon={<Download className="h-4 w-4" />}
      title="Xuất / Nhập dữ liệu"
      description="Sao lưu dự án ra tệp JSON, hoặc nhập công việc hàng loạt từ tệp CSV / JSON."
    >
      <div className="space-y-6">
        {!canImport && (
          <p className="rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-muted">
            Bạn không có quyền xuất/nhập dữ liệu. Liên hệ quản trị chung nếu cần.
          </p>
        )}

        {/* Xuất */}
        {canImport && (
          <>
            <div>
              <h3 className="text-sm font-medium text-ink-strong">Xuất dữ liệu</h3>
              <p className="mt-0.5 text-sm text-muted">
                Tải toàn bộ công việc và cấu hình dự án về dưới dạng tệp JSON.
              </p>
              <Button
                variant="secondary"
                size="sm"
                className="mt-3"
                onClick={handleExport}
                loading={exporting}
                disabled={!projectId}
              >
                <Download className="h-4 w-4" />
                Tải JSON
              </Button>
            </div>

            <hr className="border-border" />

            {/* Nhập */}
            <div>
              <h3 className="text-sm font-medium text-ink-strong">Nhập dữ liệu</h3>

              <div className="mt-3">
                <label htmlFor="import-csv" className="mb-1 block text-xs font-medium text-muted">
                  Dán CSV
                </label>
                <textarea
                  id="import-csv"
                  value={csv}
                  rows={5}
                  spellCheck={false}
                  placeholder={`${CSV_HEADER_HINT}\nĐăng nhập lỗi,Bug,Không vào được,High,3`}
                  onChange={(e) => setCsv(e.target.value)}
                  className={cn(
                    'w-full rounded-md border border-border bg-bg px-3 py-2 font-mono text-sm text-ink',
                    'placeholder:text-faint transition-colors duration-150 resize-y',
                    'focus-visible:outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
                    'disabled:opacity-50',
                  )}
                  disabled={!projectId || importing}
                />
                <p className="mt-1 text-xs text-faint">
                  Cột: <span className="font-mono">{CSV_HEADER_HINT}</span>
                </p>
                <Button
                  size="sm"
                  className="mt-3"
                  onClick={handleImportCsv}
                  loading={importCsv.isPending}
                  disabled={!projectId || importJson.isPending}
                >
                  <Upload className="h-4 w-4" />
                  Nhập CSV
                </Button>
              </div>

              <div className="mt-5">
                <span className="mb-1 block text-xs font-medium text-muted">
                  Tải lên JSON export
                </span>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="application/json,.json"
                  onChange={handleImportJsonFile}
                  disabled={!projectId || importing}
                  className="sr-only"
                />
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                  loading={importJson.isPending}
                  disabled={!projectId || importCsv.isPending}
                >
                  <Upload className="h-4 w-4" />
                  Chọn file JSON…
                </Button>
              </div>
            </div>

            {canAdminImport && (
              <p className="rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-muted">
                Chuyển từ Jira sang?{' '}
                <Link to="/settings/import" className="text-primary hover:underline">
                  Nhập từ Jira (CSV) với ghép loại, trạng thái, người dùng
                </Link>
              </p>
            )}
          </>
        )}

        {canImport && <hr className="border-border" />}

        {/* Lịch sử import */}
        <div>
          <h3 className="flex items-center gap-2 text-sm font-medium text-ink-strong">
            <History className="h-4 w-4 text-muted" />
            Lịch sử nhập
          </h3>

          <QueryBoundary
            query={jobsQuery}
            skeleton={
              <div className="mt-3 space-y-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            }
            empty={() => jobs.length === 0}
            emptyState={
              <div className="mt-3">
                <EmptyState
                  size="compact"
                  icon={<History />}
                  title="Chưa có lần nhập nào"
                  description="Lịch sử hiện sau lần nhập dữ liệu đầu tiên."
                />
              </div>
            }
          >
            {(jobList) => (
              <ul className="mt-3 divide-y divide-border">
                {jobList.map((job) => (
                  <ImportJobRow key={job.id} job={job} />
                ))}
              </ul>
            )}
          </QueryBoundary>
        </div>
      </div>
    </SectionCard>
  );
}

function ImportJobRow({ job }: { job: ImportJob }) {
  const status = IMPORT_STATUS[job.status];
  return (
    <li className="flex flex-wrap items-center gap-3 py-2.5 first:pt-0">
      <Badge className="bg-surface-2 font-mono text-faint">{job.source}</Badge>
      <Badge className={status.className}>{status.label}</Badge>
      <span className="text-sm text-muted">
        {job.processedItems}/{job.totalItems} mục
      </span>
      <span className="ml-auto font-mono text-xs text-faint">
        {fmtDateTime(job.completedAt ?? job.createdAt)}
      </span>
    </li>
  );
}
