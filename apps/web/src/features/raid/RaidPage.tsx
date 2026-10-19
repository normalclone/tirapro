import { useMemo, useState } from 'react';
import { DocsLink } from '@/components/ui/DocsLink';
import { Tabs, TabPanel } from '@/components/ui/Tabs';
import { Pencil, Plus, ShieldAlert, Trash2 } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { Avatar, Badge, EmptyState, Skeleton } from '@/components/ui/primitives';
import { Button } from '@/components/ui/Button';
import { ExportMenu } from '@/components/ui/ExportMenu';
import { useConfirm } from '@/components/ui/useConfirm';
import { SearchSelect } from '@/components/ui/SearchSelect';
import { DueBadge } from '@/components/ui/DueBadge';
import { PageFrame } from '@/components/layout/PageFrame';
import { PageHeader } from '@/components/layout/PageHeader';
import { SectionCard } from '@/components/ui/SectionCard';
import { MANAGE_LABELS } from '@/lib/navLabels';
import { apiErrorMessage } from '@/lib/api';
import { downloadText } from '@/lib/download';
import { cn } from '@/lib/utils';
import { useAuth } from '@/stores/auth';
import { useProjects } from '@/features/projects/api';
import { RaidEditorModal } from './RaidEditorModal';
import { raidCsv } from './exportCsv';
import {
  useDeleteRaidItem,
  useRaidItems,
  type RaidItemDto,
  type RaidKind,
  type RaidStatus,
} from './api';
import {
  IMPACT_LABELS,
  PROBABILITY_LABELS,
  RAID_KINDS,
  RAID_LEVEL_LEGEND,
  RAID_LEVEL_META,
  RAID_STATUS_META,
  SCALE,
  raidLevelOf,
} from './constants';
import { QueryBoundary } from '@/components/ui/QueryBoundary';
import { useScopeParam } from '@/lib/scopeParam';
import { ScrollX } from '@/components/ui/ScrollX';

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
  items,
  selected,
  onSelect,
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

      <div>
        <div className="flex gap-2">
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
                Ma trận rủi ro 5×5: hàng là mức ảnh hưởng, cột là xác suất xảy ra, mỗi ô là số mục
                đang nằm ở đó
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
                      const tip =
                        `Xác suất: ${PROBABILITY_LABELS[prob]} · Ảnh hưởng: ${IMPACT_LABELS[impact]}\n` +
                        `Điểm rủi ro ${score} — mức ${meta.label.toLowerCase()} · ${count} mục`;
                      return (
                        <td key={prob} className="p-0">
                          <button
                            type="button"
                            onClick={() => onSelect(active ? null : { p: prob, i: impact })}
                            aria-pressed={active}
                            title={tip}
                            aria-label={tip.replace('\n', ' · ')}
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
          <Badge key={lv} className={RAID_LEVEL_META[lv].badge}>
            {RAID_LEVEL_META[lv].label}
          </Badge>
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

/** Xoá một mục (xác nhận → xoá → thông báo) — dùng chung cho dòng bảng (≥ sm) và thẻ (< sm). */
function useRemoveRaidItem(item: RaidItemDto) {
  const confirm = useConfirm();
  const remove = useDeleteRaidItem();
  async function handleRemove() {
    if (
      !(await confirm({
        title: `Xoá “${item.title}” khỏi danh sách theo dõi?`,
        description: 'Thao tác này không khôi phục được.',
        destructive: true,
      }))
    )
      return;
    try {
      await remove.mutateAsync(item.id);
      toast.success('Đã xoá khỏi danh sách');
    } catch (e) {
      toast.error(apiErrorMessage(e));
    }
  }
  return { handleRemove, isPending: remove.isPending };
}

/** Thẻ một mục RAID cho điện thoại (< sm): mã + tiêu đề + điểm + trạng thái + người phụ trách + hạn, không cần cuộn ngang. */
function RaidCard({
  item,
  canManage,
  onEdit,
}: {
  item: RaidItemDto;
  canManage: boolean;
  onEdit: (item: RaidItemDto) => void;
}) {
  const { handleRemove, isPending } = useRemoveRaidItem(item);
  const level = RAID_LEVEL_META[item.level];
  const status = RAID_STATUS_META[item.status];
  const closed = item.status === 'CLOSED' || item.status === 'ACCEPTED';
  return (
    <li className="border-t border-border px-3 py-3">
      <div className="flex items-start gap-2">
        <p className="min-w-0 flex-1 break-words text-sm font-medium text-ink">{item.title}</p>
        <Badge
          className={cn('shrink-0 tabular-nums', level.badge)}
          title={`Xác suất ${item.probability} × ảnh hưởng ${item.impact} = ${item.score} điểm — mức ${item.levelLabel}`}
        >
          {item.score} · {item.levelLabel}
        </Badge>
      </div>
      {item.mitigation && (
        <p className="mt-1 break-words text-xs text-muted">Cách xử lý: {item.mitigation}</p>
      )}
      {item.project && <p className="mt-0.5 text-xs text-faint">{item.project.name}</p>}
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <Badge className={status.className}>{status.label}</Badge>
        {item.dueDate && (
          <DueBadge
            issue={{ dueDate: item.dueDate, status: { category: closed ? 'DONE' : 'TODO' } }}
          />
        )}
        {item.owner ? (
          <span className="flex min-w-0 items-center gap-1.5">
            <Avatar name={item.owner.displayName} src={item.owner.avatarUrl} size={20} />
            <span className="truncate text-xs text-muted">{item.owner.displayName}</span>
          </span>
        ) : (
          <span className="text-xs text-faint">Chưa gán</span>
        )}
        {canManage && (
          <div className="ml-auto flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onEdit(item)}
              title="Sửa mục này"
              aria-label={`Sửa ${item.title}`}
            >
              <Pencil className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="text-muted hover:text-danger"
              title="Xoá khỏi danh sách theo dõi"
              aria-label={`Xoá ${item.title}`}
              loading={isPending}
              onClick={() => void handleRemove()}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>
    </li>
  );
}

function RaidRow({
  item,
  canManage,
  onEdit,
}: {
  item: RaidItemDto;
  canManage: boolean;
  onEdit: (item: RaidItemDto) => void;
}) {
  const { handleRemove, isPending } = useRemoveRaidItem(item);
  const level = RAID_LEVEL_META[item.level];
  const status = RAID_STATUS_META[item.status];
  const closed = item.status === 'CLOSED' || item.status === 'ACCEPTED';

  return (
    <tr className="border-t border-border align-top">
      <td className="px-3 py-2.5">
        <p className="text-sm font-medium text-ink">{item.title}</p>
        {item.mitigation && (
          <p className="mt-0.5 text-xs text-muted">Cách xử lý: {item.mitigation}</p>
        )}
        {item.project && (
          <p className="mt-0.5 text-xs text-faint" title="Dự án liên quan">
            {item.project.name}
          </p>
        )}
      </td>
      <td className="px-3 py-2.5">
        {item.owner ? (
          <span
            className="flex items-center gap-1.5"
            title={`Người phụ trách: ${item.owner.displayName}`}
          >
            <Avatar name={item.owner.displayName} src={item.owner.avatarUrl} size={22} />
            <span className="truncate text-sm text-muted">{item.owner.displayName}</span>
          </span>
        ) : (
          <span className="text-xs text-faint" title="Chưa ai nhận theo dõi mục này">
            Chưa gán
          </span>
        )}
      </td>
      <td
        className="whitespace-nowrap px-3 py-2.5"
        title={`Xác suất ${item.probability} (${PROBABILITY_LABELS[item.probability] ?? '—'}) × ảnh hưởng ${item.impact} (${IMPACT_LABELS[item.impact] ?? '—'}) = ${item.score} điểm`}
      >
        <span className="flex items-center gap-1.5">
          <span className="text-xs tabular-nums text-faint">
            {item.probability}×{item.impact}
          </span>
          <Badge className={cn('tabular-nums', level.badge)}>{item.score}</Badge>
          <span className="hidden text-xs text-muted sm:inline">{item.levelLabel}</span>
        </span>
      </td>
      <td className="whitespace-nowrap px-3 py-2.5" title={status.hint}>
        <Badge className={status.className}>{status.label}</Badge>
      </td>
      <td className="whitespace-nowrap px-3 py-2.5">
        {item.dueDate ? (
          <DueBadge
            issue={{ dueDate: item.dueDate, status: { category: closed ? 'DONE' : 'TODO' } }}
          />
        ) : (
          <span className="text-xs text-faint">—</span>
        )}
      </td>
      {canManage && (
        <td className="whitespace-nowrap px-3 py-2.5 text-right">
          <div className="flex items-center justify-end gap-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onEdit(item)}
              title="Sửa mục này"
              aria-label={`Sửa ${item.title}`}
            >
              <Pencil className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="text-muted hover:text-danger"
              title="Xoá khỏi danh sách theo dõi"
              aria-label={`Xoá ${item.title}`}
              loading={isPending}
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
  // null = chưa chọn → mặc định theo `?project=` (lối vào từ tab dự án); chọn/xoá bộ lọc thì lựa chọn đó thắng.
  const [projectPick, setProjectId] = useState<string | null>(null);
  const [cell, setCell] = useState<Cell | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<RaidItemDto | null>(null);

  const { data: projects } = useProjects();
  const scopeParam = useScopeParam(projects);
  const projectId = projectPick ?? scopeParam ?? '';
  const raidQuery = useRaidItems({ kind, status, projectId });
  const { data: items } = raidQuery;

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
    <PageFrame size="xl">
      <PageHeader
        title={MANAGE_LABELS.risks}
        description={
          <>
            Ghi lại rủi ro, giả định, vấn đề và việc chờ bên khác có thể cản tiến độ.{' '}
            <DocsLink anchor="quan-ly-nang-cao" />
          </>
        }
        actions={
          <>
            <ExportMenu
              disabled={rows.length === 0}
              items={[
                {
                  id: 'csv',
                  label: 'Tải CSV',
                  hint: 'Đúng danh sách đang xem (theo bộ lọc)',
                  run: () =>
                    downloadText(
                      `tirapro-rui-ro-${format(new Date(), 'yyyyMMdd')}.csv`,
                      raidCsv(rows),
                    ),
                },
              ]}
            />
            {canManage && (
              <Button size="sm" onClick={openCreate}>
                <Plus className="h-4 w-4" /> Thêm {kindMeta?.label.toLowerCase() ?? 'mục'}
              </Button>
            )}
          </>
        }
      />

      <Tabs
        idBase="raid"
        ariaLabel="Loại rủi ro và vướng mắc"
        value={kind}
        onChange={(k) => {
          setKind(k);
          setCell(null);
        }}
        items={RAID_KINDS.map((k) => ({ id: k.value, label: k.label, title: k.description }))}
        className="mb-5 overflow-x-auto"
      />

      <TabPanel idBase="raid" value={kind}>
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
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setStatus('');
                setProjectId('');
                setCell(null);
              }}
            >
              Xoá bộ lọc
            </Button>
          )}
        </div>

        <QueryBoundary
          query={raidQuery}
          skeleton={
            <div className="space-y-4">
              <Skeleton className="h-64 w-full" />
              <Skeleton className="h-48 w-full" />
            </div>
          }
        >
          {() =>
            (items ?? []).length === 0 ? (
              // Chưa có mục nào (trước khi lọc ô): không vẽ ma trận 25 ô trống, chỉ nói rõ và mời thêm.
              <EmptyState
                icon={<ShieldAlert className="h-6 w-6" />}
                title={
                  status || projectId
                    ? `Không có ${kindMeta?.label.toLowerCase() ?? 'mục'} nào khớp bộ lọc`
                    : `Chưa có ${kindMeta?.label.toLowerCase() ?? 'mục'} nào`
                }
                description={
                  status || projectId
                    ? 'Bấm “Xoá bộ lọc” ở trên để xem toàn bộ.'
                    : canManage
                      ? 'Ghi lại điều bạn đang lo, chấm xác suất xảy ra và mức ảnh hưởng — ma trận rủi ro sẽ hiện ở đây ngay khi có mục đầu tiên.'
                      : 'Khi nhóm ghi nhận mục mới, ma trận rủi ro sẽ hiện ở đây.'
                }
                action={
                  canManage && !status && !projectId ? (
                    <Button variant="secondary" size="sm" onClick={openCreate}>
                      <Plus className="h-4 w-4" /> Thêm {kindMeta?.label.toLowerCase() ?? 'mục'}
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              <div className="space-y-5">
                <HeatMatrix items={items ?? []} selected={cell} onSelect={setCell} />

                <SectionCard
                  title="Danh sách chi tiết"
                  bare
                  actions={
                    <span className="text-sm text-muted">
                      {cell
                        ? `${rows.length} mục ở ô xác suất ${cell.p} × ảnh hưởng ${cell.i}`
                        : `${rows.length} mục`}
                    </span>
                  }
                >
                  {rows.length === 0 ? (
                    <div className="p-5">
                      <EmptyState
                        icon={<ShieldAlert className="h-6 w-6" />}
                        title={
                          cell
                            ? 'Không có mục nào trong ô này'
                            : `Chưa có ${kindMeta?.label.toLowerCase() ?? 'mục'} nào`
                        }
                        description={
                          cell
                            ? 'Bấm lại vào ô đang chọn trong ma trận để xem toàn bộ danh sách.'
                            : canManage
                              ? 'Ghi lại điều bạn đang lo, chấm xác suất xảy ra và mức ảnh hưởng — cả nhóm sẽ thấy ngay trên ma trận và biết việc nào cần lo trước.'
                              : 'Khi nhóm ghi nhận mục mới, bạn sẽ thấy ở đây.'
                        }
                        action={
                          canManage && !cell ? (
                            <Button variant="secondary" size="sm" onClick={openCreate}>
                              <Plus className="h-4 w-4" /> Thêm{' '}
                              {kindMeta?.label.toLowerCase() ?? 'mục'}
                            </Button>
                          ) : undefined
                        }
                      />
                    </div>
                  ) : (
                    <>
                      {/* < sm: danh sách thẻ (bảng 46rem không vừa 390px); ≥ sm: bảng như cũ. */}
                      <ul className="sm:hidden">
                        {rows.map((item) => (
                          <RaidCard
                            key={item.id}
                            item={item}
                            canManage={canManage}
                            onEdit={openEdit}
                          />
                        ))}
                      </ul>
                      <ScrollX className="max-sm:hidden">
                        <table className="w-full min-w-[46rem] text-left">
                          <thead>
                            <tr className="text-xs font-medium text-faint">
                              <th scope="col" className="px-3 py-2">
                                Nội dung
                              </th>
                              <th
                                scope="col"
                                className="px-3 py-2"
                                title="Người chịu trách nhiệm theo dõi và xử lý"
                              >
                                Người phụ trách
                              </th>
                              <th scope="col" className="px-3 py-2" title={RAID_LEVEL_LEGEND}>
                                Xác suất × ảnh hưởng
                              </th>
                              <th scope="col" className="px-3 py-2">
                                Trạng thái
                              </th>
                              <th scope="col" className="px-3 py-2" title="Ngày cần xử lý xong">
                                Hạn xử lý
                              </th>
                              {canManage && (
                                <th scope="col" className="px-3 py-2 text-right">
                                  Thao tác
                                </th>
                              )}
                            </tr>
                          </thead>
                          <tbody>
                            {rows.map((item) => (
                              <RaidRow
                                key={item.id}
                                item={item}
                                canManage={canManage}
                                onEdit={openEdit}
                              />
                            ))}
                          </tbody>
                        </table>
                      </ScrollX>
                    </>
                  )}
                </SectionCard>
              </div>
            )
          }
        </QueryBoundary>
      </TabPanel>

      <RaidEditorModal
        open={editorOpen}
        item={editing}
        defaultKind={kind}
        onClose={() => {
          setEditorOpen(false);
          setEditing(null);
        }}
      />
    </PageFrame>
  );
}
