import { isRouteErrorResponse, useRouteError } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/Button';

/** Tách thông điệp lỗi route thành chuỗi ngắn để hiển thị (chỉ phục vụ chẩn đoán, không lộ stack). */
function describeError(error: unknown): string | null {
  if (isRouteErrorResponse(error)) return `${error.status} ${error.statusText}`.trim();
  if (error instanceof Error && error.message) return error.message;
  return null;
}

/**
 * Màn lỗi cho `errorElement` của router — thay màn "Unexpected Application Error" mặc định của
 * react-router khi một trang ném lỗi lúc render (kể cả lỗi tải chunk lazy sau khi triển khai bản mới).
 */
export function RouteError() {
  const error = useRouteError();
  const detail = describeError(error);
  // Dùng thẻ <a> (tải trang mới) thay vì <Link>: khi router đang lỗi, điều hướng client có thể kẹt.
  return (
    <div role="alert" className="grid h-full min-h-[50vh] place-items-center p-6">
      <div className="w-full max-w-md text-center">
        <span className="mx-auto grid h-10 w-10 place-items-center rounded-full bg-danger/10 text-danger" aria-hidden>
          <AlertTriangle className="h-5 w-5" />
        </span>
        <h1 className="mt-3 text-lg font-semibold text-ink-strong">Có lỗi khi hiển thị trang này</h1>
        <p className="mt-1 text-sm text-muted">
          Hãy bấm “Tải lại” để thử lần nữa. Nếu vẫn lỗi, quay về trang chính rồi báo quản trị viên.
        </p>
        {detail && <p className="mt-2 break-words font-mono text-xs text-faint">{detail}</p>}
        <div className="mt-5 flex items-center justify-center gap-2">
          <Button variant="primary" size="sm" onClick={() => window.location.reload()}>
            Tải lại
          </Button>
          <a
            href="/"
            className="inline-flex h-8 items-center justify-center rounded-md border border-border px-3 text-sm font-medium text-ink transition-colors duration-150 hover:bg-surface-2"
          >
            Về trang chính
          </a>
        </div>
      </div>
    </div>
  );
}
