import type { ReactNode } from 'react';
import { Command } from 'cmdk';

/** Một dòng hành động/điều hướng trong bảng lệnh (icon + nhãn), style dùng chung. */
export function ActionItem({
  value,
  icon,
  label,
  onSelect,
}: {
  value: string;
  icon: ReactNode;
  label: string;
  onSelect: () => void;
}) {
  return (
    <Command.Item
      value={value}
      onSelect={onSelect}
      className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm text-ink data-[selected=true]:bg-surface-2"
    >
      {icon}
      <span className="truncate">{label}</span>
    </Command.Item>
  );
}
