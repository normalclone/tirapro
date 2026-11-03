import { Plus, X } from 'lucide-react';
import { PeoplePicker, type PersonOption } from '@/components/ui/PeoplePicker';
import { Avatar } from '@/components/ui/primitives';

export interface PickedOwner {
  id: string;
  name: string;
  avatarUrl?: string | null;
}

/** Thêm `id` vào danh sách (bỏ qua nếu đã có); tên/ảnh lấy từ `options`. Người đầu danh sách là người phụ trách chính. */
export function addOwner(
  owners: PickedOwner[],
  id: string,
  options: readonly PersonOption[],
): PickedOwner[] {
  if (!id || owners.some((o) => o.id === id)) return owners;
  const o = options.find((p) => p.id === id);
  return [...owners, { id, name: o?.name ?? id, avatarUrl: o?.avatarUrl ?? null }];
}

/**
 * Chọn MỘT HOẶC NHIỀU người phụ trách: các người đã chọn hiện thành chip (bấm × để bỏ), nút "Thêm người" mở danh sách tìm.
 * Người đầu tiên là người phụ trách chính.
 */
export function OwnersPicker({
  id,
  owners,
  onChange,
  people,
}: {
  id: string;
  owners: PickedOwner[];
  onChange: (next: PickedOwner[]) => void;
  people: {
    options: PersonOption[];
    onSearchChange: (q: string) => void;
    moreHint?: boolean;
  };
}) {
  return (
    <div className="space-y-2">
      {owners.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Người phụ trách đã chọn">
          {owners.map((o, i) => (
            <li
              key={o.id}
              className="flex items-center gap-1.5 rounded-full border border-border bg-surface-2 py-0.5 pl-1 pr-1.5 text-sm"
              title={i === 0 ? 'Người phụ trách chính' : undefined}
            >
              <Avatar name={o.name} src={o.avatarUrl} size={20} />
              <span className="max-w-40 truncate text-ink">{o.name}</span>
              {i === 0 && owners.length > 1 && (
                <span className="text-[10px] text-faint">chính</span>
              )}
              <button
                type="button"
                onClick={() => onChange(owners.filter((x) => x.id !== o.id))}
                aria-label={`Bỏ ${o.name} khỏi người phụ trách`}
                className="grid h-4 w-4 place-items-center rounded-full text-faint hover:bg-surface-3 hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
              >
                <X className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <PeoplePicker
        id={id}
        value=""
        onChange={(v) => onChange(addOwner(owners, v, people.options))}
        options={people.options.filter((p) => !owners.some((o) => o.id === p.id))}
        onSearchChange={people.onSearchChange}
        moreHint={people.moreHint}
        includeEmpty={false}
        ariaLabel="Thêm người phụ trách"
        renderTrigger={() => (
          <span className="inline-flex items-center gap-1.5 text-sm text-primary">
            <Plus className="h-3.5 w-3.5" aria-hidden />
            {owners.length === 0 ? 'Chọn người phụ trách' : 'Thêm người'}
          </span>
        )}
      />
    </div>
  );
}
