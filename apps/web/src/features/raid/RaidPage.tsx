import { useMemo, useState } from 'react';
import { Pencil, Plus, ShieldAlert, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Avatar, Badge, EmptyState, Skeleton } from '@/components/ui/primitives';
import { Button } from '@/components/ui/Button';
import { SearchSelect } from '@/components/ui/SearchSelect';
import { DueBadge } from '@/components/ui/DueBadge';
import { pageContainer } from '@/components/layout/page';
import { apiErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useAuth } from '@/stores/auth';
import { useProjects } from '@/features/projects/api';
import { RaidEditorModal } from './RaidEditorModal';
import { useDeleteRaidItem, useRaidItems, type RaidItemDto, type RaidKind, type RaidStatus } from './api';
import {
  IMPACT_LABELS, PROBABILITY_LABELS, RAID_KINDS, RAID_LEVEL_LEGEND, RAID_LEVEL_META, RAID_STATUS_META,
  SCALE, raidLevelOf,
} from './constants';

const STATUS_FILTER_OPTIONS = [
  { value: '', label: 'Mọi trạng thái' },
  { value: 'OPEN', label: 'Chưa xử lý' },
  { value: 'MITIGATING', label: 'Đang xử lý' },
  { value: 'CLOSED', label: 'Đã xong' },
  { value: 'ACCEPTED', label: 'Chấp nhận, không xử lý' },
];

/** Ô ma trận đang chọn: {probability, impact}. */
interface Cell {
  p: number;
  i: number;
}

/**
 * MA TRẬN NHIỆT 5×5 — hàng = mức ảnh hưởng (5 trên cùng), cột = xác suất.
 * Mỗi ô đếm số mục; bấm ô để lọc bảng bên dưới, bấm lại để bỏ lọc.
 */
function HeatMatrix({
  items, selected, onSelect,
}: {
  items: RaidItemDto[];
  selected: Cell | null;
  onSelect: (cell: Cell | null) => void;
}) {
  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const it of items) {
      const key = `${it.probability}:${it.impact}`;
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return map;
  }, [items]);

  return (
    <section className="rounded-lg border border-border bg-surface p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2
          className="text-base font-semibold text-ink-strong"
          title="Mỗi mục được xếp vào một ô theo xác suất xảy ra (cột) và mức ảnh hưởng (hàng). Ô càng đỏ càng cần ưu tiên."
        >
          Ma trận rủi ro
        </h2>
        <p className="text-xs text-faint">Bấm một ô để chỉ xem các mục trong ô đó</p>
      </div>

      <div className="overflow-x-auto">
        <div className="flex min-w-[26rem] gap-2">
          <div className="flex shrink-0 items-center">
            <span
              className="whitespace-nowrap text-xs font-medium text-muted [writing-mode:vertical-rl] rotate-180"
              title="Mức thiệt hại nếu điều này xảy ra: 1 là không đáng kể, 5 là nghiêm trọng"
            >
              Ảnh hưởng
            </span>
          </div>

          <div className="flex-1">
            <table className="w-full border-separate border-spacing-1">
              <caption className="sr-only">
                Ma trận rủi ro 5×5: hàng là mức ảnh hưởng, cột là xác suất xảy ra, mỗi ô là số mục đang nằm ở đó
              </caption>
              <tbody>
                {[...SCALE].reverse().map((impact) => (
                  <tr key={impact}>
                    <th
                      scope="row"
                      className="w-6 pr-1 text-right text-xs font-medium tabular-nums text-faint"
                      title={`Ảnh hưởng ${impact}: ${IMPACT_LABELS[impact]}`}
                    >
                      {impact}
                    </th>
                    {SCALE.map((prob) => {
                      const count = counts.get(`${prob}:${impact}`) ?? 0;
                      const score = prob * impact;
                      const meta = RAID_LEVEL_META[raidLevelOf(score)];
                      const active = selected?.p === prob && selected?.i === impact;
                      return (
                        <td key={prob} className="p-0">
                          <button
                            type="button"
                            onClick={() => onSelect(active ? null : { p: prob, i: impact })}
                            aria-pressed={active}
                            title={
                              `Xác suất: ${PROBABILITY_LABELS[prob]} · Ảnh hưởng: ${IMPACT_LABELS[impact]}\n`
                              + `Điểm rủi ro ${score} — mức ${meta.label.toLowerCase()} · ${count} mục`
                            }
                            className={cn(
                              'flex h-11 w-full items-center justify-center rounded-md text-sm font-semibold tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
                              count === 0 ? 'bg-surface-2 text-faint' : meta.cell,
                              active && 'ring-2 ring-ink-strong ring-offset-1 ring-offset-surface',
                            )}
                          >
                            {count || ''}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td />
                  {SCALE.map((prob) => (
                    <td
                      key={prob}
                      className="pt-0.5 text-center text-xs font-medium tabular-nums text-faint"
                      title={`Xác suất ${prob}: ${PROBABILITY_LABELS[prob]}`}
                    >
                      {prob}
                    </td>
                  ))}
                </tr>
              </tfoot>
            </table>
            <p
              className="mt-1 text-center text-xs font-medium text-muted"
              title="Khả năng điều này thực sự xảy ra: 1 là rất khó, 5 là gần như chắc chắn"
            >
              Xác suất
            </p>
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2" title={RAID_LEVEL_LEGEND}>
        {(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const).map((lv) => (
          <Badge key={lv} className={RAID_LEVEL_META[lv].badge}>{RAID_LEVEL_META[lv].label}</Badge>
        ))}
        {selected && (
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto"
            title="Xem lại toàn bộ danh sách, không lọc theo ô nữa"
            onClick={() => onSelect(null)}
          >
            Bỏ lọc ô {selected.p}×{selected.i}
          </Button>
        )}
      </div>
    </section>
  );
}

function RaidRow({
  item, canManage, onEdit,
}: {
  item: RaidItemDto;
  canManage: boolean;
  onEdit: (item: RaidItemDto) => void;
}) {
  const remove = useDeleteRaidItem();
  const level = RAID_LEVEL_META[item.level];
  const status = RAID_STATUS_META[item.status];
  const closed = item.status === 'CLOSED' || item.status === 'ACCEPTED';

  async function handleRemove() {
    if (!window.confirm(`Xoá “${item.title}” khỏi danh sách theo dõi? Thao tác này không khôi phục được.`)) return;
    try {
      await remove.mutateAsync(item.id);
      toast.success('Đã xoá khỏi danh sách');
    } catch (e) {
      toast.error(apiErrorMessage(e));
    }
  }

  return (
    <tr className="border-t border-border align-top">
      <td className="px-3 py-2.5">
        <p className="text-sm font-medium text-ink">{item.title}</p>
        {item.mitigation && <p className="mt-0.5 text-xs text-muted">Cách xử lý: {item.mitigation}</p>}
        {item.project && <p className="mt-0.5 text-xs text-faint" title="Dự án liên quan">{item.project.name}</p>}
      </td>
      <td className="px-3 py-2.5">
        {item.owner ? (
          <span className="flex items-center gap-1.5" title={`Người phụ trách: ${item.owner.displayName}`}>
            <Avatar name={item.owner.displayName} src={item.owner.avatarUrl} size={22} />
            <span className="truncate text-sm text-muted">{item.owner.displayName}</span>
          </span>
        ) : (
          <span className="text-xs text-faint" title="Chưa ai nhận theo dõi mục này">Chưa gán</span>
        )}
      </td>
      <td
        className="whitespace-nowrap px-3 py-2.5"
        title={`Xác suất ${item.probability} (${PROBABILITY_LABELS[item.probability] ?? '—'}) × ảnh hưởng ${item.impact} (${IMPACT_LABELS[item.impact] ?? '—'}) = ${item.score} điểm`}
      >
        <span className="flex items-center gap-1.5">
          <span className="text-xs tabular-nums text-faint">{item.probability}×{item.impact}</span>
          <Badge className={cn('tabular-nums', level.badge)}>{item.score}</Badge>
          <span className="hidden text-xs text-muted sm:inline">{item.levelLabel}</span>
        </span>
      </td>
      <td className="whitespace-nowrap px-3 py-2.5" title={status.hint}>
        <Badge className={status.className}>{status.label}</Badge>
      </td>
      <td className="whitespace-nowrap px-3 py-2.5">
        {item.dueDate ? (
          <DueBadge issue={{ dueDate: item.dueDate, status: { category: closed ? 'DONE' : 'TODO' } }} />
        ) : (
          <span className="text-xs text-faint">—</span>
        )}
      </td>
      {canManage && (
        <td className="whitespace-nowrap px-3 py-2.5 text-right">
          <div className="flex items-center justify-end gap-1">
            <Button variant="ghost" size="icon" onClick={() => onEdit(item)} title="Sửa mục này" aria-label={`Sửa ${item.title}`}>
              <Pencil className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="text-muted hover:text-danger"
              title="Xoá khỏi danh sách theo dõi"
              aria-label={`Xoá ${item.title}`}
              loading={remove.isPending}
              onClick={() => void handleRemove()}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </td>
      )}
    </tr>
  );
}

/** RỦI RO & VƯỚNG MẮC (RAID) — tab theo loại, bảng danh sách và ma trận nhiệt 5×5. */
export function RaidPage() {
  const can = useAuth((s) => s.can);
  const canManage = can('risk:manage');

  const [kind, setKind] = useState<RaidKind>('RISK');
  const [status, setStatus] = useState<RaidStatus | ''>('');
  const [projectId, setProjectId] = useState('');
  const [cell, setCell] = useState<Cell | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<RaidItemDto | null>(null);

  const { data: items, isLoading } = useRaidItems({ kind, status, projectId });
  const { data: projects } = useProjects();

  const projectOptions = useMemo(
    () => [
      { value: '', label: 'Mọi dự án' },
      ...(projects ?? []).map((p) => ({ value: p.id, label: p.name, hint: p.key })),
    ],
    [projects],
  );

  const rows = useMemo(() => {
    const list = items ?? [];
    if (!cell) return list;
    return list.filter((i) => i.probability === cell.p && i.impact === cell.i);
  }, [items, cell]);

  const kindMeta = RAID_KINDS.find((k) => k.value === kind);

  function openCreate() {
    setEditing(null);
    setEditorOpen(true);
  }

  function openEdit(item: RaidItemDto) {
    setEditing(item);
    setEditorOpen(true);
  }

  return (
    <div className={pageContainer('lg')}>
      <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink-strong">Rủi ro &amp; vướng mắc</h1>
          <p className="mt-1 text-sm text-muted">
            Nơi ghi lại mọi thứ có thể cản tiến độ của workspace: rủi ro có thể xảy ra, giả định đang tin là đúng,
            vấn đề đang xảy ra và việc phải chờ bên khác (quốc tế gọi là sổ RAID). Điểm rủi ro = xác suất × mức ảnh hưởng,
            mục đáng lo nhất luôn nằm trên cùng.
          </p>
        </div>
        {canManage && (
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" /> Thêm {kindMeta?.label.toLowerCase() ?? 'mục'}
          </Button>
        )}
      </header>

      <div
        className="mb-5 flex gap-1 overflow-x-auto border-b border-border"
        role="tablist"
        aria-label="Loại rủi ro và vướng mắc"
      >
        {RAID_KINDS.map((k) => (
          <button
            key={k.value}
            role="tab"
            aria-selected={kind === k.value}
            title={k.description}
            onClick={() => { setKind(k.value); setCell(null); }}
            className={cn(
              '-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
              kind === k.value ? 'border-primary text-ink-strong' : 'border-transparent text-muted hover:text-ink',
            )}
          >
            {k.label}
          </button>
        ))}
      </div>

      {kindMeta && <p className="mb-4 text-sm text-muted">{kindMeta.description}</p>}

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <SearchSelect
          value={projectId}
          onChange={setProjectId}
          options={projectOptions}
          ariaLabel="Lọc theo dự án"
          placeholder="Mọi dự án"
          searchPlaceholder="Tìm dự án…"
          className="w-52"
        />
        <SearchSelect
          value={status}
          onChange={(v) => setStatus(v as RaidStatus | '')}
          options={STATUS_FILTER_OPTIONS}
          ariaLabel="Lọc theo trạng thái"
          className="w-44"
        />
        {(status || projectId || cell) && (
          <Button variant="ghost" size="sm" onClick={() => { setStatus(''); setProjectId(''); setCell(null); }}>
            Xoá bộ lọc
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      ) : (
        <div className="space-y-5">
          <HeatMatrix items={items ?? []} selected={cell} onSelect={setCell} />

          <section className="rounded-lg border border-border bg-surface">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3 sm:px-5">
              <h2 className="text-base font-semibold text-ink-strong">Danh sách chi tiết</h2>
              <span className="text-sm text-muted">
                {cell
                  ? `${rows.length} mục ở ô xác suất ${cell.p} × ảnh hưởng ${cell.i}`
                  : `${rows.length} mục`}
              </span>
            </div>

            {rows.length === 0 ? (
              <div className="p-5">
                <EmptyState
                  icon={<ShieldAlert className="h-6 w-6" />}
                  title={cell ? 'Không có mục nào trong ô này' : `Chưa có ${kindMeta?.label.toLowerCase() ?? 'mục'} nào`}
                  description={
                    cell
                      ? 'Bấm lại vào ô đang chọn trong ma trận để xem toàn bộ danh sách.'
                      : canManage
                        ? 'Ghi lại điều bạn đang lo, chấm xác suất xảy ra và mức ảnh hưởng — cả nhóm sẽ thấy ngay trên ma trận và biết việc nào cần lo trước.'
                        : 'Khi nhóm ghi nhận mục mới, bạn sẽ thấy ở đây.'
                  }
                  action={
                    canManage && !cell
                      ? (
                        <Button onClick={openCreate}>
                          <Plus className="h-4 w-4" /> Thêm {kindMeta?.label.toLowerCase() ?? 'mục'}
                        </Button>
                      )
                      : undefined
                  }
                />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[46rem] text-left">
                  <thead>
                    <tr className="text-xs font-medium text-faint">
                      <th scope="col" className="px-3 py-2">Nội dung</th>
                      <th scope="col" className="px-3 py-2" title="Người chịu trách nhiệm theo dõi và xử lý">
                        Người phụ trách
                      </th>
                      <th scope="col" className="px-3 py-2" title={RAID_LEVEL_LEGEND}>
                        Xác suất × ảnh hưởng
                      </th>
                      <th scope="col" className="px-3 py-2">Trạng thái</th>
                      <th scope="col" className="px-3 py-2" title="Ngày cần xử lý xong">Hạn xử lý</th>
                      {canManage && <th scope="col" className="px-3 py-2 text-right">Thao tác</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((item) => (
                      <RaidRow key={item.id} item={item} canManage={canManage} onEdit={openEdit} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}

      <RaidEditorModal
        open={editorOpen}
        item={editing}
        defaultKind={kind}
        onClose={() => { setEditorOpen(false); setEditing(null); }}
      />
    </div>
  );
}
