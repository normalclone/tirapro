import { useEffect, useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { toast } from 'sonner';
import type { RoleRefDto } from '@tirapro/types';
import { Button } from '@/components/ui/Button';
import { RoleMultiSelect, type RoleOption } from '@/components/ui/RoleMultiSelect';
import { apiErrorMessage } from '@/lib/api';

/**
 * Popover sửa vai trò của một thành viên. Multi-select ≥1 vai trò rồi Lưu.
 * Dùng chung cho thành viên workspace & thành viên dự án — chỉ khác `roles`
 * (danh sách lựa chọn) và hàm `onSave`.
 */
export function EditRolesPopover({
  trigger,
  roles,
  current,
  saving,
  onSave,
}: {
  trigger: React.ReactNode;
  /** Vai trò có thể chọn (đã lọc theo scope phù hợp). */
  roles: RoleOption[];
  /** Vai trò hiện tại của thành viên. */
  current: RoleRefDto[];
  saving: boolean;
  onSave: (roleIds: string[]) => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>(() => current.map((r) => r.id));

  // Đồng bộ lại khi mở (phòng khi vai trò đổi từ chỗ khác).
  useEffect(() => {
    if (open) setSelected(current.map((r) => r.id));
  }, [open, current]);

  const options: RoleOption[] = roles.map((r) => ({ id: r.id, name: r.name, color: r.color }));

  async function save() {
    if (selected.length === 0) {
      toast.error('Cần ít nhất một vai trò.');
      return;
    }
    try {
      await onSave(selected);
      toast.success('Đã cập nhật vai trò');
      setOpen(false);
    } catch (e) {
      toast.error(apiErrorMessage(e));
    }
  }

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>{trigger}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          className="z-dropdown w-[min(24rem,calc(100vw-2rem))] rounded-lg border border-border bg-surface p-3 shadow-lg outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
        >
          <p className="mb-2 text-sm font-medium text-ink-strong">Vai trò</p>
          <RoleMultiSelect options={options} value={selected} onChange={setSelected} />
          <div className="mt-3 flex items-center justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Huỷ
            </Button>
            <Button
              type="button"
              size="sm"
              loading={saving}
              disabled={selected.length === 0}
              onClick={() => void save()}
            >
              Lưu
            </Button>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
