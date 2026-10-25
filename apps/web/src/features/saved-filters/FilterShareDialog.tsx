import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { SharePanel } from '@/features/sharing/SharePanel';
import {
  FILTER_COPY,
  FILTER_SHARE_KINDS,
  filterSharePatch,
  filterShareValue,
  sameShare,
  type ShareValue,
} from '@/features/sharing/shareModel';
import { shareValidation } from '@/features/dashboards/layoutOps';
import { apiErrorMessage } from '@/lib/api';
import { filterUrl } from '@/lib/copyText';
import { useOpenSession } from '@/lib/useOpenSession';
import { useUpdateFilter, type SavedFilter } from './api';
import { canChangeFilterShare } from './filterShare';

/**
 * "Chia sẻ" của một bộ lọc đã lưu: cùng `SharePanel` với bảng tổng quan (3 mức: không có nhóm). Chủ (`filter:manage`) đổi
 * mức rồi bấm "Lưu" (PATCH ngay, Cmd/Ctrl+Enter cũng lưu); người khác chỉ xem ai có quyền + sao chép liên kết
 * `/filters/:id`. Liên kết là đường dẫn trong ứng dụng — không có liên kết công khai.
 * Luôn mount (có hiệu ứng đóng): `filter = null` là đóng; mỗi lần mở là một lần mount mới nên bản nháp khởi tạo lại.
 */
export function FilterShareDialog({
  filter,
  canManage,
  onClose,
}: {
  filter: SavedFilter | null;
  canManage: boolean;
  onClose: () => void;
}) {
  const open = filter !== null;
  const session = useOpenSession(open);
  // Giữ bộ lọc cuối cùng trong lúc hiệu ứng đóng chạy (nội dung không nhảy thành trống).
  const last = useRef<SavedFilter | null>(filter);
  if (filter) last.current = filter;
  const shown = filter ?? last.current;
  if (!shown) return null;
  return (
    <ShareDialogInner
      key={session}
      open={open}
      filter={shown}
      canManage={canManage}
      onClose={onClose}
    />
  );
}

function ShareDialogInner({
  open,
  filter,
  canManage,
  onClose,
}: {
  open: boolean;
  filter: SavedFilter;
  canManage: boolean;
  onClose: () => void;
}) {
  const saved = filterShareValue(filter);
  const [draft, setDraft] = useState<ShareValue>(saved);
  const update = useUpdateFilter();
  const editable = canChangeFilterShare(filter, canManage);
  const error = shareValidation(draft.scope, draft.projectId, draft.teamId);
  const changed = !sameShare(draft, saved);

  async function save() {
    // Chặn gửi lặp: Cmd/Ctrl+Enter đi vòng qua trạng thái loading của nút.
    if (!editable || error || !changed || update.isPending) return;
    try {
      await update.mutateAsync({ id: filter.id, ...filterSharePatch(draft) });
      toast.success(`Đã đổi phạm vi chia sẻ của bộ lọc “${filter.name}”.`);
      onClose();
    } catch (e) {
      toast.error(apiErrorMessage(e));
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title="Chia sẻ bộ lọc"
      description={filter.name}
      size="md"
      onSubmit={editable ? () => void save() : undefined}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {editable ? 'Huỷ' : 'Đóng'}
          </Button>
          {editable && (
            <Button
              onClick={() => void save()}
              loading={update.isPending}
              disabled={!!error || !changed}
            >
              Lưu
            </Button>
          )}
        </>
      }
    >
      <SharePanel
        value={editable ? draft : saved}
        onChange={setDraft}
        kinds={FILTER_SHARE_KINDS}
        copy={FILTER_COPY}
        keep={{ projectId: saved.projectId }}
        link={{ url: filterUrl(filter.id), saved }}
        readOnly={!editable}
        error={editable ? error : null}
      />
    </Dialog>
  );
}
