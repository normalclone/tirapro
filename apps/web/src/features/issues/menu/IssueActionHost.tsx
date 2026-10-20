import { Component, lazy, Suspense, type ErrorInfo, type ReactNode } from 'react';
import { toast } from 'sonner';
import { finishIssueAction, useIssueActionStore, type IssueActionRequest } from './issueActions';

/**
 * Runner nạp lười (xem `IssueActionRunners`): hành động đầu tiên trong phiên chờ một lượt tải chunk nhỏ — yêu cầu nằm sẵn
 * trong kho (`runs`) nên KHÔNG mất, runner dựng xong mới chạy (`useOnce` hoãn sang macrotask, đúng một lần ở StrictMode).
 */
const Runner = lazy(() => import('./IssueActionRunners'));

/**
 * Tải chunk lỗi (mất mạng, bản mới vừa triển khai) → không để lỗi lan lên khung ứng dụng: báo cho người dùng và gỡ yêu cầu
 * (nếu không, nó nằm mãi trong kho). Mỗi yêu cầu có biên riêng nên hành động khác không bị ảnh hưởng.
 */
class RunnerBoundary extends Component<{ seq: number; children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('IssueActionRunner', error, info.componentStack);
    toast.error('Không tải được thao tác này. Kiểm tra kết nối rồi thử lại.');
    finishIssueAction(this.props.seq);
  }
  override render() {
    return this.state.failed ? null : this.props.children;
  }
}

/**
 * Mount MỘT lần ở khung ứng dụng (cạnh `ConfirmHost`): thực hiện hành động ghi do menu công việc yêu cầu. Mỗi yêu cầu có
 * runner riêng (key = số thứ tự) nên hai hành động liên tiếp không gạt nhau (toast thành công/Hoàn tác của hành động
 * trước vẫn còn), và runner tự gỡ khi xong việc để không giữ hook theo dự án mãi.
 */
export function IssueActionHost(): ReactNode {
  const runs = useIssueActionStore((s) => s.runs);
  return (
    <>
      {runs.map((req: IssueActionRequest) => (
        <RunnerBoundary key={req.seq} seq={req.seq}>
          <Suspense fallback={null}>
            <Runner req={req} />
          </Suspense>
        </RunnerBoundary>
      ))}
    </>
  );
}
