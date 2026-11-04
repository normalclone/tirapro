import { GitBranch } from 'lucide-react';
import { Badge } from '@/components/ui/primitives';
import { Dialog } from '@/components/ui/Dialog';
import { useConfirm } from '@/components/ui/useConfirm';
import { useRetained } from '@/lib/useRetained';
import type { Workflow } from './api';
import { DraftProvider, useDraftRegistry } from './unsavedDrafts';
import { WorkflowDetail } from './WorkflowEditor';

/**
 * Hộp thoại xem/sửa MỘT quy trình (thay cho việc mở rộng bên dưới danh sách): tiêu đề = tên + huy hiệu, nội dung là tab
 * Sơ đồ / Danh sách như trước. Gần như toàn màn hình trên máy tính, toàn màn hình trên điện thoại. Người chỉ xem thấy cùng hộp
 * thoại ở chế độ xem (các nút ghi tự ẩn theo quyền). Đóng bằng Esc/X/bấm nền trả focus về hàng đã mở; còn bản nháp chưa lưu
 * (đang gõ tên trạng thái/chuyển tiếp mới) thì hỏi trước.
 */
export function WorkflowEditDialog({
  workflow,
  onClose,
}: {
  workflow: Workflow | null;
  onClose: () => void;
}) {
  const shown = useRetained(workflow);
  const confirm = useConfirm();
  const drafts = useDraftRegistry();

  async function requestClose() {
    if (drafts.hasDrafts()) {
      const ok = await confirm({
        title: 'Bỏ thay đổi chưa lưu?',
        description:
          'Bạn đang nhập dở một trạng thái hoặc chuyển tiếp mới. Đóng bây giờ sẽ mất phần đã nhập.',
        confirmLabel: 'Bỏ thay đổi',
        destructive: true,
      });
      if (!ok) return;
    }
    onClose();
  }

  return (
    <Dialog
      open={workflow !== null}
      onOpenChange={(o) => {
        if (!o) void requestClose();
      }}
      title={shown?.name ?? 'Quy trình'}
      icon={<GitBranch className="h-4 w-4" />}
      headerExtra={
        shown && (
          <>
            {shown.isDefault && <Badge className="bg-primary-subtle text-primary">Mặc định</Badge>}
            {shown.isTemplate && <Badge className="bg-surface-2 text-muted">Mẫu</Badge>}
          </>
        )
      }
      size="xl"
      onEscapeKeyDown={(e) => {
        // Esc trong ô nhập của form đang nhập dở: chỉ huỷ form đó (chính ô xử lý), chưa đóng cả hộp thoại.
        const t = e.target as HTMLElement | null;
        if (drafts.hasDrafts() && t?.closest?.('input, textarea')) e.preventDefault();
      }}
      className="h-[calc(100dvh-2rem)] outline-none max-w-[min(96vw,1600px)] max-sm:inset-0 max-sm:h-dvh max-sm:max-h-none max-sm:w-screen max-sm:max-w-none max-sm:rounded-none"
      bodyClassName="flex min-h-0 flex-col overflow-hidden"
      onOpenAutoFocus={(e) => {
        // Không nhảy vào nút đầu tiên (hiện chú thích đè lên tiêu đề): đặt focus vào khung hộp thoại.
        e.preventDefault();
        (e.currentTarget as HTMLElement | null)?.focus?.();
      }}
      onCloseAutoFocus={(e) => {
        // Mở bằng state (không có Trigger) → tự trả focus về đúng hàng đã mở.
        const id = shown?.id;
        const row = id ? document.querySelector<HTMLElement>(`[data-workflow-row="${id}"]`) : null;
        if (row) {
          e.preventDefault();
          row.focus();
        }
      }}
    >
      {shown && (
        <DraftProvider registry={drafts}>
          <WorkflowDetail workflow={shown} />
        </DraftProvider>
      )}
    </Dialog>
  );
}
