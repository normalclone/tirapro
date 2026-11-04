import { useState } from 'react';
import { FolderTree, Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { EmptyState, Skeleton } from '@/components/ui/primitives';
import { useConfirm } from '@/components/ui/useConfirm';
import { apiErrorMessage } from '@/lib/api';
import { ProgramEditorModal } from './ProgramEditorModal';
import { useDeleteProgram, usePrograms, type ProgramDto } from './programsApi';
import { GroupDot } from './GroupsPopover';

/**
 * "Quản lý nhóm": tạo / sửa tên, màu, người phụ trách, thời hạn / xoá nhóm dự án (quyền `program:manage` như API nhóm).
 * Mở từ trang Dự án; dùng lại hộp sửa nhóm có sẵn. Số dự án của từng nhóm do trang truyền vào (`counts`) để khớp với
 * danh sách đang hiện (cùng bộ lọc "Hiện đã lưu trữ") — không lấy số tổng của máy chủ.
 */
export function ManageGroupsDialog({
  open,
  onClose,
  counts,
}: {
  open: boolean;
  onClose: () => void;
  counts: ReadonlyMap<string, number>;
}) {
  const { data: programs, isError, isPending } = usePrograms();
  const confirm = useConfirm();
  const remove = useDeleteProgram();
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<ProgramDto | null>(null);

  function openEditor(p: ProgramDto | null) {
    setEditing(p);
    setEditorOpen(true);
  }

  async function handleDelete(p: ProgramDto) {
    const ok = await confirm({
      title: `Xoá nhóm “${p.name}”?`,
      description: 'Các dự án bên trong vẫn được giữ nguyên, chỉ tách ra khỏi nhóm này.',
      destructive: true,
    });
    if (!ok) return;
    try {
      await remove.mutateAsync(p.id);
      toast.success(`Đã xoá nhóm “${p.name}”.`);
    } catch (e) {
      toast.error(apiErrorMessage(e));
    }
  }

  const sorted = [...(programs ?? [])].sort((a, b) => a.name.localeCompare(b.name, 'vi'));

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          if (!o) onClose();
        }}
        title="Quản lý nhóm"
        description="Nhóm gom các dự án liên quan; một dự án thuộc được nhiều nhóm."
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={onClose}>
              Đóng
            </Button>
            <Button onClick={() => openEditor(null)}>
              <Plus className="h-4 w-4" /> Tạo nhóm
            </Button>
          </>
        }
      >
        {isPending ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : isError ? (
          <p role="alert" className="text-sm text-danger">
            Không tải được danh sách nhóm — thử mở lại hộp này.
          </p>
        ) : sorted.length === 0 ? (
          <EmptyState
            size="compact"
            icon={<FolderTree className="h-5 w-5" />}
            title="Chưa có nhóm nào"
            description="Tạo nhóm đầu tiên rồi gán dự án vào nhóm ở cột “Nhóm” của danh sách."
          />
        ) : (
          <ul className="divide-y divide-border rounded-md border border-border">
            {sorted.map((p) => {
              const n = counts.get(p.id) ?? 0;
              return (
                <li key={p.id} className="flex items-center gap-2.5 px-3 py-2">
                  <GroupDot color={p.color} />
                  <span className="min-w-0 flex-1 truncate text-sm text-ink">{p.name}</span>
                  <span className="shrink-0 text-xs tabular-nums text-muted">{n} dự án</span>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Sửa nhóm ${p.name}`}
                    onClick={() => openEditor(p)}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Xoá nhóm ${p.name}`}
                    onClick={() => void handleDelete(p)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </Dialog>
      <ProgramEditorModal
        open={editorOpen}
        program={editing}
        onClose={() => setEditorOpen(false)}
      />
    </>
  );
}
