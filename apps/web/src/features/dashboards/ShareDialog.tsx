import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { SharePanel } from '@/features/sharing/SharePanel';
import {
  DASHBOARD_COPY,
  DASHBOARD_SHARE_KINDS,
  type ShareValue,
} from '@/features/sharing/shareModel';
import { shareValidation } from './layoutOps';

export type { ShareValue };

/**
 * "Ai xem được" — 4 mức chia sẻ + "Ai có quyền xem" + "Sao chép liên kết". Dự án/nhóm mời chọn qua `SharePicker`; tính hợp
 * lệ qua `shareValidation` (cùng luật với máy chủ) trước khi cho bấm Xong. "Xong" áp vào BẢN NHÁP của trình soạn — lưu
 * bảng mới có hiệu lực. `link` chỉ có khi bảng đã lưu (có id): chưa lưu thì không có liên kết để sao chép.
 */
export function ShareDialog({
  open,
  onOpenChange,
  value,
  onApply,
  link,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: ShareValue;
  onApply: (v: ShareValue) => void;
  /** Đã lưu: liên kết trong ứng dụng + mức chia sẻ đang lưu thật. */
  link?: { url: string; saved: ShareValue };
}) {
  const [draft, setDraft] = useState(value);
  const [prevOpen, setPrevOpen] = useState(open);
  // Mở lại hộp: bắt đầu từ giá trị đang áp dụng (điều chỉnh state khi prop đổi — không cần effect).
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) setDraft(value);
  }
  const error = shareValidation(draft.scope, draft.projectId, draft.teamId);

  function apply() {
    if (error) return;
    onApply(draft);
    onOpenChange(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Ai xem được bảng tổng quan này"
      size="md"
      onSubmit={apply}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Huỷ
          </Button>
          <Button disabled={!!error} onClick={apply}>
            Xong
          </Button>
        </>
      }
    >
      <SharePanel
        value={draft}
        onChange={setDraft}
        kinds={DASHBOARD_SHARE_KINDS}
        copy={DASHBOARD_COPY}
        keep={{ projectId: value.projectId, teamId: value.teamId }}
        link={link}
        error={error}
      />
    </Dialog>
  );
}
