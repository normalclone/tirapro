import { useId, useRef, useState, type DragEvent } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, Download, FileSpreadsheet, Upload } from 'lucide-react';
import { toast } from 'sonner';
import type { ExcelImportResult, ExcelPreviewResult } from '@tirapro/shared';
import { Button } from '@/components/ui/Button';
import { apiErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { downloadExcelTemplate, useExcelPreview, useImportExcel } from './api';
import {
  PREVIEW_TABLE_LIMIT,
  excelFileError,
  importButtonLabel,
  importSkipNote,
  previewIssueRows,
  previewSummaryText,
} from './excelImportView';
import { importResultMessage } from './importResult';

/**
 * Nhập công việc hàng loạt từ biểu mẫu Excel (đường chính): tải biểu mẫu → điền → chọn/kéo-thả tệp → xem trước lỗi
 * từng dòng/cột → Nhập. Máy chủ kiểm tra lại toàn bộ khi nhập (không tin bản xem trước).
 */
export function ExcelImportBlock({
  projectId,
  projectKey,
}: {
  projectId?: string;
  projectKey?: string;
}) {
  const inputId = useId();
  const preview = useExcelPreview();
  const importer = useImportExcel();

  const [downloading, setDownloading] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<ExcelImportResult | null>(null);
  const [onlyErrors, setOnlyErrors] = useState(true);

  const busy = preview.isPending || importer.isPending;
  const data: ExcelPreviewResult | undefined = preview.data;

  async function handleTemplate() {
    if (!projectId) return;
    setDownloading(true);
    try {
      const name = await downloadExcelTemplate(projectId);
      toast.success(`Đã tải ${name}`);
    } catch (e) {
      toast.error(apiErrorMessage(e));
    } finally {
      setDownloading(false);
    }
  }

  function reset() {
    setFile(null);
    setResult(null);
    setOnlyErrors(true);
    preview.reset();
    importer.reset();
  }

  function pick(f: File | undefined) {
    if (!f || !projectId || busy) return;
    const problem = excelFileError(f);
    if (problem) {
      toast.error(problem);
      return;
    }
    setResult(null);
    importer.reset();
    setFile(f);
    setOnlyErrors(true);
    preview.mutate({ projectId, file: f });
  }

  function handleImport() {
    if (!projectId || !file || !data || data.valid === 0) return;
    importer.mutate(
      { projectId, file },
      {
        onSuccess: (r) => {
          setResult(r);
          const { level, text } = importResultMessage(r);
          toast[level](text);
        },
        onError: (e) => toast.error(apiErrorMessage(e)),
      },
    );
  }

  return (
    <section aria-labelledby={`${inputId}-title`}>
      <h3 id={`${inputId}-title`} className="text-sm font-medium text-ink-strong">
        Nhập từ Excel
      </h3>
      <p className="mt-0.5 text-sm text-muted">
        Điền nhiều công việc cùng lúc vào biểu mẫu có sẵn danh sách chọn (loại việc, người phụ
        trách, sprint…) lấy từ cấu hình dự án. Tối đa 1000 dòng, tệp ≤ 5 MB.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void handleTemplate()}
          loading={downloading}
          disabled={!projectId}
        >
          <Download className="h-4 w-4" />
          Tải biểu mẫu Excel
        </Button>
        <span className="text-xs text-faint">Bước 1 — tải về, điền, rồi chọn tệp ở bước 2.</span>
      </div>

      {!result && (
        <DropZone
          inputId={inputId}
          disabled={!projectId}
          busy={busy}
          previewing={preview.isPending}
          importing={importer.isPending}
          fileName={file?.name}
          onPick={pick}
        />
      )}

      {preview.isError && !result && (
        <p
          role="alert"
          className="mt-3 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger"
        >
          {apiErrorMessage(preview.error)}
        </p>
      )}

      {data && !result && (
        <PreviewPanel
          data={data}
          onlyErrors={onlyErrors}
          onOnlyErrors={setOnlyErrors}
          importing={importer.isPending}
          onImport={handleImport}
        />
      )}

      {result && <ResultPanel result={result} projectKey={projectKey} onReset={reset} />}
    </section>
  );
}

/** Vùng chọn tệp: nút (bàn phím) hoặc kéo-thả; chọn xong gọi `onPick`. */
function DropZone({
  inputId,
  disabled,
  busy,
  previewing,
  importing,
  fileName,
  onPick,
}: {
  inputId: string;
  disabled: boolean;
  busy: boolean;
  previewing: boolean;
  importing: boolean;
  fileName?: string;
  onPick: (f: File | undefined) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
    onPick(e.dataTransfer.files[0]);
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        if (!busy) setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      className={cn(
        'mt-3 flex flex-col items-center gap-2 rounded-lg border border-dashed px-4 py-6 text-center transition-colors duration-150',
        dragging ? 'border-primary bg-primary-subtle' : 'border-border bg-surface-2/40',
      )}
    >
      <FileSpreadsheet className="h-5 w-5 text-faint" aria-hidden="true" />
      <p className="text-sm text-ink">
        {fileName ? (
          <span className="break-all font-medium">{fileName}</span>
        ) : (
          'Kéo thả tệp .xlsx vào đây'
        )}
      </p>
      <input
        id={inputId}
        ref={inputRef}
        type="file"
        accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        className="sr-only"
        disabled={disabled || busy}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = ''; // cho chọn lại đúng tệp vừa sửa
          onPick(f);
        }}
      />
      <Button
        variant={fileName ? 'outline' : 'secondary'}
        size="sm"
        onClick={() => inputRef.current?.click()}
        loading={previewing}
        disabled={disabled || importing}
      >
        <Upload className="h-4 w-4" />
        {fileName ? 'Chọn tệp khác' : 'Chọn tệp .xlsx…'}
      </Button>
      {previewing && (
        <p role="status" className="text-xs text-muted">
          Đang kiểm tra tệp…
        </p>
      )}
    </div>
  );
}

function PreviewPanel({
  data,
  onlyErrors,
  onOnlyErrors,
  importing,
  onImport,
}: {
  data: ExcelPreviewResult;
  onlyErrors: boolean;
  onOnlyErrors: (v: boolean) => void;
  importing: boolean;
  onImport: () => void;
}) {
  const checkId = useId();
  const showOnlyErrors = data.invalid > 0 ? onlyErrors : false;
  const all = previewIssueRows(data.rows, showOnlyErrors);
  const shown = all.slice(0, PREVIEW_TABLE_LIMIT);
  const note = importSkipNote(data);

  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <p role="status" className="text-sm font-medium text-ink-strong">
          {previewSummaryText(data)}
        </p>
        {data.invalid > 0 && (
          <label htmlFor={checkId} className="flex items-center gap-2 text-sm text-muted">
            <input
              id={checkId}
              type="checkbox"
              checked={onlyErrors}
              onChange={(e) => onOnlyErrors(e.target.checked)}
              className="h-4 w-4 accent-[var(--primary)]"
            />
            Chỉ dòng lỗi
          </label>
        )}
      </div>

      {shown.length > 0 ? (
        <div className="mt-2 max-h-80 overflow-y-auto rounded-md border border-border">
          <table className="w-full table-fixed text-left text-sm">
            <caption className="sr-only">Lỗi và cảnh báo theo từng dòng của tệp Excel</caption>
            <thead className="sticky top-0 bg-surface-2 text-xs text-muted">
              <tr>
                <th scope="col" className="w-14 px-3 py-2 font-medium">
                  Dòng
                </th>
                <th scope="col" className="hidden w-40 px-3 py-2 font-medium sm:table-cell">
                  Tiêu đề
                </th>
                <th scope="col" className="w-28 px-3 py-2 font-medium sm:w-36">
                  Cột
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Lý do
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {shown.map((r) => (
                <tr key={r.id} className="align-top">
                  <td className="px-3 py-2 font-mono text-xs text-muted">{r.row}</td>
                  <td className="hidden break-words px-3 py-2 text-ink sm:table-cell">
                    {r.summary || <span className="text-faint">(trống)</span>}
                  </td>
                  <td className="break-words px-3 py-2 text-ink">{r.column}</td>
                  <td
                    className={cn(
                      'break-words px-3 py-2',
                      r.kind === 'error' ? 'text-danger' : 'text-muted',
                    )}
                  >
                    {r.kind === 'warning' && <span className="font-medium">Lưu ý: </span>}
                    {r.message}
                    <span className="mt-0.5 block text-xs text-faint sm:hidden">
                      {r.summary || '(trống)'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-2 flex items-center gap-2 text-sm text-muted">
          <CheckCircle2 className="h-4 w-4 text-success" aria-hidden="true" />
          {data.total === 0
            ? 'Tệp chưa có dòng dữ liệu nào — hãy điền từ dòng 2 rồi chọn lại.'
            : 'Không có lỗi hay lưu ý nào.'}
        </p>
      )}
      {all.length > shown.length && (
        <p className="mt-1 text-xs text-faint">
          Đang hiện {shown.length}/{all.length} mục — sửa các lỗi đầu tiên rồi chọn lại tệp để xem
          tiếp.
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button size="sm" onClick={onImport} loading={importing} disabled={data.valid === 0}>
          <Upload className="h-4 w-4" />
          {importButtonLabel(data.valid)}
        </Button>
        {note && <p className="text-sm text-muted">{note}</p>}
      </div>
    </div>
  );
}

function ResultPanel({
  result,
  projectKey,
  onReset,
}: {
  result: ExcelImportResult;
  projectKey?: string;
  onReset: () => void;
}) {
  const { level, text } = importResultMessage(result);
  return (
    <div className="mt-4 rounded-md border border-border bg-surface-2/40 p-4">
      <p
        role="status"
        className={cn(
          'flex items-start gap-2 text-sm font-medium',
          level === 'success' ? 'text-success' : 'text-ink-strong',
        )}
      >
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        {text}
      </p>
      {result.errors.length > 0 && (
        <ul className="mt-2 space-y-1 text-sm text-muted">
          {result.errors.map((e) => (
            <li key={`${e.row}-${e.error}`} className="break-words">
              {e.error}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        {projectKey && (
          <Link
            to={`/p/${projectKey}/backlog`}
            className="text-sm text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
          >
            Xem trong Việc chờ
          </Link>
        )}
        <Button variant="secondary" size="sm" onClick={onReset}>
          Chọn tệp khác
        </Button>
      </div>
    </div>
  );
}
