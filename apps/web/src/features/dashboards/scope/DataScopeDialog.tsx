import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { useDashboardTemplates } from '../templatesApi';
import { DataScopePicker } from './DataScopePicker';
import { dataScopeIssue, sameScope, type DataScopeValue } from './dataScopeModel';

/**
 * Cài đặt "Dữ liệu lấy từ đâu" của một dashboard đã lưu. "Xong" áp vào BẢN NHÁP của trình soạn (có hiệu lực khi Lưu), và chỉ
 * đánh dấu "đã đổi" khi khác phạm vi đang lưu — nếu không đổi thì không gửi trường này (máy chủ giữ nguyên).
 * Ô kế thừa đi theo phạm vi mới; ô đã tự đặt dự án giữ nguyên.
 */
export function DataScopeDialog({
  open,
  onOpenChange,
  current,
  chosen,
  onApply,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Phạm vi đang lưu trên máy chủ. */
  current: DataScopeValue;
  /** Phạm vi người dùng đã chọn trong bản nháp (`undefined` = chưa đổi). */
  chosen: DataScopeValue | undefined;
  onApply: (v: DataScopeValue | undefined) => void;
}) {
  const { data } = useDashboardTemplates();
  const start = chosen ?? current;
  const [draft, setDraft] = useState(start);
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) setDraft(start);
  }
  const issue = dataScopeIssue(draft);

  function apply() {
    if (issue) return;
    onApply(sameScope(draft, current) ? undefined : draft);
    onOpenChange(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Dữ liệu của bảng lấy từ đâu"
      description="Các ô không tự chọn dự án sẽ lấy số liệu theo phạm vi này. Ô đã chọn dự án riêng giữ nguyên."
      size="md"
      onSubmit={apply}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Huỷ
          </Button>
          <Button disabled={!!issue} onClick={apply}>
            Xong
          </Button>
        </>
      }
    >
      <DataScopePicker
        value={draft}
        onChange={setDraft}
        // Đang ở ORG thì vẫn giữ được (máy chủ không hỏi lại khi không đổi); chọn ORG mới chỉ dành cho quản trị viên.
        canOrg={(data?.canUseOrgScope ?? false) || current.dataScope === 'ORG'}
      />
      {issue && (
        <p role="status" className="mt-2 text-xs text-muted">
          {issue}.
        </p>
      )}
    </Dialog>
  );
}
