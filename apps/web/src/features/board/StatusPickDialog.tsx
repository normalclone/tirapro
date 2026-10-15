import { useRef } from 'react';
import type { KeyboardEvent } from 'react';
import { Dialog } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import { categoryColor } from '@/lib/statusColor';
import type { NextStatus } from '@/features/issues/nextStatuses';

interface Props {
  open: boolean;
  issueKey: string;
  colName: string;
  options: NextStatus[];
  onPick: (statusId: string, statusName: string) => void;
  onCancel: () => void;
}

/** Cột gom nhiều trạng thái và workflow cho phép >1 đích: hỏi chọn. ↑/↓ đổi lựa chọn, Enter chọn, Esc huỷ. */
export function StatusPickDialog({ open, issueKey, colName, options, onPick, onCancel }: Props) {
  const list = useRef<HTMLDivElement>(null);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const items = [...(list.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])];
    if (items.length === 0) return;
    e.preventDefault();
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    const step = e.key === 'ArrowDown' ? 1 : -1;
    items[(at + step + items.length) % items.length]?.focus();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onCancel()}
      title={`Chuyển ${issueKey} sang trạng thái nào?`}
      description={`Cột “${colName}” gồm nhiều trạng thái. ↑/↓ để chọn, Enter để chuyển, Esc để huỷ.`}
      size="sm"
      footer={
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Huỷ
        </Button>
      }
    >
      <div
        ref={list}
        role="group"
        aria-label="Trạng thái đích"
        onKeyDown={onKeyDown}
        className="flex flex-col gap-2"
      >
        {options.map((o) => (
          <Button
            key={o.id}
            variant="secondary"
            className="w-full justify-start"
            onClick={() => onPick(o.id, o.name)}
          >
            <span
              aria-hidden
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: categoryColor(o.category) }}
            />
            {o.name}
          </Button>
        ))}
      </div>
    </Dialog>
  );
}
