import { useEffect, useRef, useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { toast } from 'sonner';
import type { RoleRefDto } from '@tirapro/types';
import { Button } from '@/components/ui/Button';
import { RoleChecklist, RoleMultiSelect, type RoleOption } from '@/components/ui/RoleMultiSelect';
import { apiErrorMessage } from '@/lib/api';

/** Chế độ LƯU NGAY: mỗi lần bật/tắt vai trò gọi `onChange(bộ mới)`; `current` là nguồn sự thật (cache lạc quan). */
interface InstantRoles {
  onChange: (next: string[]) => void;
  /** Vai trò không bỏ chọn được (id → lý do), vd quản trị viên cuối cùng. */
  locked?: Record<string, string>;
  /** Vai trò không bật cũng không tắt được (id → lý do) — người không phải quản trị với vai trò quản trị (P-C14). */
  frozen?: Record<string, string>;
}

type Common = {
  trigger: React.ReactNode;
  /** Vai trò có thể chọn (đã lọc theo scope phù hợp). */
  roles: RoleOption[];
  /** Vai trò hiện tại của thành viên. */
  current: RoleRefDto[];
  /** Tiêu đề trong popover (mặc định "Vai trò"). */
  title?: string;
};
type SaveProps = Common & {
  saving: boolean;
  onSave: (roleIds: string[]) => Promise<unknown>;
  instant?: undefined;
};
type InstantProps = Common & { instant: InstantRoles };

const TITLE_HINT =
  'Vai trò quyết định người này được xem và làm gì. Chọn được nhiều vai trò — quyền là gộp của tất cả.';

/**
 * Popover sửa vai trò của một thành viên. Mặc định: multi-select ≥1 vai trò rồi Lưu (thành viên dự án).
 * `instant`: lưu ngay từng lần chọn, không có nút Lưu (thành viên không gian làm việc).
 */
export function EditRolesPopover(props: SaveProps | InstantProps) {
  const [open, setOpen] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const { instant } = props;
  const options: RoleOption[] = props.roles.map((r) => ({
    id: r.id,
    name: r.name,
    color: r.color,
  }));
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>{props.trigger}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          ref={contentRef}
          // Lưu ngay: Radix mặc định focus phần tử đầu (ô tìm) → bật bàn phím cảm ứng mỗi lần chạm. Focus dòng vai trò đầu.
          onOpenAutoFocus={
            instant
              ? (e) => {
                  e.preventDefault();
                  // Sau một khung hình: danh sách đã gắn xong (Radix gọi sự kiện này ngay lúc mở).
                  requestAnimationFrame(() =>
                    contentRef.current
                      ?.querySelector<HTMLElement>('[role=option]:not(:disabled)')
                      ?.focus(),
                  );
                }
              : undefined
          }
          align="end"
          sideOffset={6}
          className="z-dropdown w-[min(24rem,calc(100vw-2rem))] rounded-lg border border-border bg-surface p-3 shadow-lg outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
        >
          <p className="mb-2 text-sm font-medium text-ink-strong" title={TITLE_HINT}>
            {props.title ?? 'Vai trò'}
          </p>
          {instant ? (
            <InstantBody
              options={options}
              current={props.current}
              instant={instant}
              onDone={() => setOpen(false)}
            />
          ) : (
            <SaveBody
              open={open}
              options={options}
              current={props.current}
              saving={props.saving}
              onSave={props.onSave}
              onDone={() => setOpen(false)}
            />
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function InstantBody({
  options,
  current,
  instant,
  onDone,
}: {
  options: RoleOption[];
  current: RoleRefDto[];
  instant: InstantRoles;
  onDone: () => void;
}) {
  return (
    <>
      <div className="overflow-hidden rounded-md border border-border">
        <RoleChecklist
          options={options}
          value={current.map((r) => r.id)}
          onChange={instant.onChange}
          locked={instant.locked}
          frozen={instant.frozen}
          ariaLabel="Vai trò"
          autoFocusSearch={false}
        />
      </div>
      <div className="mt-3 flex items-center justify-between gap-2">
        <p className="text-xs text-muted">Thay đổi được lưu ngay khi bạn chọn.</p>
        <Button type="button" size="sm" variant="secondary" onClick={onDone}>
          Xong
        </Button>
      </div>
    </>
  );
}

function SaveBody({
  open,
  options,
  current,
  saving,
  onSave,
  onDone,
}: {
  open: boolean;
  options: RoleOption[];
  current: RoleRefDto[];
  saving: boolean;
  onSave: (roleIds: string[]) => Promise<unknown>;
  onDone: () => void;
}) {
  const [selected, setSelected] = useState<string[]>(() => current.map((r) => r.id));

  // Đồng bộ lại khi mở (phòng khi vai trò đổi từ chỗ khác).
  useEffect(() => {
    if (open) setSelected(current.map((r) => r.id));
  }, [open, current]);

  async function save() {
    if (selected.length === 0) {
      toast.error('Hãy chọn ít nhất một vai trò cho người này');
      return;
    }
    try {
      await onSave(selected);
      toast.success('Đã cập nhật vai trò. Quyền mới có hiệu lực ngay.');
      onDone();
    } catch (e) {
      toast.error(apiErrorMessage(e));
    }
  }

  return (
    <>
      <RoleMultiSelect options={options} value={selected} onChange={setSelected} />
      <div className="mt-3 flex items-center justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onDone}>
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
    </>
  );
}
