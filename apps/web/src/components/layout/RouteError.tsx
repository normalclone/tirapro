import { isRouteErrorResponse, useRouteError } from 'react-router-dom';
import { Button, buttonVariants } from '@/components/ui/Button';
import { StatusPanel } from '@/components/ui/StatusPanel';

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
    <div className="grid h-full min-h-[50vh] place-items-center p-6">
      <StatusPanel
        variant="error"
        title="Có lỗi khi hiển thị trang này"
        description="Hãy bấm “Tải lại” để thử lần nữa. Nếu vẫn lỗi, quay về trang chính rồi báo quản trị viên."
        className="py-0"
        actions={
          <>
            <Button variant="primary" size="sm" onClick={() => window.location.reload()}>
              Tải lại
            </Button>
            <a href="/" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
              Về trang chính
            </a>
          </>
        }
      >
        {detail && <p className="mt-2 break-words font-mono text-xs text-faint">{detail}</p>}
      </StatusPanel>
    </div>
  );
}
